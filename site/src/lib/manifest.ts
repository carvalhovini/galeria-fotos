import { FORMAT_IDS, R2_BASE_URL, type ResolutionId } from '../config';

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
  // Opcional no manifest: id da foto de capa. Sem ele, a capa é a primeira foto.
  cover?: string;
  // Opcional: até 5 tags curtas, minúsculas e sem acento.
  tags?: string[];
  // Opcional: formatos do Instagram que todas as fotos do álbum têm.
  formats?: ResolutionId[];
}

export interface Manifest {
  updatedAt: string | null;
  albums: Album[];
}

export type Variant = 'thumb' | 'preview' | ResolutionId;

const ID_RE = /^[A-Za-z0-9_-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_RE = /^[a-z0-9]+(?:[ -][a-z0-9]+)*$/;
const TAGS_MAX = 5;
const TAG_MAX_LENGTH = 24;

// Mesma regra de admin/src/shared/types.ts.
export function normalizeTag(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .filter((t): t is string => typeof t === 'string')
    .map(normalizeTag)
    .filter((t, i, all) => t.length <= TAG_MAX_LENGTH && TAG_RE.test(t) && all.indexOf(t) === i)
    .slice(0, TAGS_MAX);
  return tags.length > 0 ? tags : undefined;
}

function toFormats(value: unknown): ResolutionId[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const formats = FORMAT_IDS.filter((f) => value.includes(f));
  return formats.length > 0 ? formats : undefined;
}

function isPhoto(p: unknown): p is Photo {
  const o = p as Photo;
  return !!o && typeof o.id === 'string' && ID_RE.test(o.id) && o.w > 0 && o.h > 0;
}

function toAlbum(a: unknown): Album | null {
  const o = a as Album;
  if (!o || typeof o.id !== 'string' || !ID_RE.test(o.id) || !DATE_RE.test(o.date ?? '')) return null;
  const photos = Array.isArray(o.photos) ? o.photos.filter(isPhoto) : [];
  if (photos.length === 0) return null;
  const cover = typeof o.cover === 'string' && photos.some((p) => p.id === o.cover) ? o.cover : undefined;
  return { id: o.id, date: o.date, title: String(o.title ?? ''), photos, cover, tags: toTags(o.tags), formats: toFormats(o.formats) };
}

export function coverPhoto(album: Album): Photo {
  return album.photos.find((p) => p.id === album.cover) ?? album.photos[0];
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

const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function formatDate(date: string, withYear = true): string {
  const [y, m, d] = date.split('-').map(Number);
  const base = `${d} ${MONTHS[m - 1]}`;
  return withYear ? `${base} ${y}` : base;
}

// "4 de outubro de 2026"
export function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} de ${MONTHS_LONG[m - 1]} de ${y}`;
}

export function photoCount(n: number): string {
  return n === 1 ? '1 foto' : `${n.toLocaleString('pt-BR')} fotos`;
}
