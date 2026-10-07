import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SITE, resolutionsFor, type ResolutionId } from '../config';
import { formatDateLong, loadManifest, normalizeTag, type Album } from '../lib/manifest';
import AlbumCards from './AlbumCards';
import AlbumView from './AlbumView';
import { photoKey, type PhotoRef } from './types';

type Status = 'loading' | 'error' | 'ready';

const ALL = 'all';
const EMPTY = new Set<string>();

function readParam(name: string): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);
}

function readTag(): string | null {
  const raw = readParam('tag');
  return raw ? normalizeTag(raw) || null : null;
}

function homeHref(filter: string, tag: string | null) {
  const params = new URLSearchParams();
  if (filter !== ALL) params.set('data', filter);
  if (tag) params.set('tag', tag);
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

const matchesDate = (album: Album, date: string) => date === ALL || album.date === date;
const matchesTag = (album: Album, tag: string | null) => !tag || (album.tags?.includes(tag) ?? false);

export default function Gallery() {
  const [status, setStatus] = useState<Status>('loading');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [albumId, setAlbumId] = useState<string | null>(() => readParam('album'));
  const [filter, setFilter] = useState(() => readParam('data') ?? ALL);
  const [tag, setTag] = useState<string | null>(readTag);
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
      setTag(readTag());
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
  // A escolha fica guardada; num álbum sem o formato do Instagram escolhido, vale 4K.
  const albumRes: ResolutionId = !album || resolutionsFor(album.formats).some((r) => r.id === res) ? res : '4k';

  useEffect(() => {
    if (status !== 'ready') return;
    document.title = album ? `${album.title || formatDateLong(album.date)} | ${SITE.name}` : SITE.title;
  }, [album, status]);

  useLayoutEffect(() => {
    if (status !== 'ready' || pendingScroll.current === null) return;
    window.scrollTo(0, pendingScroll.current);
    pendingScroll.current = null;
  }, [albumId, status]);

  // Todas as tags, das mais usadas para as menos usadas.
  const allTags = useMemo(() => {
    const uses = new Map<string, number>();
    for (const a of albums) for (const t of a.tags ?? []) uses.set(t, (uses.get(t) ?? 0) + 1);
    return [...uses.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [albums]);
  const activeTag = tag && allTags.includes(tag) ? tag : null;
  const activeFilter = albums.some((a) => a.date === filter) ? filter : ALL;

  // Cada linha de chips conta as fotos considerando o filtro da outra linha.
  const dates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of albums) counts.set(a.date, (counts.get(a.date) ?? 0) + (matchesTag(a, activeTag) ? a.photos.length : 0));
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [albums, activeTag]);
  const tags = useMemo<[string, number][]>(
    () => allTags.map((t) => [t, albums.reduce((sum, a) => sum + (matchesDate(a, activeFilter) && matchesTag(a, t) ? a.photos.length : 0), 0)]),
    [albums, allTags, activeFilter],
  );
  const visibleAlbums = albums.filter((a) => matchesDate(a, activeFilter) && matchesTag(a, activeTag));

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
    history.pushState({}, '', homeHref(activeFilter, activeTag));
    pendingScroll.current = 0;
    setAlbumId(null);
  };

  const applyFilters = (date: string, nextTag: string | null) => {
    setFilter(date);
    setTag(nextTag);
    history.replaceState(history.state, '', homeHref(date, nextTag));
  };

  // Se a combinação ficaria vazia, o filtro da outra linha é limpo.
  const pickFilter = (date: string) =>
    applyFilters(date, albums.some((a) => matchesDate(a, date) && matchesTag(a, activeTag)) ? activeTag : null);
  const pickTag = (next: string | null) =>
    applyFilters(albums.some((a) => matchesDate(a, activeFilter) && matchesTag(a, next)) ? activeFilter : ALL, next);

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
        res={albumRes}
        homeHref={homeHref(activeFilter, activeTag)}
        onRes={setRes}
        onSelectionChange={(next) => setSelections((prev) => ({ ...prev, [album.id]: next }))}
        onBack={goHome}
      />
    );
  }

  return (
    <AlbumCards
      albums={visibleAlbums}
      dates={dates}
      tags={tags}
      tagTotal={albums.reduce((sum, a) => sum + (matchesDate(a, activeFilter) ? a.photos.length : 0), 0)}
      filter={activeFilter}
      tag={activeTag}
      allValue={ALL}
      selectedCount={(id) => selections[id]?.size ?? 0}
      onFilter={pickFilter}
      onTag={pickTag}
      onClear={() => applyFilters(ALL, null)}
      onOpen={openAlbum}
    />
  );
}
