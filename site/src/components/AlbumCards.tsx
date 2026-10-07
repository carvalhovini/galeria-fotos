import { coverPhoto, formatDate, formatDateLong, photoCount, photoUrl, scaledSize, type Album } from '../lib/manifest';

interface Props {
  // Álbuns que passam pelos dois filtros.
  albums: Album[];
  dates: [string, number][];
  tags: [string, number][];
  // Fotos com o filtro de data atual, sem filtro de tag.
  tagTotal: number;
  filter: string;
  tag: string | null;
  allValue: string;
  selectedCount: (albumId: string) => number;
  onFilter: (date: string) => void;
  onTag: (tag: string | null) => void;
  onClear: () => void;
  onOpen: (albumId: string) => void;
}

const chipClass = (count: number) => (count === 0 ? 'chip is-empty' : 'chip');

export default function AlbumCards({ albums, dates, tags, tagTotal, filter, tag, allValue, selectedCount, onFilter, onTag, onClear, onOpen }: Props) {
  const multiYear = new Set(dates.map(([d]) => d.slice(0, 4))).size > 1;
  const dateTotal = dates.reduce((sum, [, n]) => sum + n, 0);

  return (
    <>
      <section class="filters container" aria-label="Filtrar por data">
        <p class="filters-label">Filtrar por data</p>
        <div class="chips">
          <button type="button" class="chip" aria-pressed={filter === allValue} onClick={() => onFilter(allValue)}>
            Todas <span class="chip-count">{dateTotal}</span>
          </button>
          {dates.map(([date, count]) => (
            <button type="button" key={date} class={chipClass(count)} aria-pressed={filter === date} onClick={() => onFilter(date)}>
              {formatDate(date, multiYear)} <span class="chip-count">{count}</span>
            </button>
          ))}
        </div>
      </section>

      {tags.length > 0 && (
        <section class="filters filters-tags container" aria-label="Filtrar por tag">
          <p class="filters-label">Filtrar por tag</p>
          <div class="chips">
            <button type="button" class="chip" aria-pressed={tag === null} onClick={() => onTag(null)}>
              Todas <span class="chip-count">{tagTotal}</span>
            </button>
            {tags.map(([name, count]) => (
              <button type="button" key={name} class={chipClass(count)} aria-pressed={tag === name} onClick={() => onTag(name)}>
                {name} <span class="chip-count">{count}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <main class="container album-cards" id="fotos">
        <h2 class="visually-hidden">Álbuns</h2>
        {albums.length === 0 && (
          <div class="gallery-state filters-empty" role="status">
            <p>Nenhum álbum com esses filtros.</p>
            <button type="button" class="btn-outline" onClick={onClear}>
              Limpar filtros
            </button>
          </div>
        )}
        <ul class="cards-grid">
          {albums.map((album, i) => {
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
