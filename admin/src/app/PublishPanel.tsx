import { useState } from 'preact/hooks';
import type { Album, InboxAlbum, PublishRun, PublishStatus } from '../shared/types';
import ConfirmDialog from './ConfirmDialog';
import { formatDate, formatSize, plural } from './format';

interface Props {
  publish: PublishStatus | null;
  inbox: InboxAlbum[];
  albums: Album[];
  onNew: () => void;
  onContinue: (albumId: string) => void;
  onPublish: (albumId: string) => Promise<void>;
  onDiscard: (albumId: string) => Promise<void>;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Algo deu errado. Tente de novo.');

function runLabel(run: PublishRun, name: string | null): { text: string; tone: 'active' | 'ok' | 'bad' } {
  const album = name ? ` de "${name}"` : '';
  if (run.status === 'completed') {
    if (run.conclusion === 'success') return { text: `Publicação${album} concluída.`, tone: 'ok' };
    if (run.conclusion === 'cancelled') return { text: `Publicação${album} cancelada.`, tone: 'bad' };
    return { text: `Publicação${album} falhou${run.step ? ` em "${run.step}"` : ''}. As fotos continuam na entrada.`, tone: 'bad' };
  }
  if (run.status === 'in_progress') {
    const step = run.step ? `: ${run.step}` : '';
    const count = run.stepsTotal ? ` (passo ${Math.min(run.stepsDone + 1, run.stepsTotal)} de ${run.stepsTotal})` : '';
    return { text: `Publicando${name ? ` "${name}"` : ''}${step}${count}.`, tone: 'active' };
  }
  return { text: `Publicação${album} na fila.`, tone: 'active' };
}

const RECENT_MS = 24 * 60 * 60 * 1000;

export default function PublishPanel({ publish, inbox, albums, onNew, onContinue, onPublish, onDiscard }: Props) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<InboxAlbum | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const busy = publish?.busy ?? false;
  const run = publish?.run;
  const showRun = run && (run.status !== 'completed' || Date.now() - Date.parse(run.updatedAt) < RECENT_MS);
  const runAlbum = run?.albumId ?? null;
  const runName = runAlbum ? (inbox.find((a) => a.albumId === runAlbum)?.title ?? albums.find((a) => a.id === runAlbum)?.title ?? runAlbum) : null;
  const label = run ? runLabel(run, runName) : null;

  const publishOne = async (id: string) => {
    setWorking(id);
    setError(null);
    try {
      await onPublish(id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setWorking(null);
    }
  };

  const confirmDiscard = async () => {
    if (!discarding) return;
    setWorking(discarding.albumId);
    setDialogError(null);
    try {
      await onDiscard(discarding.albumId);
      setDiscarding(null);
    } catch (err) {
      setDialogError(errorText(err));
    } finally {
      setWorking(null);
    }
  };

  return (
    <section class="publish-panel" aria-labelledby="inbox-title">
      <div class="panel-head">
        <h2 id="inbox-title">Envios</h2>
        <button type="button" class="btn-primary" onClick={onNew} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Novo álbum
        </button>
      </div>

      {showRun && label && (
        <div class={`run-status is-${label.tone}`} role="status">
          {label.tone === 'active' && <span class="spinner" aria-hidden="true" />}
          <p>
            {label.text}{' '}
            <a href={run!.htmlUrl} target="_blank" rel="noopener">
              Ver no GitHub
            </a>
          </p>
        </div>
      )}
      {publish?.busy && !run && publish.message && <p class="warn-text">{publish.message}</p>}
      {publish && !publish.busy && publish.message && <p class="warn-text">{publish.message}</p>}
      {publish && !publish.configured && (
        <p class="muted small">Publicação pelo GitHub não configurada: dá para enviar fotos, mas o botão Publicar fica desligado.</p>
      )}
      {busy && <p class="muted small">Enquanto a publicação roda, novos envios e exclusões ficam bloqueados.</p>}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {inbox.length === 0 ? (
        <p class="muted small">Nenhuma foto esperando publicação.</p>
      ) : (
        <ul class="inbox-list">
          {inbox.map((a) => (
            <li key={a.albumId} class="inbox-item">
              <div>
                <p class="inbox-title">{a.title ?? a.albumId}</p>
                <p class="muted small">
                  {formatDate(a.date)} · {plural(a.photos, 'foto', 'fotos')} · {formatSize(a.bytes)}
                </p>
              </div>
              <div class="inbox-actions">
                <button
                  type="button"
                  class="btn-primary"
                  disabled={busy || working !== null || a.photos === 0 || !publish?.configured}
                  onClick={() => publishOne(a.albumId)}
                >
                  {working === a.albumId ? 'Disparando…' : 'Publicar'}
                </button>
                <button type="button" class="btn-outline" disabled={busy} onClick={() => onContinue(a.albumId)}>
                  Continuar envio
                </button>
                <button
                  type="button"
                  class="link-btn"
                  disabled={busy || working !== null}
                  onClick={() => {
                    setDialogError(null);
                    setDiscarding(a);
                  }}
                >
                  Descartar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {discarding && (
        <ConfirmDialog
          title="Descartar este envio?"
          confirmLabel="Descartar"
          busy={working === discarding.albumId}
          busyLabel="Descartando…"
          error={dialogError}
          onConfirm={confirmDiscard}
          onCancel={() => setDiscarding(null)}
        >
          <p>
            {plural(discarding.photos, 'foto enviada será apagada', 'fotos enviadas serão apagadas')} da entrada. O que já está publicado no
            site não muda.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
