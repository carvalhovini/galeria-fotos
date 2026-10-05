export interface Photo {
  id: string;
  w: number;
  h: number;
}

export interface Album {
  id: string;
  date: string;
  title: string;
  photos: Photo[];
}

export interface Manifest {
  updatedAt: string | null;
  albums: Album[];
}

// Mesmas pastas que scripts/lib/config.js gera para cada foto.
export const VARIANT_DIRS = ['thumb', 'preview', 'dl/4k', 'dl/2k', 'dl/fhd', 'dl/hd'] as const;

export const ALBUM_ID_RE = /^\d{4}-\d{2}-\d{2}_[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
export const TITLE_MAX = 120;

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

export interface RenameResponse {
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
}
