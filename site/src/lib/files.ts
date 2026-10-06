import { FILE_PREFIX, type ResolutionId } from '../config';
import type { PhotoRef } from '../components/types';

export const photoFileName = (item: PhotoRef, res: ResolutionId) => `${FILE_PREFIX}-${item.photo.id}-${res}.jpg`;

export function zipFileName(items: PhotoRef[], res: ResolutionId) {
  const dates = new Set(items.map((i) => i.album.date));
  const label = dates.size === 1 ? [...dates][0] : 'fotos';
  return `${FILE_PREFIX}-${label}-${res}.zip`;
}
