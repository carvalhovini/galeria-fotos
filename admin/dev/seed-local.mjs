// Prepara o R2 simulado do wrangler dev (.wrangler/state). Nada é gravado no bucket real:
// o manifest público só é lido, e os arquivos do álbum de teste vêm de output/.
// Rode com o wrangler dev parado.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';

const ADMIN_DIR = path.resolve(import.meta.dirname, '..');
const OUTPUT_ALBUMS = path.resolve(ADMIN_DIR, '..', 'output', 'albums');
const PUBLIC_MANIFEST = 'https://fotos.carvalhovini.com/manifest.json';
const TEST_ALBUM = '2026-09-27_teste';
const COPIES = [
  { id: TEST_ALBUM, title: 'Teste' },
  { id: '2026-09-20_copia-teste', title: 'Cópia do teste' },
];
const VARIANT_DIRS = ['thumb', 'preview', 'dl/4k', 'dl/2k', 'dl/fhd', 'dl/hd'];

const { env, dispose } = await getPlatformProxy({ configPath: path.join(ADMIN_DIR, 'wrangler.jsonc'), persist: true });
try {
  const bucket = env.BUCKET;

  let albums = [];
  try {
    const res = await fetch(`${PUBLIC_MANIFEST}?seed=${Date.now()}`);
    if (res.ok) albums = (await res.json()).albums ?? [];
    console.log(`Manifest público lido: ${albums.length} álbum(ns).`);
  } catch {
    console.warn('Não consegui ler o manifest público; seguindo só com o álbum de teste.');
  }

  const albumJson = JSON.parse(await fs.readFile(path.join(OUTPUT_ALBUMS, TEST_ALBUM, 'album.json'), 'utf8'));
  for (const copy of COPIES) {
    let count = 0;
    for (const photo of albumJson.photos) {
      for (const dir of VARIANT_DIRS) {
        const body = await fs.readFile(path.join(OUTPUT_ALBUMS, TEST_ALBUM, dir, `${photo.id}.jpg`));
        await bucket.put(`albums/${copy.id}/${dir}/${photo.id}.jpg`, body, {
          httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
        });
        count++;
      }
    }
    albums = albums.filter((a) => a.id !== copy.id);
    albums.push({ id: copy.id, date: copy.id.slice(0, 10), title: copy.title, photos: albumJson.photos });
    console.log(`${copy.id}: ${count} arquivos no R2 local.`);
  }
  albums.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  const manifest = { updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), albums };
  await bucket.put('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=60' },
  });
  console.log(`manifest.json local: ${albums.length} álbum(ns).`);
} finally {
  await dispose();
}
