import fs from 'node:fs/promises';
import path from 'node:path';
import { ORIGINALS_DIR, OUTPUT_DIR, R2_ENV_VARS, UPLOAD, VARIANTS } from './lib/config.js';
import { parseAlbumDir, readTitleOverride } from './lib/album.js';
import { loadEnvFile, requireEnv } from './lib/env.js';
import { emptyManifest, mergeAlbums, parseManifest, summarizeManifest, unionPhotos } from './lib/manifest.js';
import { runPool } from './lib/pool.js';
import { createR2Client, describeError, getText, headSize, isPreconditionFailed, putObject, withRetry } from './lib/r2.js';

function usage() {
  console.log('Uso: npm run upload -- AAAA-MM-DD_nome-do-jogo [outro-album ...] [--dry-run] [--overwrite]');
  console.log('  --dry-run    consulta o bucket e mostra o que seria enviado, sem enviar nada');
  console.log('  --overwrite  sobrescreve arquivos que já existem no bucket com tamanho diferente');
}

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// Validação local completa antes de qualquer acesso à rede.
async function prepareAlbum(arg) {
  const { id } = parseAlbumDir(arg);
  const albumOut = path.join(OUTPUT_DIR, 'albums', id);
  const albumJsonPath = path.join(albumOut, 'album.json');

  let albumJson;
  try {
    albumJson = JSON.parse(await fs.readFile(albumJsonPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`${id}: album.json não encontrado. Rode antes: npm run process -- originals/${id}`);
    }
    throw new Error(`${id}: album.json inválido (${err.message}).`);
  }
  if (albumJson.id !== id) throw new Error(`${id}: album.json pertence a outro álbum ("${albumJson.id}").`);
  if (!Array.isArray(albumJson.photos) || albumJson.photos.length === 0) {
    throw new Error(`${id}: album.json não tem fotos.`);
  }

  const files = [];
  const missing = [];
  for (const photo of albumJson.photos) {
    for (const v of VARIANTS) {
      const rel = `${v.dir}/${photo.id}.jpg`;
      const localPath = path.join(albumOut, rel);
      try {
        const { size } = await fs.stat(localPath);
        files.push({ key: `albums/${id}/${rel}`, localPath, size, photoId: photo.id });
      } catch {
        missing.push(rel);
      }
    }
  }
  if (missing.length > 0) {
    const sample = missing.slice(0, 5).join(', ');
    throw new Error(
      `${id}: faltam ${missing.length} arquivo(s) em output/ (ex.: ${sample}). Rode: npm run process -- originals/${id}`,
    );
  }

  const override = await readTitleOverride(path.join(ORIGINALS_DIR, id));
  if (override?.includes('—')) {
    console.warn(`AVISO: ${id}: o título em titulo.txt usa travessão (—). A convenção do site é não usar.`);
  }

  return {
    id,
    titleOverride: override,
    folderTitle: albumJson.title,
    files,
    entry: { id, date: albumJson.date, photos: albumJson.photos },
  };
}

// titulo.txt tem prioridade; sem ele, mantém o título já publicado (que pode ter sido
// renomeado no gerenciador); álbum novo usa o nome da pasta.
function resolveTitle(album, existing) {
  if (album.titleOverride) return { title: album.titleOverride, source: 'do titulo.txt' };
  if (existing?.title) return { title: existing.title, source: 'mantido do manifest' };
  return { title: album.folderTitle, source: 'do nome da pasta' };
}

async function uploadAlbum(album, ctx) {
  const { client, bucket, dryRun, overwrite, secrets } = ctx;
  const label = (f) => f.key.slice(`albums/${album.id}/`.length);
  const onRetry = (key) => (err, attempt, delay) =>
    console.warn(`  tentativa ${attempt} falhou em ${key} (${describeError(err, secrets)}). Nova tentativa em ${delay} ms.`);

  console.log(`\nÁlbum ${album.id}: ${album.files.length} arquivos`);

  const results = await runPool(album.files, UPLOAD.concurrency, async (file) => {
    try {
      const remoteSize = await withRetry(() => headSize(client, bucket, file.key), { onRetry: onRetry(file.key) });
      if (remoteSize === file.size) return { file, status: 'skipped' };
      if (remoteSize !== null && !overwrite) {
        console.warn(
          `  AVISO: ${label(file)} já existe no bucket com outro tamanho (${remoteSize.toLocaleString('pt-BR')} bytes no bucket, ${file.size.toLocaleString('pt-BR')} bytes local). Pulando.`,
        );
        return { file, status: 'divergent' };
      }
      const replacing = remoteSize !== null;
      if (dryRun) {
        console.log(`  ${replacing ? 'sobrescreveria' : 'enviaria'} ${label(file)} (${formatSize(file.size)})`);
        return { file, status: replacing ? 'overwritten' : 'sent' };
      }
      const body = await fs.readFile(file.localPath);
      await withRetry(
        () =>
          putObject(client, bucket, file.key, body, {
            contentType: 'image/jpeg',
            cacheControl: UPLOAD.photoCacheControl,
          }),
        { onRetry: onRetry(file.key) },
      );
      console.log(`  ${replacing ? 'sobrescrito' : 'enviado'} ${label(file)} (${formatSize(file.size)})`);
      return { file, status: replacing ? 'overwritten' : 'sent' };
    } catch (err) {
      console.error(`  ERRO em ${label(file)}: ${describeError(err, secrets)}`);
      return { file, status: 'failed' };
    }
  });

  const count = (status) => results.filter((r) => r.status === status).length;
  album.divergentIds = new Set(results.filter((r) => r.status === 'divergent').map((r) => r.file.photoId));
  return {
    sent: count('sent'),
    overwritten: count('overwritten'),
    skipped: count('skipped'),
    divergent: count('divergent'),
    failed: count('failed'),
  };
}

async function updateManifest(albums, ctx) {
  const { client, bucket, dryRun, overwrite, secrets } = ctx;
  const key = UPLOAD.manifestKey;
  const onRetry = (err, attempt, delay) =>
    console.warn(`  tentativa ${attempt} falhou no manifest (${describeError(err, secrets)}). Nova tentativa em ${delay} ms.`);

  // Grava só se o manifest não mudou desde a leitura (ETag). Se o gerenciador ou outro upload
  // alterou no meio, lê de novo e refaz a mesclagem.
  for (let attempt = 1; ; attempt++) {
    const current = await withRetry(() => getText(client, bucket, key), { onRetry });
    const manifest = current === null ? emptyManifest() : parseManifest(current.text);

    const entries = [];
    console.log(`\nManifest${dryRun ? ' (simulação)' : ''}: ${current === null ? 'não existia no bucket' : 'atual lido do bucket'}`);
    let changed = false;
    for (const album of albums) {
      const existing = manifest.albums.find((a) => a.id === album.id);
      const { title, source } = resolveTitle(album, existing);
      const { photos, added } = unionPhotos(existing?.photos, album.entry.photos, {
        overwrite,
        skipIds: album.divergentIds,
      });
      const entry = { ...existing, id: album.entry.id, date: album.entry.date, title, photos };
      if (entry.cover && !photos.some((p) => p.id === entry.cover)) delete entry.cover;
      entries.push(entry);
      let action;
      if (!existing) {
        action = `novo (${entry.photos.length} fotos)`;
      } else if (JSON.stringify(existing) === JSON.stringify(entry)) {
        action = 'sem mudanças';
      } else {
        action = `atualizado (${existing.photos?.length ?? 0} -> ${entry.photos.length} fotos, ${added} nova(s))`;
      }
      if (action !== 'sem mudanças') changed = true;
      console.log(`  ${album.id}: ${action}, título "${title}" (${source})`);
    }
    const next = mergeAlbums(manifest, entries);
    const before = summarizeManifest(manifest);
    const after = summarizeManifest(next);
    console.log(`  Antes: ${before.albums} álbum(ns), ${before.photos} foto(s). Depois: ${after.albums} álbum(ns), ${after.photos} foto(s).`);

    if (!changed) {
      console.log('  O manifest já está atualizado com esse(s) álbum(ns). Nada a enviar.');
      return;
    }
    if (dryRun) {
      console.log('  Nada foi enviado (--dry-run).');
      return;
    }

    if (current !== null) {
      const backupDir = path.join(OUTPUT_DIR, 'manifest-backups');
      await fs.mkdir(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.writeFile(path.join(backupDir, `manifest-${stamp}.json`), current.text);
    }
    try {
      await withRetry(
        () =>
          putObject(client, bucket, key, `${JSON.stringify(next, null, 2)}\n`, {
            contentType: UPLOAD.manifestContentType,
            cacheControl: UPLOAD.manifestCacheControl,
            ...(current === null ? { ifNoneMatch: '*' } : { ifMatch: current.etag }),
          }),
        { onRetry },
      );
      console.log('  manifest.json enviado.');
      return;
    } catch (err) {
      if (!isPreconditionFailed(err) || attempt >= UPLOAD.manifestConflictAttempts) throw err;
      console.warn(`  O manifest foi alterado por outra operação durante o upload. Lendo de novo (tentativa ${attempt + 1}).`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--dry-run', '--overwrite', '--help']);
  const unknown = args.filter((a) => a.startsWith('--') && !known.has(a));
  const albumArgs = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--help') || albumArgs.length === 0 || unknown.length > 0) {
    if (unknown.length > 0) console.error(`Opção desconhecida: ${unknown.join(', ')}`);
    usage();
    process.exitCode = args.includes('--help') ? 0 : 1;
    return;
  }
  const dryRun = args.includes('--dry-run');
  const overwrite = args.includes('--overwrite');

  loadEnvFile();
  const env = requireEnv(R2_ENV_VARS);
  const publicBase = env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '');

  const albums = [];
  for (const arg of albumArgs) albums.push(await prepareAlbum(arg));

  if (dryRun) console.log('Modo --dry-run: o bucket só é lido, nada é enviado.');
  if (overwrite) {
    console.warn(
      'AVISO: --overwrite ativo. Quem já baixou as fotos sobrescritas (e o CDN) pode continuar vendo a versão antiga por causa do cache immutable.',
    );
  }

  const ctx = {
    client: createR2Client(env),
    bucket: env.R2_BUCKET,
    dryRun,
    overwrite,
    secrets: [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY],
  };

  const total = { sent: 0, overwritten: 0, skipped: 0, divergent: 0, failed: 0 };
  const complete = [];
  const incomplete = [];
  for (const album of albums) {
    const stats = await uploadAlbum(album, ctx);
    for (const k of Object.keys(total)) total[k] += stats[k];
    (stats.failed === 0 ? complete : incomplete).push(album);
  }

  let manifestFailed = false;
  if (complete.length > 0) {
    try {
      await updateManifest(complete, ctx);
    } catch (err) {
      manifestFailed = true;
      console.error(`\nERRO ao atualizar o manifest: ${describeError(err, ctx.secrets)}`);
    }
  }
  if (incomplete.length > 0) {
    console.error(
      `\nManifest NÃO atualizado para ${incomplete.map((a) => a.id).join(', ')}: houve falhas no envio. Rode o upload de novo.`,
    );
  }

  const verb = dryRun ? 'seriam enviados' : 'enviados';
  console.log(`\nResumo${dryRun ? ' (simulação)' : ''}:`);
  console.log(`  ${total.sent} arquivo(s) ${verb}${total.overwritten ? `, ${total.overwritten} ${dryRun ? 'seriam sobrescritos' : 'sobrescritos'}` : ''}`);
  console.log(`  ${total.skipped} pulado(s) por já existirem com o mesmo tamanho`);
  if (total.divergent) {
    console.log(`  ${total.divergent} pulado(s) por existirem com tamanho diferente (use --overwrite para substituir)`);
  }
  if (total.failed) console.log(`  ${total.failed} com erro`);

  const example = complete[0] ?? albums[0];
  const photoId = example.entry.photos[0].id;
  console.log(`  Foto de exemplo: ${publicBase}/albums/${example.id}/dl/4k/${photoId}.jpg`);

  if (total.failed > 0 || manifestFailed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`ERRO: ${err.message}`);
  process.exitCode = 1;
});
