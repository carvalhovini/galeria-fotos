import { R2_BASE_URL, type ResolutionId } from '../config';

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

export type Variant = 'thumb' | 'preview' | ResolutionId;

const ID_RE = /^[A-Za-z0-9_-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPhoto(p: unknown): p is Photo {
  const o = p as Photo;
  return !!o && typeof o.id === 'string' && ID_RE.test(o.id) && o.w > 0 && o.h > 0;
}

function toAlbum(a: unknown): Album | null {
  const o = a as Album;
  if (!o || typeof o.id !== 'string' || !ID_RE.test(o.id) || !DATE_RE.test(o.date ?? '')) return null;
  const photos = Array.isArray(o.photos) ? o.photos.filter(isPhoto) : [];
  if (photos.length === 0) return null;
  return { id: o.id, date: o.date, title: String(o.title ?? ''), photos };
}

export async function loadManifest(signal?: AbortSignal): Promise<Manifest> {
  const res = await fetch(`${R2_BASE_URL}/manifest.json`, { cache: 'no-cache', signal });
  if (res.status === 404) return { updatedAt: null, albums: [] };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const albums = (Array.isArray(data?.albums) ? data.albums : [])
    .map(toAlbum)
    .filter((a: Album | null): a is Album => a !== null)
    .sort((a: Album, b: Album) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { updatedAt: data?.updatedAt ?? null, albums };
}

export function photoUrl(albumId: string, photoId: string, variant: Variant): string {
  const dir = variant === 'thumb' || variant === 'preview' ? variant : `dl/${variant}`;
  return `${R2_BASE_URL}/albums/${albumId}/${dir}/${photoId}.jpg`;
}

// Dimensões aproximadas da versão gerada (lado maior limitado, sem ampliar).
export function scaledSize(photo: Photo, maxSide: number): { w: number; h: number } {
  const scale = Math.min(1, maxSide / Math.max(photo.w, photo.h));
  return { w: Math.round(photo.w * scale), h: Math.round(photo.h * scale) };
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function formatDate(date: string, withYear = true): string {
  const [y, m, d] = date.split('-').map(Number);
  const base = `${d} ${MONTHS[m - 1]}`;
  return withYear ? `${base} ${y}` : base;
}
