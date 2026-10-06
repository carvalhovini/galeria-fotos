import { useEffect, useRef, useState } from 'preact/hooks';
import { ALBUM_ID_RE, TITLE_MAX, slugify, type Album, type PublishStatus, type UploadListResponse } from '../shared/types';
import { api } from './api';
import { formatDate, formatSize, normalizeTitle, plural } from './format';
import { Uploader, type UploadItem } from './uploader';

interface Props {
  albums: Album[];
  initialId: string | null;
  publish: PublishStatus | null;
  onBack: () => void;
  onPublish: (albumId: string) => Promise<void>;
  onChanged: () => void;
}

type WakeState = 'off' | 'on' | 'failed';

const wakeSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Algo deu errado. Tente de novo.');

function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const STATUS_LABEL: Record<UploadItem['status'], string> = {
  waiting: 'Na fila',
  uploading: 'Enviando',
  retrying: 'Tentando de novo',
  done: 'Enviada',
  skipped: 'Pulada',
  failed: 'Falhou',
  rejected: 'Recusada',
};

export default function UploadView({ albums, initialId, publish, onBack, onPublish, onChanged }: Props) {
  const [phase, setPhase] = useState<'form' | 'loading' | 'files'>(initialId && initialId !== 'novo' ? 'loading' : 'form');
  const [date, setDate] = useState(() => (initialId && ALBUM_ID_RE.test(initialId) ? initialId.slice(0, 10) : today()));
  const [title, setTitle] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [server, setServer] = useState<UploadListResponse | null>(null);
  const [stopMessage, setStopMessage] = useState<string | null>(null);
  const [wake, setWake] = useState<WakeState>('off');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const uploaderRef = useRef<Uploader | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploader = uploaderRef.current;
  const running = uploader?.running ?? false;
  const locked = publish?.busy ?? false;
  const existing = albumId ? albums.find((a) => a.id === albumId) : undefined;

  // Álbum publicado sem envio aberto: os metadados só são gravados ao começar a enviar, para
  // não deixar um envio vazio na entrada se a pessoa desistir.
  const openAlbum = async (id: string) => {
    const current = await api.uploadList(id);
    const published = albums.find((a) => a.id === id);
    if (!current.meta && !published) {
      setDate(id.slice(0, 10));
      setPhase('form');
      return;
    }
    uploaderRef.current?.cancel();
    uploaderRef.current = new Uploader(
      id,
      () => setTick((n) => n + 1),
      (message) => setStopMessage(message),
    );
    setServer(current);
    setAlbumId(id);
    setTitle(current.meta?.title ?? published?.title ?? '');
    history.replaceState(null, '', `?enviar=${encodeURIComponent(id)}`);
    setPhase('files');
  };

  useEffect(() => {
    if (initialId && initialId !== 'novo') {
      openAlbum(initialId).catch((err) => {
        setFormError(errorText(err));
        setPhase('form');
      });
    }
    return () => uploaderRef.current?.cancel();
  }, []);

  // Tela acesa durante o envio. O sistema solta o bloqueio quando a aba fica oculta, então
  // ele é pedido de novo ao voltar.
  useEffect(() => {
    const acquire = async () => {
      if (!wakeSupported || wakeRef.current) return;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        wakeRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeRef.current === sentinel) wakeRef.current = null;
        });
        setWake('on');
      } catch {
        setWake('failed');
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && running) void acquire();
    };
    if (running) {
      void acquire();
      document.addEventListener('visibilitychange', onVisible);
    } else if (wakeRef.current) {
      void wakeRef.current.release();
      wakeRef.current = null;
      setWake((w) => (w === 'on' ? 'off' : w));
    }
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    addEventListener('beforeunload', onBeforeUnload);
    return () => removeEventListener('beforeunload', onBeforeUnload);
  }, [running]);

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) onChanged();
    wasRunning.current = running;
  }, [running]);

  const slug = slugify(normalizeTitle(title));
  const newId = slug ? `${date}_${slug}` : null;
  const formExisting = newId ? albums.find((a) => a.id === newId) : undefined;

  const submitForm = async () => {
    const t = normalizeTitle(title);
    if (!t) return setFormError('Digite um título.');
    if (t.includes('—')) return setFormError('Não use travessão (—) no título.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setFormError('Escolha a data do jogo.');
    if (!newId || !ALBUM_ID_RE.test(newId)) return setFormError('O título precisa ter letras ou números.');
    setSaving(true);
    setFormError(null);
    try {
      await api.putMeta(newId, t);
      await openAlbum(newId);
      onChanged();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const items = uploader?.items ?? [];
  const totals = { waiting: 0, active: 0, done: 0, skipped: 0, failed: 0, rejected: 0, bytes: 0, sent: 0 };
  for (const i of items) {
    if (i.status === 'waiting') totals.waiting++;
    else if (i.status === 'uploading' || i.status === 'retrying') totals.active++;
    else totals[i.status]++;
    if (i.status !== 'skipped' && i.status !== 'rejected') {
      totals.bytes += i.size;
      totals.sent += i.loaded;
    }
  }

  const back = () => {
    if (running && !confirm('O envio será interrompido. As fotos que já subiram continuam salvas. Sair mesmo?')) return;
    uploaderRef.current?.cancel();
    onBack();
  };

  const pick = (files: FileList | null) => {
    if (!files || !uploader || !server) return;
    setStopMessage(null);
    const doneNames = uploader.items.filter((i) => i.status === 'done').map((i) => ({ name: i.name!, size: i.size }));
    uploader.addFiles([...files], [...server.files, ...doneNames], new Set(server.published));
    if (inputRef.current) inputRef.current.value = '';
  };

  const ensureMeta = async (): Promise<boolean> => {
    if (!server || !albumId || server.meta) return true;
    try {
      const meta = await api.putMeta(albumId, title);
      setServer({ ...server, meta });
      onChanged();
      return true;
    } catch (err) {
      setStopMessage(errorText(err));
      return false;
    }
  };

  const start = async () => {
    setStopMessage(null);
    if (await ensureMeta()) void uploader?.start();
  };

  const retry = async () => {
    setStopMessage(null);
    if (await ensureMeta()) void uploader?.retryFailed();
  };

  const publishNow = async () => {
    if (!albumId) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await onPublish(albumId);
    } catch (err) {
      setPublishError(errorText(err));
      setPublishing(false);
    }
  };

  const backLink = (
    <a
      class="back"
      href="./"
      onClick={(e) => {
        e.preventDefault();
        back();
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      Todos os álbuns
    </a>
  );

  if (phase === 'loading') {
    return (
      <section>
        {backLink}
        <p class="state" role="status">
          Carregando o envio…
        </p>
      </section>
    );
  }

  if (phase === 'form') {
    return (
      <section aria-labelledby="upload-title">
        {backLink}
        <h1 id="upload-title" class="page-title">
          Novo álbum
        </h1>
        <p class="page-sub">As fotos vão para uma área de entrada privada. Elas só aparecem no site depois de publicar.</p>
        <form
          class="upload-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitForm();
          }}
        >
          <label for="upload-date">Data do jogo</label>
          <input id="upload-date" type="date" value={date} required onInput={(e) => setDate(e.currentTarget.value)} />
          <label for="upload-name">Título</label>
          <input
            id="upload-name"
            type="text"
            value={title}
            maxLength={TITLE_MAX}
            placeholder="Ex.: Final do estadual"
            autoComplete="off"
            onInput={(e) => setTitle(e.currentTarget.value)}
            aria-describedby="upload-id"
          />
          <p id="upload-id" class="field-hint">
            {newId ? (
              <>
                Endereço do álbum: <code>{newId}</code>
              </>
            ) : (
              'O endereço do álbum é gerado a partir da data e do título.'
            )}
          </p>
          {formExisting && (
            <p class="warn-text">
              Já existe o álbum "{formExisting.title}" com esse endereço. As fotos novas serão juntadas a ele, mantendo título e capa.
            </p>
          )}
          {formError && (
            <p class="form-error" role="alert">
              {formError}
            </p>
          )}
          <button type="submit" class="btn-primary" disabled={saving || locked}>
            {saving ? 'Criando…' : 'Continuar e escolher fotos'}
          </button>
          {locked && <p class="warn-text">{publish?.message} Novos envios ficam bloqueados até a publicação terminar.</p>}
        </form>
      </section>
    );
  }

  const toSend = totals.waiting + totals.active + totals.done + totals.failed;
  const inboxCount = (server?.files.length ?? 0) + totals.done;
  const canPublish = !running && totals.waiting === 0 && totals.failed === 0 && totals.active === 0 && inboxCount > 0;
  const percent = totals.bytes ? Math.round((totals.sent / totals.bytes) * 100) : 0;

  return (
    <section aria-labelledby="upload-title" class="upload">
      {backLink}
      <h1 id="upload-title" class="page-title">
        {existing ? 'Adicionar fotos' : 'Enviar fotos'}
      </h1>
      <p class="page-sub">
        {title || albumId} · {albumId ? formatDate(albumId.slice(0, 10)) : ''}
        <br />
        <code>{albumId}</code>
      </p>

      {(server?.files.length ?? 0) > 0 && (
        <p class="upload-info">
          {plural(server!.files.length, 'foto já está', 'fotos já estão')} na entrada (
          {formatSize(server!.files.reduce((s, f) => s + f.size, 0))}). Ao escolher as mesmas fotos de novo, elas são puladas.
        </p>
      )}

      {running && (
        <div class="upload-alert" role="status">
          <strong>Não saia desta página nem bloqueie o celular até terminar.</strong> Se sair, o envio para; é só voltar aqui e escolher as mesmas fotos.
          {wake === 'on' && <span class="muted"> A tela vai ficar acesa durante o envio.</span>}
        </div>
      )}
      {(!wakeSupported || (running && wake === 'failed')) && (
        <p class="warn-text" role="alert">
          Este navegador não consegue manter a tela acesa. Toque na tela de vez em quando ou aumente o tempo de bloqueio automático do celular.
        </p>
      )}
      {stopMessage && (
        <p class="form-error" role="alert">
          {stopMessage}
        </p>
      )}
      {locked && !running && <p class="warn-text">{publish?.message} Novos envios ficam bloqueados até a publicação terminar.</p>}

      <div class="upload-actions">
        <label class={`btn-outline file-pick${running || locked ? ' is-disabled' : ''}`}>
          <input
            ref={inputRef}
            class="visually-hidden"
            type="file"
            multiple
            accept=".jpg,.jpeg,image/jpeg"
            disabled={running || locked}
            onChange={(e) => pick(e.currentTarget.files)}
          />
          {items.length ? 'Escolher mais fotos' : 'Escolher fotos'}
        </label>
        {!running && totals.waiting > 0 && (
          <button type="button" class="btn-primary" onClick={start} disabled={locked}>
            Enviar {plural(totals.waiting, 'foto', 'fotos')}
          </button>
        )}
        {running && (
          <button type="button" class="btn-outline" onClick={() => uploader?.cancel()}>
            Parar envio
          </button>
        )}
        {!running && totals.failed > 0 && (
          <button type="button" class="btn-primary" onClick={retry} disabled={locked}>
            Reenviar as que falharam ({totals.failed})
          </button>
        )}
      </div>

      {toSend > 0 && (
        <div class="upload-total">
          <p>
            <strong>
              {totals.done} de {toSend} {toSend === 1 ? 'foto enviada' : 'fotos enviadas'}
            </strong>
            <span class="muted">
              {' '}
              · {formatSize(totals.sent)} de {formatSize(totals.bytes)} ({percent}%)
            </span>
          </p>
          <progress max={totals.bytes || 1} value={totals.sent} aria-label="Progresso geral do envio" />
          {(totals.skipped > 0 || totals.rejected > 0) && (
            <p class="muted small">
              {totals.skipped > 0 &&
                (totals.skipped === 1 ? '1 pulada (já estava na entrada ou publicada). ' : `${totals.skipped} puladas (já estavam na entrada ou publicadas). `)}
              {totals.rejected > 0 &&
                (totals.rejected === 1 ? '1 recusada (não é JPEG ou é grande demais).' : `${totals.rejected} recusadas (não são JPEG ou são grandes demais).`)}
            </p>
          )}
        </div>
      )}

      {canPublish && (
        <div class="publish-box">
          <p>
            {plural(inboxCount, 'foto pronta', 'fotos prontas')} na entrada. Publicar processa as fotos, coloca a marca d'água e atualiza o
            site. Leva alguns minutos e não precisa ficar nesta página.
          </p>
          {publish && !publish.configured && <p class="warn-text">A publicação pelo GitHub não está configurada neste gerenciador.</p>}
          {publishError && (
            <p class="form-error" role="alert">
              {publishError}
            </p>
          )}
          <button type="button" class="btn-primary" onClick={publishNow} disabled={publishing || locked || !publish?.configured}>
            {publishing ? 'Disparando…' : 'Publicar agora'}
          </button>
        </div>
      )}

      {items.length > 0 && (
        <ul class="upload-list">
          {items.map((item) => (
            <li key={item.key} class={`upload-item is-${item.status}`}>
              <div class="upload-item-head">
                <span class="upload-name">
                  {item.original}
                  {item.name && item.name !== item.original && <span class="muted"> → {item.name}</span>}
                </span>
                <span class="upload-status">
                  {STATUS_LABEL[item.status]}
                  {item.status === 'uploading' && item.size ? ` ${Math.round((item.loaded / item.size) * 100)}%` : ''}
                </span>
              </div>
              {(item.status === 'uploading' || item.status === 'retrying') && (
                <progress max={item.size || 1} value={item.loaded} aria-label={`Progresso de ${item.original}`} />
              )}
              {item.message && <p class="upload-msg">{item.message}</p>}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <details class="upload-diag">
          <summary>Conferir se o celular mandou as fotos originais</summary>
          <p class="muted small">
            Compare com a foto original: se as dimensões forem menores ou não houver data EXIF, o celular reduziu ou converteu a foto
            antes de enviar.
          </p>
          <div class="diag-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Arquivo</th>
                  <th scope="col">Tamanho</th>
                  <th scope="col">Dimensões</th>
                  <th scope="col">Data EXIF</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key}>
                    <td>{item.original}</td>
                    <td>{formatSize(item.size)}</td>
                    <td>{item.info?.width ? `${item.info.width} × ${item.info.height}` : '?'}</td>
                    <td>
                      {item.info
                        ? (item.info.takenAt ?? (item.info.exif ? 'sem data' : 'sem EXIF'))
                        : item.status === 'rejected'
                          ? 'não lido'
                          : '…'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
