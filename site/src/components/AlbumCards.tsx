import { coverPhoto, formatDate, formatDateLong, photoCount, photoUrl, scaledSize, type Album } from '../lib/manifest';

interface Props {
  albums: Album[];
  dates: [string, number][];
  filter: string;
  allValue: string;
  selectedCount: (albumId: string) => number;
  onFilter: (date: string) => void;
  onOpen: (albumId: string) => void;
}

export default function AlbumCards({ albums, dates, filter, allValue, selectedCount, onFilter, onOpen }: Props) {
  const multiYear = new Set(dates.map(([d]) => d.slice(0, 4))).size > 1;
  const visible = filter === allValue ? albums : albums.filter((a) => a.date === filter);
  const total = albums.reduce((sum, a) => sum + a.photos.length, 0);

  return (
    <>
      <section class="filters container" aria-label="Filtrar por data">
        <p class="filters-label">Filtrar por data</p>
        <div class="chips">
          <button type="button" class="chip" aria-pressed={filter === allValue} onClick={() => onFilter(allValue)}>
            Todas <span class="chip-count">{total}</span>
          </button>
          {dates.map(([date, count]) => (
            <button type="button" key={date} class="chip" aria-pressed={filter === date} onClick={() => onFilter(date)}>
              {formatDate(date, multiYear)} <span class="chip-count">{count}</span>
            </button>
          ))}
        </div>
      </section>

      <main class="container album-cards" id="fotos">
        <h2 class="visually-hidden">Álbuns</h2>
        <ul class="cards-grid">
          {visible.map((album, i) => {
            const cover = coverPhoto(album);
            const size = scaledSize(cover, 900);
            const picked = selectedCount(album.id);
            const name = album.title || formatDateLong(album.date);
            return (
              <li key={album.id}>
                <a
                  class="album-card"
                  href={`?album=${encodeURIComponent(album.id)}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    onOpen(album.id);
                  }}
                >
                  <span class="album-cover">
                    <img
                      src={photoUrl(album.id, cover.id, 'thumb')}
                      width={size.w}
                      height={size.h}
                      loading={i < 2 ? 'eager' : 'lazy'}
                      fetchpriority={i === 0 ? 'high' : undefined}
                      decoding="async"
                      alt=""
                    />
                    {picked > 0 && <span class="album-picked">{picked === 1 ? '1 selecionada' : `${picked} selecionadas`}</span>}
                  </span>
                  <span class="album-card-body">
                    <span class="album-card-title">{name}</span>
                    <span class="album-card-meta">
                      {album.title ? `${formatDateLong(album.date)} · ` : ''}
                      {photoCount(album.photos.length)}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
