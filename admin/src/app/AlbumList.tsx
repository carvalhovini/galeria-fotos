import type { Album } from '../shared/types';
import { coverId, formatDate, plural, thumbUrl } from './format';

interface Props {
  albums: Album[];
  base: string;
  onOpen: (id: string) => void;
}

export default function AlbumList({ albums, base, onOpen }: Props) {
  const photos = albums.reduce((sum, a) => sum + a.photos.length, 0);

  return (
    <section aria-labelledby="albums-title">
      <h1 id="albums-title" class="page-title">
        Álbuns
      </h1>
      <p class="page-sub">
        {plural(albums.length, 'álbum publicado', 'álbuns publicados')} · {plural(photos, 'foto', 'fotos')}
      </p>

      {albums.length === 0 ? (
        <p class="empty">Nenhum álbum publicado ainda.</p>
      ) : (
        <ul class="album-list">
          {albums.map((album) => {
            const cover = coverId(album);
            const strip = [...album.photos.filter((p) => p.id === cover), ...album.photos.filter((p) => p.id !== cover)].slice(0, 4);
            return (
            <li key={album.id}>
              <a
                class="album-card"
                href={`?album=${encodeURIComponent(album.id)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  onOpen(album.id);
                }}
              >
                <span class="album-strip" aria-hidden="true">
                  {strip.map((p) => (
                    <img key={p.id} src={thumbUrl(base, album.id, p.id)} alt="" loading="lazy" width={120} height={120} />
                  ))}
                </span>
                <span class="album-card-text">
                  <span class="album-card-date">{formatDate(album.date)}</span>
                  <span class="album-card-title">{album.title}</span>
                  <span class="album-card-count">{plural(album.photos.length, 'foto', 'fotos')}</span>
                  {album.tags?.length ? <span class="album-card-tags">Tags: {album.tags.join(', ')}</span> : null}
                </span>
              </a>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
