import type { Album, Photo } from '../lib/manifest';

export interface PhotoRef {
  key: string;
  album: Album;
  photo: Photo;
  n: number;
}

export const photoKey = (albumId: string, photoId: string) => `${albumId}/${photoId}`;
