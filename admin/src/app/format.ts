const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1] ?? '?'} ${y}`;
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

export function thumbUrl(base: string, albumId: string, photoId: string): string {
  return `${base}/albums/${albumId}/thumb/${photoId}.jpg`;
}
