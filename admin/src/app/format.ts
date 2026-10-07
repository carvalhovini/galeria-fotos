import type { Album } from '../shared/types';

export const PUBLIC_SITE = 'https://carvalhovini.com';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1] ?? '?'} ${y}`;
}

export function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} de ${MONTHS_LONG[m - 1] ?? '?'} de ${y}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${Math.round(bytes / 1024).toLocaleString('pt-BR')} KB`;
}

export function normalizeTitle(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

// Mesma regra do site: sem `cover`, ou se a foto não existe mais, a capa é a primeira foto.
export function coverId(album: Album): string | undefined {
  return album.photos.some((p) => p.id === album.cover) ? album.cover : album.photos[0]?.id;
}

// Tags usadas nos álbuns, das mais usadas para as menos usadas.
export function usedTags(albums: Album[]): string[] {
  const counts = new Map<string, number>();
  for (const a of albums) for (const t of a.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

export function thumbUrl(base: string, albumId: string, photoId: string): string {
  return `${base}/albums/${albumId}/thumb/${photoId}.jpg`;
}
