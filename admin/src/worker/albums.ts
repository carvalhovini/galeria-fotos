import {
  PHOTO_ID_RE,
  TAGS_MAX,
  TAG_MAX_LENGTH,
  TAG_RE,
  TITLE_MAX,
  VARIANT_DIRS,
  normalizeTag,
  photoKey,
  type Album,
  type AlbumsResponse,
  type DeleteResponse,
  type PurgeResult,
  type UpdateAlbumResponse,
} from '../shared/types';
import type { AccessIdentity } from './access';
import type { Env } from './env';
import { HttpError } from './http';
import { findAlbum, readManifest, updateManifest } from './manifest';
import { assertNotPublishing } from './publish';
import { purgeUrls } from './purge';

const MAX_PHOTOS_PER_DELETE = 1000;
const MAX_URLS_PER_PURGE = 500;
const R2_DELETE_BATCH = 1000;

export function publicBase(env: Env): string {
  const raw = env.PUBLIC_R2_BASE_URL?.trim().replace(/\/+$/, '');
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && url.pathname === '/') return url.origin;
  } catch {
    // erro abaixo
  }
  throw new HttpError(500, 'PUBLIC_R2_BASE_URL não está configurada corretamente.');
}

function normalizeTitle(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
}

export function validTitle(value: unknown): string {
  const title = normalizeTitle(value);
  if (!title) throw new HttpError(400, 'Digite um título.');
  if (title.length > TITLE_MAX) throw new HttpError(400, `O título pode ter no máximo ${TITLE_MAX} caracteres.`);
  if (/[\u0000-\u001f\u007f]/.test(title)) throw new HttpError(400, 'O título tem caracteres inválidos.');
  if (title.includes('—')) throw new HttpError(400, 'Não use travessão (—) no título.');
  return title;
}

async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function deleteKeys(bucket: R2Bucket, keys: string[]): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;
  for (let i = 0; i < keys.length; i += R2_DELETE_BATCH) {
    const chunk = keys.slice(i, i + R2_DELETE_BATCH);
    try {
      await bucket.delete(chunk);
      deleted += chunk.length;
    } catch {
      console.error(`r2: falha ao apagar ${chunk.length} arquivo(s)`);
      errors += chunk.length;
    }
  }
  return { deleted, errors };
}

async function removeFiles(env: Env, keys: string[]): Promise<{ deleted: number; errors: number; purge: PurgeResult }> {
  const base = publicBase(env);
  const { deleted, errors } = await deleteKeys(env.BUCKET, keys);
  const purge = await purgeUrls(env, [`${base}/manifest.json`, ...keys.map((k) => `${base}/${k}`)]);
  return { deleted, errors, purge };
}

export async function listAlbums(env: Env, identity: AccessIdentity): Promise<AlbumsResponse> {
  const current = await readManifest(env.BUCKET);
  return {
    publicBaseUrl: publicBase(env),
    user: identity.email,
    updatedAt: current?.manifest.updatedAt ?? null,
    albums: current?.manifest.albums ?? [],
  };
}

export function validTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'As tags precisam ser uma lista de textos.');
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new HttpError(400, 'As tags precisam ser uma lista de textos.');
    if (raw.includes('—')) throw new HttpError(400, 'Não use travessão (—) nas tags.');
    const tag = normalizeTag(raw);
    if (!tag || tags.includes(tag)) continue;
    if (tag.length > TAG_MAX_LENGTH) throw new HttpError(400, `Cada tag pode ter no máximo ${TAG_MAX_LENGTH} caracteres.`);
    if (!TAG_RE.test(tag)) throw new HttpError(400, `A tag "${tag}" tem caracteres inválidos. Use só letras, números, espaço e hífen.`);
    tags.push(tag);
  }
  if (tags.length > TAGS_MAX) throw new HttpError(400, `Use no máximo ${TAGS_MAX} tags por álbum.`);
  return tags;
}

// Título, capa e tags, sozinhos ou juntos. `cover: null` volta a usar a primeira foto;
// lista de tags vazia remove o campo.
export async function updateAlbum(env: Env, albumId: string, body: Record<string, unknown>): Promise<UpdateAlbumResponse> {
  const has = (key: string) => Object.hasOwn(body, key);
  if (!has('title') && !has('cover') && !has('tags')) throw new HttpError(400, 'Nada para alterar.');
  const title = has('title') ? validTitle(body.title) : undefined;
  const tags = has('tags') ? validTags(body.tags) : undefined;
  const cover = body.cover;
  if (has('cover') && cover !== null && (typeof cover !== 'string' || !PHOTO_ID_RE.test(cover))) {
    throw new HttpError(400, 'Foto de capa inválida.');
  }

  let album = null as Album | null;
  const { backupKey } = await updateManifest(env.BUCKET, (m) => {
    album = findAlbum(m, albumId);
    if (title !== undefined) album.title = title;
    if (typeof cover === 'string') {
      if (!album.photos.some((p) => p.id === cover)) throw new HttpError(400, 'Essa foto não está mais no álbum. Recarregue a página.');
      album.cover = cover;
    } else if (cover === null) {
      delete album.cover;
    }
    if (tags?.length) album.tags = tags;
    else if (tags) delete album.tags;
  });
  return { album: album!, backupKey };
}

export async function deletePhotos(env: Env, albumId: string, body: Record<string, unknown>): Promise<DeleteResponse> {
  const raw = body.photoIds;
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'Selecione pelo menos uma foto.');
  if (raw.length > MAX_PHOTOS_PER_DELETE) throw new HttpError(400, `Exclua no máximo ${MAX_PHOTOS_PER_DELETE} fotos por vez.`);
  if (!raw.every((id) => typeof id === 'string' && PHOTO_ID_RE.test(id))) throw new HttpError(400, 'Lista de fotos inválida.');
  const wanted = new Set(raw as string[]);
  await assertNotPublishing(env);

  let removed: string[] = [];
  let remaining = null as Album | null;
  const { backupKey } = await updateManifest(env.BUCKET, (m) => {
    const album = findAlbum(m, albumId);
    removed = album.photos.filter((p) => wanted.has(p.id)).map((p) => p.id);
    if (removed.length === 0) throw new HttpError(404, 'Essas fotos não estão mais no álbum. Recarregue a página.');
    album.photos = album.photos.filter((p) => !wanted.has(p.id));
    if (album.cover && wanted.has(album.cover)) delete album.cover;
    remaining = album.photos.length > 0 ? album : null;
    if (!remaining) m.albums = m.albums.filter((a) => a.id !== albumId);
  });

  const keys = new Set(removed.flatMap((photoId) => VARIANT_DIRS.map((dir) => photoKey(albumId, photoId, dir))));
  if (!remaining) for (const key of await listKeys(env.BUCKET, `albums/${albumId}/`)) keys.add(key);

  const { deleted, errors, purge } = await removeFiles(env, [...keys]);
  return { album: remaining, albumRemoved: !remaining, deletedObjects: deleted, deleteErrors: errors, backupKey, purge };
}

export async function deleteAlbum(env: Env, albumId: string, body: Record<string, unknown>): Promise<DeleteResponse> {
  const typed = normalizeTitle(body.confirmTitle);
  if (!typed) throw new HttpError(400, 'Digite o título do álbum para confirmar.');
  await assertNotPublishing(env);

  const { backupKey } = await updateManifest(env.BUCKET, (m) => {
    const album = findAlbum(m, albumId);
    if (typed !== normalizeTitle(album.title)) {
      throw new HttpError(400, 'O título digitado não confere com o título do álbum.');
    }
    m.albums = m.albums.filter((a) => a.id !== albumId);
  });

  const keys = await listKeys(env.BUCKET, `albums/${albumId}/`);
  const { deleted, errors, purge } = await removeFiles(env, keys);
  return { album: null, albumRemoved: true, deletedObjects: deleted, deleteErrors: errors, backupKey, purge };
}

export async function retryPurge(env: Env, body: Record<string, unknown>): Promise<PurgeResult> {
  const base = publicBase(env);
  const raw = body.urls;
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'Nenhuma URL para limpar.');
  if (raw.length > MAX_URLS_PER_PURGE) throw new HttpError(400, `Envie no máximo ${MAX_URLS_PER_PURGE} URLs por vez.`);
  const allowed = (u: unknown) =>
    typeof u === 'string' &&
    (u === `${base}/manifest.json` || (u.startsWith(`${base}/albums/`) && /^[A-Za-z0-9_\-./]+$/.test(u.slice(base.length)) && !u.includes('..')));
  if (!raw.every(allowed)) throw new HttpError(400, 'Só é possível limpar URLs de fotos da galeria ou o manifest.');
  return purgeUrls(env, raw as string[]);
}
