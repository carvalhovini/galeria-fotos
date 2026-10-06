import {
  INBOX_META_FILE,
  MAX_UPLOAD_BYTES,
  inboxFileName,
  type InboxAlbum,
  type InboxFile,
  type InboxMeta,
  type InboxResponse,
  type UploadListResponse,
  type UploadResponse,
} from '../shared/types';
import { validTitle } from './albums';
import type { Env } from './env';
import { HttpError } from './http';
import { readManifest } from './manifest';
import { PUBLISH_MARKER_KEY, assertNotPublishing } from './publish';

const MAX_INBOX_DELETE = 1000;

async function listAll(bucket: R2Bucket, options: R2ListOptions): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ ...options, cursor });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

function metaFromObject(obj: R2Object): InboxMeta | null {
  const raw = obj.customMetadata?.title;
  if (!raw) return null;
  try {
    return { title: decodeURIComponent(raw), date: obj.customMetadata?.date ?? '' };
  } catch {
    return null;
  }
}

async function publishedIds(env: Env, albumId: string): Promise<Set<string>> {
  const current = await readManifest(env.BUCKET);
  const album = current?.manifest.albums.find((a) => a.id === albumId);
  return new Set(album?.photos.map((p) => p.id) ?? []);
}

export async function listInbox(env: Env): Promise<InboxResponse> {
  const objects = await listAll(env.INBOX, { include: ['customMetadata'] });
  const byAlbum = new Map<string, InboxAlbum>();
  for (const obj of objects) {
    const slash = obj.key.indexOf('/');
    if (slash <= 0 || obj.key === PUBLISH_MARKER_KEY) continue;
    const albumId = obj.key.slice(0, slash);
    const name = obj.key.slice(slash + 1);
    const entry = byAlbum.get(albumId) ?? {
      albumId,
      title: null,
      date: albumId.slice(0, 10),
      photos: 0,
      bytes: 0,
      updatedAt: obj.uploaded.toISOString(),
    };
    if (name === INBOX_META_FILE) {
      entry.title = metaFromObject(obj)?.title ?? null;
    } else {
      entry.photos++;
      entry.bytes += obj.size;
    }
    if (obj.uploaded.toISOString() > entry.updatedAt) entry.updatedAt = obj.uploaded.toISOString();
    byAlbum.set(albumId, entry);
  }
  return { albums: [...byAlbum.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
}

export async function listUpload(env: Env, albumId: string): Promise<UploadListResponse> {
  const objects = await listAll(env.INBOX, { prefix: `${albumId}/`, include: ['customMetadata'] });
  let meta: InboxMeta | null = null;
  const files: InboxFile[] = [];
  for (const obj of objects) {
    const name = obj.key.slice(albumId.length + 1);
    if (name === INBOX_META_FILE) meta = metaFromObject(obj);
    else files.push({ name, size: obj.size });
  }
  return { albumId, meta, files, published: [...(await publishedIds(env, albumId))] };
}

export async function putMeta(env: Env, albumId: string, body: Record<string, unknown>): Promise<InboxMeta> {
  await assertNotPublishing(env);
  const title = validTitle(body.title);
  const date = albumId.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, 'Data inválida no álbum.');
  }
  const meta: InboxMeta = { title, date };
  await env.INBOX.put(`${albumId}/${INBOX_META_FILE}`, JSON.stringify(meta), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { title: encodeURIComponent(title), date },
  });
  return meta;
}

// Grava a foto em fluxo, direto do corpo da requisição para o R2, sem guardar na memória.
export async function putPhoto(env: Env, albumId: string, rawName: string, request: Request): Promise<UploadResponse> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    throw new HttpError(400, 'Nome de arquivo inválido.');
  }
  const name = inboxFileName(decoded);
  if (!name) throw new HttpError(415, 'Só fotos .jpg ou .jpeg, com um nome que tenha letras ou números.', 'type');

  const length = Number(request.headers.get('content-length'));
  if (!Number.isInteger(length) || length <= 0) throw new HttpError(411, 'Envio sem tamanho (Content-Length).');
  if (length > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `A foto passa de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 'too-large');
  }
  if (!request.body) throw new HttpError(400, 'Envio sem conteúdo.');

  await assertNotPublishing(env);
  const metaKey = `${albumId}/${INBOX_META_FILE}`;
  if (!(await env.INBOX.head(metaKey))) throw new HttpError(409, 'Crie o álbum antes de enviar as fotos.', 'no-meta');
  const photoId = name.slice(0, -4);
  if ((await publishedIds(env, albumId)).has(photoId)) {
    throw new HttpError(409, `Já existe uma foto ${photoId} publicada nesse álbum.`, 'published');
  }

  const key = `${albumId}/${name}`;
  const stored = await env.INBOX.put(key, request.body, { httpMetadata: { contentType: 'image/jpeg' } });
  if (!stored || stored.size !== length) {
    await env.INBOX.delete(key);
    throw new HttpError(400, 'O envio chegou incompleto. Tente de novo.', 'incomplete');
  }
  const head = await env.INBOX.get(key, { range: { offset: 0, length: 3 } });
  const magic = head ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array();
  if (magic[0] !== 0xff || magic[1] !== 0xd8 || magic[2] !== 0xff) {
    await env.INBOX.delete(key);
    throw new HttpError(415, 'O arquivo não é um JPEG de verdade.', 'type');
  }
  return { name, size: stored.size };
}

export async function discardUpload(env: Env, albumId: string): Promise<{ deleted: number }> {
  await assertNotPublishing(env);
  const keys = (await listAll(env.INBOX, { prefix: `${albumId}/` })).map((o) => o.key);
  for (let i = 0; i < keys.length; i += MAX_INBOX_DELETE) await env.INBOX.delete(keys.slice(i, i + MAX_INBOX_DELETE));
  return { deleted: keys.length };
}
