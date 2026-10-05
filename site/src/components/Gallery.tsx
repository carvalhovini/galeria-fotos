import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { ResolutionId } from '../config';
import { formatDate, loadManifest, type Album } from '../lib/manifest';
import Lightbox from './Lightbox';
import PhotoTile from './PhotoTile';
import SelectionBar from './SelectionBar';
import { photoKey, type PhotoRef } from './types';

type Status = 'loading' | 'error' | 'ready';

const ALL = 'all';
const MOBILE_QUERY = '(max-width: 560px)';
const TABLET_QUERY = '(max-width: 900px)';

function currentColumns() {
  if (typeof window === 'undefined') return 4;
  if (window.matchMedia(MOBILE_QUERY).matches) return 2;
  if (window.matchMedia(TABLET_QUERY).matches) return 3;
  return 4;
}

function useColumns() {
  const [columns, setColumns] = useState(currentColumns);
  useEffect(() => {
    const queries = [MOBILE_QUERY, TABLET_QUERY].map((q) => window.matchMedia(q));
    const update = () => setColumns(currentColumns());
    queries.forEach((q) => q.addEventListener('change', update));
    update();
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return columns;
}

// Cada foto vai para a coluna mais baixa, preservando a ordem aproximada de leitura.
function distribute(items: PhotoRef[], columns: number): PhotoRef[][] {
  const cols = Array.from({ length: columns }, () => ({ height: 0, items: [] as PhotoRef[] }));
  for (const item of items) {
    let target = cols[0];
    for (const col of cols) if (col.height < target.height - 0.001) target = col;
    target.items.push(item);
    target.height += item.photo.h / item.photo.w + 0.06;
  }
  return cols.map((c) => c.items);
}

function readDateParam() {
  return new URLSearchParams(window.location.search).get('data');
}

function writeDateParam(date: string) {
  const url = new URL(window.location.href);
  if (date === ALL) url.searchParams.delete('data');
  else url.searchParams.set('data', date);
  window.history.replaceState(null, '', url);
}

export default function Gallery() {
  const [status, setStatus] = useState<Status>('loading');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState(ALL);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [res, setRes] = useState<ResolutionId>('4k');
  const [viewer, setViewer] = useState<number | null>(null);
  const columns = useColumns();

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus('loading');
    loadManifest(ctrl.signal)
      .then((manifest) => {
        setAlbums(manifest.albums);
        const wanted = readDateParam();
        setFilter(wanted && manifest.albums.some((a) => a.date === wanted) ? wanted : ALL);
        setStatus('ready');
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setStatus('error');
      });
    return () => ctrl.abort();
  }, [attempt]);

  const refsByAlbum = useMemo(() => {
    const map = new Map<string, PhotoRef[]>();
    for (const album of albums) {
      map.set(
        album.id,
        album.photos.map((photo, i) => ({ key: photoKey(album.id, photo.id), album, photo, n: i + 1 })),
      );
    }
    return map;
  }, [albums]);

  const allRefs = useMemo(() => [...refsByAlbum.values()].flat(), [refsByAlbum]);

  const dates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const album of albums) counts.set(album.date, (counts.get(album.date) ?? 0) + album.photos.length);
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [albums]);

  const multiYear = new Set(dates.map(([d]) => d.slice(0, 4))).size > 1;
  const visibleAlbums = useMemo(
    () => (filter === ALL ? albums : albums.filter((a) => a.date === filter)),
    [albums, filter],
  );
  const visibleRefs = useMemo(
    () => visibleAlbums.flatMap((a) => refsByAlbum.get(a.id) ?? []),
    [visibleAlbums, refsByAlbum],
  );
  const selectedRefs = useMemo(() => allRefs.filter((r) => selected.has(r.key)), [allRefs, selected]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAlbum = (refs: PhotoRef[], allOn: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of refs) {
        if (allOn) next.delete(r.key);
        else next.add(r.key);
      }
      return next;
    });
  };

  const zoom = useCallback(
    (key: string) => {
      const index = visibleRefs.findIndex((r) => r.key === key);
      if (index >= 0) setViewer(index);
    },
    [visibleRefs],
  );

  const pickFilter = (date: string) => {
    setFilter(date);
    writeDateParam(date);
  };

  if (status === 'loading') {
    return (
      <div class="gallery-state" role="status">
        <p>Carregando fotos…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div class="gallery-state" role="alert">
        <p>Não foi possível carregar as fotos. Verifique sua conexão.</p>
        <button type="button" class="btn-outline" onClick={() => setAttempt((n) => n + 1)}>
          Tentar de novo
        </button>
      </div>
    );
  }

  if (albums.length === 0) {
    return (
      <div class="gallery-state" role="status">
        <p>Nenhuma foto publicada ainda. Volte em breve!</p>
      </div>
    );
  }

  const total = albums.reduce((sum, a) => sum + a.photos.length, 0);

  return (
    <>
      <section class="filters container" aria-label="Filtrar por data">
        <p class="filters-label">Filtrar por data</p>
        <div class="chips">
          <button type="button" class="chip" aria-pressed={filter === ALL} onClick={() => pickFilter(ALL)}>
            Todas <span class="chip-count">{total}</span>
          </button>
          {dates.map(([date, count]) => (
            <button type="button" key={date} class="chip" aria-pressed={filter === date} onClick={() => pickFilter(date)}>
              {formatDate(date, multiYear)} <span class="chip-count">{count}</span>
            </button>
          ))}
        </div>
      </section>

      <main class="albums container" id="fotos">
        {visibleAlbums.map((album) => {
          const refs = refsByAlbum.get(album.id) ?? [];
          const allOn = refs.length > 0 && refs.every((r) => selected.has(r.key));
          const countText = refs.length === 1 ? '1 foto' : `${refs.length} fotos`;
          return (
            <section class="album" key={album.id} aria-labelledby={`album-${album.id}`}>
              <div class="album-head">
                <div>
                  <h2 id={`album-${album.id}`}>{formatDate(album.date)}</h2>
                  <p class="album-sub">
                    {album.title ? `${album.title} · ` : ''}
                    {countText}
                  </p>
                </div>
                <button
                  type="button"
                  class="btn-outline"
                  aria-label={`${allOn ? 'Desmarcar todas' : 'Selecionar todas'} as fotos de ${album.title || formatDate(album.date)}`}
                  onClick={() => toggleAlbum(refs, allOn)}
                >
                  {allOn ? 'Desmarcar todas' : 'Selecionar todas'}
                </button>
              </div>
              <div class="masonry">
                {distribute(refs, columns).map((col, i) => (
                  <div class="masonry-col" key={i}>
                    {col.map((item) => (
                      <PhotoTile key={item.key} item={item} selected={selected.has(item.key)} onToggle={toggle} onZoom={zoom} />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </main>

      <SelectionBar items={selectedRefs} res={res} onRes={setRes} onClear={() => setSelected(new Set())} />

      <Lightbox
        items={visibleRefs}
        index={viewer}
        onIndex={setViewer}
        isSelected={(key) => selected.has(key)}
        onToggle={toggle}
      />
    </>
  );
}
