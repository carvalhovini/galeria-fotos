import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Album, AlbumsResponse, DeleteResponse } from '../shared/types';
import AlbumList from './AlbumList';
import AlbumView from './AlbumView';
import { api, finishPurge } from './api';
import { plural } from './format';
import Notices, { type Notice } from './Notices';

const PUBLIC_SITE = 'https://carvalhovini.com';

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Algo deu errado. Tente de novo.');
const albumFromUrl = () => new URLSearchParams(location.search).get('album');

export default function App() {
  const [data, setData] = useState<AlbumsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [albumId, setAlbumId] = useState<string | null>(albumFromUrl);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [retrying, setRetrying] = useState<number | null>(null);
  const nextId = useRef(1);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await api.albums());
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, []);

  useEffect(() => {
    load();
    const onPop = () => setAlbumId(albumFromUrl());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [load]);

  const navigate = (id: string | null) => {
    history.pushState(null, '', id ? `?album=${encodeURIComponent(id)}` : location.pathname);
    setAlbumId(id);
    scrollTo(0, 0);
  };

  const notify = (kind: Notice['kind'], text: string, retryUrls?: string[]) =>
    setNotices((list) => [{ id: nextId.current++, kind, text, retryUrls }, ...list].slice(0, 5));

  const replaceAlbum = (id: string, album: Album | null) =>
    setData((d) => d && { ...d, albums: album ? d.albums.map((a) => (a.id === id ? album : a)) : d.albums.filter((a) => a.id !== id) });

  // Roda depois que o diálogo fecha: continua o purge pendente e resume tudo num aviso.
  const finishDelete = async (r: DeleteResponse, done: string) => {
    try {
      setStatus('Limpando o cache da Cloudflare…');
      const purge = await finishPurge(r.purge, (n, total) => setStatus(`Limpando o cache: ${n} de ${total} arquivos`));
      if (r.deleteErrors > 0) {
        notify(
          'error',
          `${plural(r.deleteErrors, 'arquivo não pôde ser apagado', 'arquivos não puderam ser apagados')} do bucket. Já não aparecem no site, mas continuam guardados.`,
        );
      }
      if (purge.failed.length > 0) {
        notify('success', done);
        notify(
          'warning',
          `O cache NÃO foi limpo para ${plural(purge.failed.length, 'arquivo', 'arquivos')}: as fotos excluídas podem continuar abrindo pelo link direto até o cache expirar. ${purge.message ?? ''}`.trim(),
          purge.configured ? purge.failed : undefined,
        );
      } else {
        notify('success', `${done} Cache limpo.`);
      }
    } finally {
      setStatus('');
      setBusy(false);
    }
  };

  const handleRename = async (title: string) => {
    if (!albumId) return;
    setBusy(true);
    try {
      const r = await api.rename(albumId, title);
      replaceAlbum(albumId, r.album);
      notify('success', `Título alterado para "${r.album.title}". O site mostra o novo título em até 1 minuto.`);
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePhotos = async (ids: string[]) => {
    if (!albumId) return;
    setBusy(true);
    let r: DeleteResponse;
    try {
      r = await api.deletePhotos(albumId, ids);
    } catch (err) {
      setBusy(false);
      throw err;
    }
    replaceAlbum(albumId, r.album);
    if (r.albumRemoved) navigate(null);
    const label = plural(ids.length, 'foto excluída.', 'fotos excluídas.');
    void finishDelete(r, r.albumRemoved ? `${label} O álbum ficou vazio e saiu do site.` : label);
  };

  const handleDeleteAlbum = async (confirmTitle: string) => {
    if (!albumId) return;
    const title = data?.albums.find((a) => a.id === albumId)?.title ?? albumId;
    setBusy(true);
    let r: DeleteResponse;
    try {
      r = await api.deleteAlbum(albumId, confirmTitle);
    } catch (err) {
      setBusy(false);
      throw err;
    }
    replaceAlbum(albumId, null);
    navigate(null);
    void finishDelete(r, `Álbum "${title}" excluído (${plural(r.deletedObjects, 'arquivo apagado', 'arquivos apagados')}).`);
  };

  const handleRetry = async (notice: Notice) => {
    if (!notice.retryUrls) return;
    setRetrying(notice.id);
    try {
      const r = await finishPurge({ configured: true, purged: [], failed: [], pending: notice.retryUrls }, () => {});
      setNotices((list) =>
        list.map((n): Notice => {
          if (n.id !== notice.id) return n;
          if (r.failed.length === 0) return { id: n.id, kind: 'success', text: 'Cache limpo.' };
          return {
            ...n,
            text: `O cache ainda NÃO foi limpo para ${plural(r.failed.length, 'arquivo', 'arquivos')}. ${r.message ?? ''}`.trim(),
            retryUrls: r.failed,
          };
        }),
      );
    } finally {
      setRetrying(null);
    }
  };

  const album = albumId ? data?.albums.find((a) => a.id === albumId) : undefined;

  return (
    <>
      <header class="container admin-header">
        <span class="brand">
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="#FF6A2B" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="14" cy="14" r="11" />
            <path d="M3 14h22M14 3v22M6 6c4 3 4 13 0 16M22 6c-4 3-4 13 0 16" />
          </svg>
          <span class="brand-name">carvalho_.vini</span>
          <span class="badge">Gerenciador</span>
        </span>
        <a class="pill" href={PUBLIC_SITE} target="_blank" rel="noopener">
          Ver site
        </a>
      </header>

      <main class="container admin-main">
        <Notices notices={notices} retrying={retrying} onDismiss={(id) => setNotices((l) => l.filter((n) => n.id !== id))} onRetry={handleRetry} />

        {loadError ? (
          <div class="state" role="alert">
            <p>Não foi possível carregar os álbuns. {loadError}</p>
            <button type="button" class="btn-primary" onClick={load}>
              Tentar de novo
            </button>
          </div>
        ) : !data ? (
          <p class="state" role="status">
            Carregando álbuns…
          </p>
        ) : albumId && !album ? (
          <div class="state">
            <p>Álbum não encontrado. Talvez já tenha sido excluído.</p>
            <button type="button" class="btn-outline" onClick={() => navigate(null)}>
              Ver todos os álbuns
            </button>
          </div>
        ) : album ? (
          <AlbumView
            key={album.id}
            album={album}
            base={data.publicBaseUrl}
            busy={busy}
            onBack={() => navigate(null)}
            onRename={handleRename}
            onDeletePhotos={handleDeletePhotos}
            onDeleteAlbum={handleDeleteAlbum}
          />
        ) : (
          <AlbumList albums={data.albums} base={data.publicBaseUrl} onOpen={navigate} />
        )}
      </main>

      <footer class="container admin-footer">{data?.user ? `Conectado como ${data.user}` : 'Acesso protegido pelo Cloudflare Access'}</footer>

      <p class={`busy-status${status ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}
