import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SITE, type ResolutionId } from '../config';
import { formatDateLong, loadManifest, type Album } from '../lib/manifest';
import AlbumCards from './AlbumCards';
import AlbumView from './AlbumView';
import { photoKey, type PhotoRef } from './types';

type Status = 'loading' | 'error' | 'ready';

const ALL = 'all';
const EMPTY = new Set<string>();

function readParam(name: string): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);
}

function homeHref(filter: string) {
  return filter === ALL ? '/' : `/?data=${encodeURIComponent(filter)}`;
}

export default function Gallery() {
  const [status, setStatus] = useState<Status>('loading');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [albumId, setAlbumId] = useState<string | null>(() => readParam('album'));
  const [filter, setFilter] = useState(() => readParam('data') ?? ALL);
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [res, setRes] = useState<ResolutionId>('4k');
  const albumIdRef = useRef(albumId);
  const pendingScroll = useRef<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus('loading');
    loadManifest(ctrl.signal)
      .then((manifest) => {
        setAlbums(manifest.albums);
        setStatus('ready');
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setStatus('error');
      });
    return () => ctrl.abort();
  }, [attempt]);

  useEffect(() => {
    history.scrollRestoration = 'manual';
    const onPop = (e: PopStateEvent) => {
      const id = readParam('album');
      // Navegação por âncora (#apoie) também dispara popstate: só reage se o álbum mudou.
      if (id === albumIdRef.current) return;
      pendingScroll.current = id ? 0 : (e.state?.scrollY ?? 0);
      setFilter(readParam('data') ?? ALL);
      setAlbumId(id);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // Precisa rodar antes de restaurar a rolagem: o topo aparece ou some conforme a tela.
  useLayoutEffect(() => {
    albumIdRef.current = albumId;
    document.documentElement.dataset.view = albumId ? 'album' : 'home';
  }, [albumId]);

  const album = albumId ? albums.find((a) => a.id === albumId) : undefined;

  useEffect(() => {
    if (status !== 'ready') return;
    document.title = album ? `${album.title || formatDateLong(album.date)} | ${SITE.name}` : SITE.title;
  }, [album, status]);

  useLayoutEffect(() => {
    if (status !== 'ready' || pendingScroll.current === null) return;
    window.scrollTo(0, pendingScroll.current);
    pendingScroll.current = null;
  }, [albumId, status]);

  const dates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of albums) counts.set(a.date, (counts.get(a.date) ?? 0) + a.photos.length);
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [albums]);
  const activeFilter = dates.some(([d]) => d === filter) ? filter : ALL;

  const refs = useMemo<PhotoRef[]>(
    () => (album ? album.photos.map((photo, i) => ({ key: photoKey(album.id, photo.id), album, photo, n: i + 1 })) : []),
    [album],
  );

  const openAlbum = (id: string) => {
    history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
    history.pushState({ album: id, fromHome: true }, '', `?album=${encodeURIComponent(id)}`);
    pendingScroll.current = 0;
    setAlbumId(id);
  };

  const goHome = () => {
    if (history.state?.fromHome) {
      history.back();
      return;
    }
    history.pushState({}, '', homeHref(activeFilter));
    pendingScroll.current = 0;
    setAlbumId(null);
  };

  const pickFilter = (date: string) => {
    setFilter(date);
    history.replaceState(history.state, '', homeHref(date));
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

  if (albumId && !album) {
    return (
      <div class="gallery-state" role="alert">
        <p>Álbum não encontrado. Ele pode ter sido removido.</p>
        <a class="btn-outline" href="/" onClick={(e) => (e.preventDefault(), goHome())}>
          Ver todos os álbuns
        </a>
      </div>
    );
  }

  if (album) {
    return (
      <AlbumView
        key={album.id}
        album={album}
        refs={refs}
        selected={selections[album.id] ?? EMPTY}
        res={res}
        homeHref={homeHref(activeFilter)}
        onRes={setRes}
        onSelectionChange={(next) => setSelections((prev) => ({ ...prev, [album.id]: next }))}
        onBack={goHome}
      />
    );
  }

  return (
    <AlbumCards
      albums={albums}
      dates={dates}
      filter={activeFilter}
      allValue={ALL}
      selectedCount={(id) => selections[id]?.size ?? 0}
      onFilter={pickFilter}
      onOpen={openAlbum}
    />
  );
}
