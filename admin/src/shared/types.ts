export interface Photo {
  id: string;
  w: number;
  h: number;
  t?: string;
}

export interface Album {
  id: string;
  date: string;
  title: string;
  photos: Photo[];
  cover?: string;
  tags?: string[];
  formats?: string[];
}

export interface Manifest {
  updatedAt: string | null;
  albums: Album[];
}

// Mesmas pastas que scripts/lib/config.js gera para cada foto.
export const VARIANT_DIRS = ['thumb', 'preview', 'dl/4k', 'dl/2k', 'dl/fhd', 'dl/hd', 'dl/ig45', 'dl/ig916'] as const;

export const ALBUM_ID_RE = /^\d{4}-\d{2}-\d{2}_[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
export const TITLE_MAX = 120;
export const TAGS_MAX = 5;
export const TAG_MAX_LENGTH = 24;
export const TAG_RE = /^[a-z0-9]+(?:[ -][a-z0-9]+)*$/;

// Minúsculas, sem acento e com espaços simples. Mesma regra de site/src/lib/manifest.ts.
export function normalizeTag(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const MUTATION_HEADER = 'X-Galeria-Admin';

export function photoKey(albumId: string, photoId: string, dir: string): string {
  return `albums/${albumId}/${dir}/${photoId}.jpg`;
}

export interface PurgeResult {
  configured: boolean;
  purged: string[];
  failed: string[];
  pending: string[];
  message?: string;
}

export interface AlbumsResponse {
  publicBaseUrl: string;
  user: string | null;
  updatedAt: string | null;
  albums: Album[];
}

export interface UpdateAlbumResponse {
  album: Album;
  backupKey: string;
}

export interface DeleteResponse {
  album: Album | null;
  albumRemoved: boolean;
  deletedObjects: number;
  deleteErrors: number;
  backupKey: string;
  purge: PurgeResult;
}

export interface ApiError {
  error: string;
  code?: string;
}

// Envio pelo celular (bucket de entrada) e publicação.

export const INBOX_META_FILE = '_album.json';
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const UPLOAD_EXTENSIONS = ['.jpg', '.jpeg'];

// Mesma regra de scripts/lib/album.js (sanitizePhotoId).
export function sanitizePhotoId(baseName: string): string {
  return baseName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Nome do arquivo na entrada ({photoId}.jpg), ou null se não for .jpg/.jpeg ou não gerar um id.
export function inboxFileName(original: string): string | null {
  const dot = original.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = original.slice(dot).toLowerCase();
  if (!UPLOAD_EXTENSIONS.includes(ext)) return null;
  const id = sanitizePhotoId(original.slice(0, dot));
  return id && PHOTO_ID_RE.test(id) ? `${id}.jpg` : null;
}

export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export interface InboxMeta {
  title: string;
  date: string;
}

export interface InboxFile {
  name: string;
  size: number;
}

export interface InboxAlbum {
  albumId: string;
  title: string | null;
  date: string;
  photos: number;
  bytes: number;
  updatedAt: string;
}

export interface InboxResponse {
  albums: InboxAlbum[];
}

export interface UploadListResponse {
  albumId: string;
  meta: InboxMeta | null;
  files: InboxFile[];
  // Fotos que já estão publicadas nesse álbum (o envio recusa esses nomes).
  published: string[];
}

export interface UploadResponse {
  name: string;
  size: number;
}

export interface PublishRun {
  id: number;
  albumId: string | null;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  step: string | null;
  stepsDone: number;
  stepsTotal: number;
}

export interface PublishStatus {
  configured: boolean;
  busy: boolean;
  // Por que envio e exclusões estão bloqueados (ou por que não deu para confirmar).
  message: string | null;
  run: PublishRun | null;
}
