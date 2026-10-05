export function emptyManifest() {
  return { updatedAt: null, albums: [] };
}

export function parseManifest(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`manifest.json do bucket não é um JSON válido (${err.message}).`);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.albums)) {
    throw new Error('manifest.json do bucket não tem a lista "albums".');
  }
  return data;
}

// Inclui ou substitui os álbuns pelo id. Álbuns mais recentes primeiro.
export function mergeAlbums(manifest, albums, now = new Date()) {
  const byId = new Map(manifest.albums.map((a) => [a.id, a]));
  for (const album of albums) byId.set(album.id, album);
  const merged = [...byId.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
  );
  return { ...manifest, updatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), albums: merged };
}

export function summarizeManifest(manifest) {
  const photos = manifest.albums.reduce((sum, a) => sum + (a.photos?.length ?? 0), 0);
  return { albums: manifest.albums.length, photos };
}
