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
const FORMAT_DIRS = { ig45: 'dl/ig45', ig916: 'dl/ig916' };
const exists = (file) => fs.access(file).then(() => true, () => false);

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
  // Formatos do Instagram entram só se o process já gerou para todas as fotos do teste.
  const formats = [];
  for (const [key, dir] of Object.entries(FORMAT_DIRS)) {
    const all = await Promise.all(albumJson.photos.map((p) => exists(path.join(OUTPUT_ALBUMS, TEST_ALBUM, dir, `${p.id}.jpg`))));
    if (all.every(Boolean)) formats.push(key);
  }
  const dirs = [...VARIANT_DIRS, ...formats.map((k) => FORMAT_DIRS[k])];
  for (const copy of COPIES) {
    let count = 0;
    for (const photo of albumJson.photos) {
      for (const dir of dirs) {
        const body = await fs.readFile(path.join(OUTPUT_ALBUMS, TEST_ALBUM, dir, `${photo.id}.jpg`));
        await bucket.put(`albums/${copy.id}/${dir}/${photo.id}.jpg`, body, {
          httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
        });
        count++;
      }
    }
    albums = albums.filter((a) => a.id !== copy.id);
    albums.push({
      id: copy.id,
      date: copy.id.slice(0, 10),
      title: copy.title,
      photos: albumJson.photos,
      ...(formats.length > 0 && { formats }),
    });
    console.log(`${copy.id}: ${count} arquivos no R2 local.`);
  }
  albums.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  const manifest = { updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), albums };
  await bucket.put('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=60' },
  });
  console.log(`manifest.json local: ${albums.length} álbum(ns).`);

  let cleared = 0;
  for (let page = await env.INBOX.list(); ; page = await env.INBOX.list({ cursor: page.cursor })) {
    if (page.objects.length) await env.INBOX.delete(page.objects.map((o) => o.key));
    cleared += page.objects.length;
    if (!page.truncated) break;
  }
  console.log(`Entrada local limpa (${cleared} arquivo(s) apagado(s)).`);
} finally {
  await dispose();
}
