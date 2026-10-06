import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  JPEG_OPTIONS,
  OUTPUT_DIR,
  PIPELINE_VERSION,
  ROOT_DIR,
  VARIANTS,
  WATERMARK,
} from './lib/config.js';
import { listPhotos, parseAlbumDir, readExifInfo, sortByTakenAt, takenAtText } from './lib/album.js';
import { createWatermark } from './lib/watermark.js';

const STATE_FILE = '.process-state.json';

function usage() {
  console.log('Uso: npm run process -- originals/AAAA-MM-DD_nome-do-jogo [outra-pasta ...] [--force]');
  console.log('  --force  regera todos os arquivos, mesmo os já processados');
}

// Hash da configuração de cada versão. Se mudar (tamanho, qualidade, marca d'água,
// fonte), a versão é regerada em todas as fotos do álbum.
function variantHashes() {
  const fontHash = crypto.createHash('sha256').update(readFileSync(WATERMARK.fontFile)).digest('hex');
  const { fontFile, ...watermark } = WATERMARK;
  const hashes = {};
  for (const v of VARIANTS) {
    const payload = {
      pipeline: PIPELINE_VERSION,
      jpeg: JPEG_OPTIONS,
      size: v.size,
      watermark: v.watermark ? { ...watermark, fontHash } : null,
    };
    hashes[v.key] = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  }
  return hashes;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function mtimeMs(file) {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

async function generateVariant(file, variant, outPath) {
  const resized = sharp(file, { failOn: 'error' })
    .rotate()
    .resize({ width: variant.size, height: variant.size, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColorspace('srgb');

  const tmpPath = `${outPath}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  try {
    if (variant.watermark) {
      const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
      await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
        .composite([createWatermark(info.width, info.height)])
        .jpeg(JPEG_OPTIONS)
        .toFile(tmpPath);
    } else {
      await resized.jpeg(JPEG_OPTIONS).toFile(tmpPath);
    }
    await fs.rename(tmpPath, outPath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw err;
  }
}

async function processAlbum(dir, { force, hashes }) {
  const album = parseAlbumDir(dir);
  const albumOut = path.join(OUTPUT_DIR, 'albums', album.id);
  const statePath = path.join(albumOut, STATE_FILE);
  const prevState = (await readJson(statePath)) ?? { variants: {} };

  console.log(`\nÁlbum ${album.id} ("${album.title}", ${album.date})`);

  const staleVariants = new Set();
  for (const v of VARIANTS) {
    const prev = prevState.variants?.[v.key];
    if (prev !== hashes[v.key]) {
      staleVariants.add(v.key);
      if (prev) console.log(`  A configuração da versão "${v.key}" mudou desde o último processamento. Regerando em todas as fotos.`);
    }
  }

  const { photos, duplicates } = await listPhotos(dir);
  for (const dup of duplicates) {
    console.warn(`  AVISO: ignorando ${dup.name}: ${dup.reason}.`);
  }
  if (photos.length === 0) {
    console.warn('  Nenhuma foto (.jpg, .jpeg, .png) encontrada.');
    return { generated: 0, skipped: 0, failed: 0, duplicates: duplicates.length };
  }

  const stats = { generated: 0, skipped: 0, failed: 0, duplicates: duplicates.length };
  const failedVariants = new Set();
  const done = [];

  for (const [index, photo] of photos.entries()) {
    const label = `  [${index + 1}/${photos.length}] ${photo.name}`;
    const started = Date.now();
    try {
      const meta = await sharp(photo.file).metadata();
      const w = meta.autoOrient?.width ?? meta.width;
      const h = meta.autoOrient?.height ?? meta.height;
      const exif = await readExifInfo(photo.file);

      if (!meta.icc && exif.colorSpace === 0xffff && exif.interopIndex === 'R03') {
        console.warn(
          `${label}: AVISO: parece estar em Adobe RGB sem perfil ICC embutido. As cores podem sair dessaturadas. Configure a câmera em sRGB ou exporte com o perfil embutido.`,
        );
      }

      const srcMtime = (await fs.stat(photo.file)).mtimeMs;
      let generatedHere = 0;
      let photoFailed = false;
      for (const v of VARIANTS) {
        const outPath = path.join(albumOut, v.dir, `${photo.id}.jpg`);
        const outMtime = await mtimeMs(outPath);
        const upToDate = !force && !staleVariants.has(v.key) && outMtime !== null && outMtime >= srcMtime;
        if (upToDate) {
          stats.skipped++;
          continue;
        }
        try {
          await generateVariant(photo.file, v, outPath);
          stats.generated++;
          generatedHere++;
        } catch (err) {
          stats.failed++;
          photoFailed = true;
          failedVariants.add(v.key);
          console.error(`${label}: ERRO ao gerar ${v.key}: ${err.message}`);
        }
      }

      if (!photoFailed) done.push({ id: photo.id, name: photo.name, w, h, takenAt: exif.takenAt });
      const status = generatedHere === 0 ? 'já processada, pulando' : `${generatedHere} arquivo(s) gerado(s) em ${((Date.now() - started) / 1000).toFixed(1)} s`;
      console.log(`${label} (${photo.id}, ${w}x${h}): ${status}`);
    } catch (err) {
      stats.failed++;
      VARIANTS.forEach((v) => failedVariants.add(v.key));
      console.error(`${label}: ERRO ao ler a foto: ${err.message}`);
    }
  }

  const albumJson = {
    id: album.id,
    date: album.date,
    title: album.title,
    photos: sortByTakenAt(done).map(({ id, w, h, takenAt }) => {
      const t = takenAtText(takenAt);
      return t ? { id, w, h, t } : { id, w, h };
    }),
  };
  await fs.mkdir(albumOut, { recursive: true });
  await fs.writeFile(path.join(albumOut, 'album.json'), `${JSON.stringify(albumJson, null, 2)}\n`);

  const nextState = { variants: { ...prevState.variants } };
  for (const v of VARIANTS) {
    if (!failedVariants.has(v.key)) nextState.variants[v.key] = hashes[v.key];
  }
  await fs.writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`);

  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dirs = args.filter((a) => !a.startsWith('--'));
  if (dirs.length === 0 || args.includes('--help')) {
    usage();
    process.exitCode = dirs.length === 0 ? 1 : 0;
    return;
  }
  if (!existsSync(WATERMARK.fontFile)) {
    throw new Error(`Fonte da marca d'água não encontrada: ${path.relative(ROOT_DIR, WATERMARK.fontFile)}`);
  }

  const hashes = variantHashes();
  const total = { generated: 0, skipped: 0, failed: 0, duplicates: 0 };
  for (const dir of dirs) {
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) {
      console.error(`\nERRO: pasta não encontrada: ${dir}`);
      total.failed++;
      continue;
    }
    try {
      const s = await processAlbum(dir, { force, hashes });
      for (const k of Object.keys(total)) total[k] += s[k];
    } catch (err) {
      console.error(`\nERRO: ${err.message}`);
      total.failed++;
    }
  }

  console.log(
    `\nResumo: ${total.generated} gerado(s), ${total.skipped} pulado(s), ${total.failed} erro(s), ${total.duplicates} ignorado(s) por id duplicado ou inválido.`,
  );
  console.log(`Saída em ${path.relative(process.cwd(), OUTPUT_DIR) || '.'}/albums/`);
  if (total.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`ERRO: ${err.message}`);
  process.exitCode = 1;
});
