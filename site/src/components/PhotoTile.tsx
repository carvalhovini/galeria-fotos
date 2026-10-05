import { photoUrl, scaledSize } from '../lib/manifest';
import type { PhotoRef } from './types';

interface Props {
  item: PhotoRef;
  selected: boolean;
  onToggle: (key: string) => void;
  onZoom: (key: string) => void;
}

export default function PhotoTile({ item, selected, onToggle, onZoom }: Props) {
  const { album, photo, n, key } = item;
  const thumb = scaledSize(photo, 900);
  const name = `Foto ${n}${album.title ? ` de ${album.title}` : ''}`;

  return (
    <div class={`tile${selected ? ' is-selected' : ''}`} style={{ aspectRatio: `${photo.w} / ${photo.h}` }}>
      <button type="button" class="tile-select" aria-pressed={selected} aria-label={name} onClick={() => onToggle(key)}>
        <img
          src={photoUrl(album.id, photo.id, 'thumb')}
          width={thumb.w}
          height={thumb.h}
          loading="lazy"
          decoding="async"
          alt=""
        />
        <span class="tile-check" aria-hidden="true">
          {selected && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          )}
        </span>
      </button>
      <button type="button" class="tile-zoom" aria-label={`Ampliar foto ${n}${album.title ? ` de ${album.title}` : ''}`} onClick={() => onZoom(key)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      </button>
    </div>
  );
}
