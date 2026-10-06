import fs from 'node:fs/promises';
import path from 'node:path';
import { INBOX, INBOX_ENV_VARS, ORIGINALS_DIR, OUTPUT_DIR, UPLOAD } from './lib/config.js';
import { parseAlbumDir, sanitizePhotoId } from './lib/album.js';
import { loadEnvFile, requireEnv } from './lib/env.js';
import { parseManifest } from './lib/manifest.js';
import { runPool } from './lib/pool.js';
import { createR2Client, deleteObject, describeError, downloadToFile, getText, listObjects, withRetry } from './lib/r2.js';

function usage() {
  console.log('Uso: node scripts/inbox.js pull AAAA-MM-DD_nome-do-jogo');
  console.log('     node scripts/inbox.js clean AAAA-MM-DD_nome-do-jogo');
  console.log('  pull   baixa as fotos do bucket de entrada para originals/{albumId}/ e cria o titulo.txt se o álbum for novo');
  console.log('  clean  apaga da entrada só os arquivos que o pull baixou');
}

const listFile = (albumId) => path.join(OUTPUT_DIR, 'inbox', `${albumId}.json`);

async function pull(albumId, ctx) {
  const { client, inbox, bucket, secrets } = ctx;
  const onRetry = (key) => (err, attempt, delay) =>
    console.warn(`  tentativa ${attempt} falhou em ${key} (${describeError(err, secrets)}). Nova tentativa em ${delay} ms.`);

  const objects = await withRetry(() => listObjects(client, inbox, `${albumId}/`), { onRetry: onRetry('list') });
  const photos = [];
  for (const obj of objects) {
    const name = obj.key.slice(albumId.length + 1);
    if (name === INBOX.metaFile) continue;
    const ext = path.extname(name).toLowerCase();
    const base = path.basename(name, path.extname(name));
    if (name.includes('/') || ext !== '.jpg' || sanitizePhotoId(base) !== base) {
      console.warn(`  AVISO: ignorando ${name}: não é uma foto .jpg com nome válido.`);
      continue;
    }
    photos.push({ ...obj, name });
  }
  if (photos.length === 0) throw new Error(`Nenhuma foto na entrada para ${albumId}.`);

  const dir = path.join(ORIGINALS_DIR, albumId);
  await fs.mkdir(dir, { recursive: true });
  console.log(`Baixando ${photos.length} foto(s) da entrada para originals/${albumId}/`);
  const results = await runPool(photos, INBOX.concurrency, async (photo) => {
    const target = path.join(dir, photo.name);
    const local = await fs.stat(target).catch(() => null);
    if (local?.size === photo.size) return true;
    try {
      await withRetry(() => downloadToFile(client, inbox, photo.key, target), { onRetry: onRetry(photo.name) });
      return true;
    } catch (err) {
      console.error(`  ERRO ao baixar ${photo.name}: ${describeError(err, secrets)}`);
      return false;
    }
  });
  const failed = results.filter((ok) => !ok).length;
  if (failed > 0) throw new Error(`${failed} foto(s) não foram baixadas.`);

  // titulo.txt só para álbum novo: num álbum que já existe, o título publicado (que pode ter
  // sido renomeado no gerenciador) é mantido pelo upload.
  const meta = await withRetry(() => getText(client, inbox, `${albumId}/${INBOX.metaFile}`), { onRetry: onRetry('meta') });
  const title = meta ? String(JSON.parse(meta.text).title ?? '').trim() : '';
  const manifest = await withRetry(() => getText(client, bucket, UPLOAD.manifestKey), { onRetry: onRetry('manifest') });
  const exists = manifest ? parseManifest(manifest.text).albums.some((a) => a.id === albumId) : false;
  if (exists) {
    console.log('O álbum já está publicado: as fotos serão juntadas a ele, mantendo título e capa.');
  } else if (title) {
    await fs.writeFile(path.join(dir, 'titulo.txt'), `${title}\n`);
    console.log(`Álbum novo, titulo.txt criado: "${title}"`);
  } else {
    console.log('Álbum novo sem título nos metadados: o título vem do nome da pasta.');
  }

  const keys = [...photos.map((p) => p.key), ...(meta ? [`${albumId}/${INBOX.metaFile}`] : [])];
  await fs.mkdir(path.dirname(listFile(albumId)), { recursive: true });
  await fs.writeFile(listFile(albumId), `${JSON.stringify({ albumId, keys }, null, 2)}\n`);
  console.log(`Lista do que foi baixado: ${path.relative(process.cwd(), listFile(albumId))}`);
}

async function clean(albumId, ctx) {
  const { client, inbox, secrets } = ctx;
  let list;
  try {
    list = JSON.parse(await fs.readFile(listFile(albumId), 'utf8'));
  } catch {
    throw new Error(`Lista do pull não encontrada para ${albumId}. Rode o pull antes.`);
  }
  const keys = list.keys.filter((k) => typeof k === 'string' && k.startsWith(`${albumId}/`));
  const results = await runPool(keys, INBOX.concurrency, async (key) => {
    try {
      await withRetry(() => deleteObject(client, inbox, key));
      return true;
    } catch (err) {
      console.error(`  ERRO ao apagar ${key}: ${describeError(err, secrets)}`);
      return false;
    }
  });
  const failed = results.filter((ok) => !ok).length;
  console.log(`Entrada: ${keys.length - failed} arquivo(s) apagado(s)${failed ? `, ${failed} com erro` : ''}.`);
  if (failed > 0) process.exitCode = 1;
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!['pull', 'clean'].includes(command) || !arg) {
    usage();
    process.exitCode = 1;
    return;
  }
  const { id: albumId } = parseAlbumDir(arg);

  loadEnvFile();
  const env = requireEnv(INBOX_ENV_VARS);
  const ctx = {
    client: createR2Client(env),
    inbox: env.R2_INBOX_BUCKET,
    bucket: env.R2_BUCKET,
    secrets: [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY],
  };
  if (command === 'pull') await pull(albumId, ctx);
  else await clean(albumId, ctx);
}

main().catch((err) => {
  console.error(`ERRO: ${err.message}`);
  process.exitCode = 1;
});
