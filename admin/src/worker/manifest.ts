import type { Album, Manifest } from '../shared/types';
import { HttpError, sleep } from './http';

const MANIFEST_KEY = 'manifest.json';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const MANIFEST_CACHE = 'public, max-age=60';
const MAX_ATTEMPTS = 5;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function parseManifest(text: string): Manifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(500, 'O manifest.json do bucket não é um JSON válido.');
  }
  const m = data as Partial<Manifest> | null;
  if (!m || typeof m !== 'object' || !Array.isArray(m.albums)) {
    throw new HttpError(500, 'O manifest.json do bucket não tem a lista "albums".');
  }
  return { ...m, updatedAt: m.updatedAt ?? null, albums: m.albums } as Manifest;
}

export async function readManifest(bucket: R2Bucket): Promise<{ manifest: Manifest; etag: string; text: string } | null> {
  const obj = await bucket.get(MANIFEST_KEY);
  if (!obj) return null;
  const text = await obj.text();
  return { manifest: parseManifest(text), etag: obj.etag, text };
}

export function findAlbum(manifest: Manifest, albumId: string): Album {
  const album = manifest.albums.find((a) => a.id === albumId);
  if (!album) throw new HttpError(404, 'Álbum não encontrado. Talvez já tenha sido excluído.');
  return album;
}

// Lê o manifest, aplica `mutate` numa cópia, guarda o manifest anterior em manifest-backups/
// e grava só se o ETag não mudou. Em caso de conflito, recomeça do zero com a versão nova.
export async function updateManifest(
  bucket: R2Bucket,
  mutate: (manifest: Manifest) => void,
): Promise<{ manifest: Manifest; backupKey: string }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const current = await readManifest(bucket);
    if (!current) throw new HttpError(404, 'O manifest.json não existe no bucket.');

    const next = parseManifest(current.text);
    mutate(next);
    next.updatedAt = nowIso();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupKey = `manifest-backups/manifest-${stamp}-${current.etag.slice(0, 8)}.json`;
    await bucket.put(backupKey, current.text, {
      httpMetadata: { contentType: CONTENT_TYPE, cacheControl: 'no-store' },
    });

    const written = await bucket.put(MANIFEST_KEY, `${JSON.stringify(next, null, 2)}\n`, {
      onlyIf: { etagMatches: current.etag },
      httpMetadata: { contentType: CONTENT_TYPE, cacheControl: MANIFEST_CACHE },
    });
    if (written) return { manifest: next, backupKey };

    console.warn(`manifest: conflito de ETag na tentativa ${attempt} de ${MAX_ATTEMPTS}`);
    if (attempt < MAX_ATTEMPTS) await sleep(80 * 2 ** (attempt - 1) + Math.random() * 80);
  }
  throw new HttpError(409, 'O manifest foi alterado ao mesmo tempo por outra operação. Recarregue e tente de novo.');
}
