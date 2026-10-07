import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Album, AlbumsResponse, DeleteResponse, InboxAlbum, PublishStatus } from '../shared/types';
import AlbumList from './AlbumList';
import AlbumView from './AlbumView';
import { api, finishPurge } from './api';
import { PUBLIC_SITE, plural, usedTags } from './format';
import Notices, { type Notice } from './Notices';
import PublishPanel from './PublishPanel';
import UploadView from './UploadView';

const POLL_BUSY_MS = 5000;
const POLL_IDLE_MS = 30000;

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Algo deu errado. Tente de novo.');

interface Route {
  album: string | null;
  upload: string | null;
}

function routeFromUrl(): Route {
  const params = new URLSearchParams(location.search);
  return { album: params.get('album'), upload: params.get('enviar') };
}

export default function App() {
  const [data, setData] = useState<AlbumsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(routeFromUrl);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [publish, setPublish] = useState<PublishStatus | null>(null);
  const [inbox, setInbox] = useState<InboxAlbum[]>([]);
  const nextId = useRef(1);
  const wasBusy = useRef(false);
  const albumId = route.album;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await api.albums());
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, []);

  const loadInbox = useCallback(async () => {
    try {
      setInbox((await api.inbox()).albums);
    } catch {
      // a lista de envios é secundária; o erro aparece ao tentar agir
    }
  }, []);

  const notify = (kind: Notice['kind'], text: string, retryUrls?: string[]) =>
    setNotices((list) => [{ id: nextId.current++, kind, text, retryUrls }, ...list].slice(0, 5));

  const applyPublish = (s: PublishStatus) => {
    if (wasBusy.current && !s.busy && s.run?.status === 'completed') {
      if (s.run.conclusion === 'success') notify('success', 'Publicação concluída. O site mostra as fotos novas em até 1 minuto.');
      else notify('error', 'A publicação não terminou bem. As fotos continuam na entrada para tentar de novo.');
      void load();
      void loadInbox();
    }
    wasBusy.current = s.busy;
    setPublish(s);
  };

  const refreshPublish = useCallback(async () => {
    try {
      applyPublish(await api.publishStatus());
    } catch {
      // tenta de novo no próximo ciclo
    }
  }, []);

  useEffect(() => {
    load();
    loadInbox();
    refreshPublish();
    const onPop = () => setRoute(routeFromUrl());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [load, loadInbox, refreshPublish]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshPublish();
    }, publish?.busy ? POLL_BUSY_MS : POLL_IDLE_MS);
    return () => clearInterval(timer);
  }, [publish?.busy, refreshPublish]);

  const go = (search: string) => {
    history.pushState(null, '', search || location.pathname);
    setRoute(routeFromUrl());
    scrollTo(0, 0);
  };
  const navigate = (id: string | null) => go(id ? `?album=${encodeURIComponent(id)}` : '');
  const openUpload = (id: string | null) => go(`?enviar=${encodeURIComponent(id ?? 'novo')}`);

  const handlePublish = async (id: string) => {
    applyPublish(await api.publish(id));
    notify('success', 'Publicação iniciada. O andamento aparece aqui; não precisa ficar com a página aberta.');
    if (route.upload) go('');
    void loadInbox();
  };

  const handleDiscard = async (id: string) => {
    const r = await api.discardUpload(id);
    notify('success', `Envio descartado (${plural(r.deleted, 'arquivo apagado', 'arquivos apagados')} da entrada).`);
    await loadInbox();
  };

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

  const saveAlbum = async (patch: Parameters<typeof api.updateAlbum>[1], done: (album: Album) => string) => {
    if (!albumId) return;
    setBusy(true);
    try {
      const r = await api.updateAlbum(albumId, patch);
      replaceAlbum(albumId, r.album);
      notify('success', `${done(r.album)} O site mostra a mudança em até 1 minuto.`);
    } finally {
      setBusy(false);
    }
  };

  const handleRename = (title: string) => saveAlbum({ title }, (a) => `Título alterado para "${a.title}".`);

  const handleSaveTags = (tags: string[]) =>
    saveAlbum({ tags }, (a) => (a.tags?.length ? `Tags salvas: ${a.tags.join(', ')}.` : 'Tags removidas.'));

  const handleSetCover = async (photoId: string) => {
    try {
      await saveAlbum({ cover: photoId }, () => `Capa trocada para ${photoId}.`);
    } catch (err) {
      notify('error', `Não foi possível trocar a capa. ${errorText(err)}`);
      throw err;
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
  const tagSuggestions = useMemo(() => usedTags(data?.albums ?? []), [data]);

  return (
    <>
      <header class="container admin-header">
        <span class="brand">
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="#FF6A2B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="8" width="22" height="15" rx="3" />
            <path d="M10 8l1.8-3h4.4L18 8" />
            <circle cx="14" cy="15.5" r="4.5" />
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
        ) : route.upload ? (
          <UploadView
            key={route.upload}
            albums={data.albums}
            initialId={route.upload}
            publish={publish}
            onBack={() => go('')}
            onPublish={handlePublish}
            onChanged={() => void loadInbox()}
          />
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
            lockMessage={publish?.busy ? (publish.message ?? 'Publicação em andamento.') : null}
            tagSuggestions={tagSuggestions}
            onBack={() => navigate(null)}
            onAddPhotos={() => openUpload(album.id)}
            onRename={handleRename}
            onSetCover={handleSetCover}
            onSaveTags={handleSaveTags}
            onDeletePhotos={handleDeletePhotos}
            onDeleteAlbum={handleDeleteAlbum}
          />
        ) : (
          <>
            <PublishPanel
              publish={publish}
              inbox={inbox}
              albums={data.albums}
              onNew={() => openUpload(null)}
              onContinue={openUpload}
              onPublish={handlePublish}
              onDiscard={handleDiscard}
            />
            <AlbumList albums={data.albums} base={data.publicBaseUrl} onOpen={navigate} />
          </>
        )}
      </main>

      <footer class="container admin-footer">{data?.user ? `Conectado como ${data.user}` : 'Acesso protegido pelo Cloudflare Access'}</footer>

      <p class={`busy-status${status ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}
