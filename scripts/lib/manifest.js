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

// União das fotos de um álbum por id. Uma foto já publicada mantém a entrada atual (só ganha
// o horário `t` se não tinha), a não ser com `overwrite`; `skipIds` são fotos cujo arquivo no
// bucket é outro e nunca trocam de entrada. Se todas as fotos têm `t`, ordena por horário;
// senão mantém a ordem publicada e põe as novas no fim, na ordem em que vieram.
export function unionPhotos(existing = [], incoming = [], { overwrite = false, skipIds = new Set() } = {}) {
  const incomingById = new Map(incoming.map((p) => [p.id, p]));
  const merged = existing.map((old) => {
    const next = incomingById.get(old.id);
    if (!next || skipIds.has(old.id)) return old;
    if (overwrite) return next;
    return old.t || !next.t ? old : { ...old, t: next.t };
  });
  const known = new Set(existing.map((p) => p.id));
  const added = incoming.filter((p) => !known.has(p.id));
  merged.push(...added);
  if (merged.every((p) => typeof p.t === 'string')) {
    merged.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  }
  return { photos: merged, added: added.length };
}

// Formatos extras que o álbum pode anunciar: os que este envio tem em todas as suas fotos,
// desde que cada foto já publicada e não reenviada também tenha (o álbum publicado já
// anunciava o formato).
export function albumFormats(existing, incoming, localFormats, photos) {
  const incomingIds = new Set(incoming.map((p) => p.id));
  const published = new Set((existing?.photos ?? []).map((p) => p.id));
  const publishedFormats = new Set(existing?.formats ?? []);
  return localFormats.filter((f) =>
    photos.every((p) => incomingIds.has(p.id) || (publishedFormats.has(f) && published.has(p.id))),
  );
}

export function summarizeManifest(manifest) {
  const photos = manifest.albums.reduce((sum, a) => sum + (a.photos?.length ?? 0), 0);
  return { albums: manifest.albums.length, photos };
}
