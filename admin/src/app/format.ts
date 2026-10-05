const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1] ?? '?'} ${y}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

export function normalizeTitle(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function thumbUrl(base: string, albumId: string, photoId: string): string {
  return `${base}/albums/${albumId}/thumb/${photoId}.jpg`;
}
