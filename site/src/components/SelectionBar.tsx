import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { DOWNLOAD_LIMIT_MB, HAS_PIX, SITE, bestFittingResolution, maxPhotosFor, resolution, type Resolution, type ResolutionId } from '../config';
import { buildZip, canShareFiles, downloadFile, fetchBytes, saveBlob, shareJpeg } from '../lib/download';
import { photoFileName as fileName, zipFileName as zipName } from '../lib/files';
import { photoUrl } from '../lib/manifest';
import RemovalLink from './RemovalLink';
import type { PhotoRef } from './types';

interface Props {
  items: PhotoRef[];
  options: Resolution[];
  res: ResolutionId;
  onRes: (res: ResolutionId) => void;
  onClear: () => void;
}

type Job =
  | { kind: 'idle' }
  | { kind: 'working'; fraction: number; filesDone: number; total: number; zipping: boolean }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

type ShareState = 'idle' | 'loading' | 'retry' | 'error';

function formatMb(mb: number) {
  return mb < 10 ? mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : Math.round(mb).toLocaleString('pt-BR');
}

function isAbort(err: unknown) {
  return (err as Error)?.name === 'AbortError';
}

export default function SelectionBar({ items, options, res, onRes, onClear }: Props) {
  const [job, setJob] = useState<Job>({ kind: 'idle' });
  const [share, setShare] = useState<ShareState>('idle');
  const [shareSupported, setShareSupported] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const shareCache = useRef<{ id: string; blob: Blob } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const count = items.length;
  const max = maxPhotosFor(res);
  const overLimit = count > max;
  const fitting = overLimit ? bestFittingResolution(count, res) : null;
  const working = job.kind === 'working';
  const signature = `${items.map((i) => i.key).join('|')}#${res}`;
  const resLabel = resolution(res).label;
  const estimateMb = count * resolution(res).mb;

  useEffect(() => setShareSupported(canShareFiles()), []);

  useEffect(() => {
    if (!working) setJob({ kind: 'idle' });
    setShare('idle');
  }, [signature]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const bar = barRef.current;
    if (!bar || count === 0) {
      root.style.removeProperty('--bar-space');
      return;
    }
    const update = () => root.style.setProperty('--bar-space', `${bar.offsetHeight + 32}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--bar-space');
    };
  }, [count > 0]);

  if (count === 0) return null;

  async function download() {
    if (overLimit || working) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({ kind: 'working', fraction: 0, filesDone: 0, total: count, zipping: false });
    try {
      if (count === 1) {
        const item = items[0];
        await downloadFile(photoUrl(item.album.id, item.photo.id, res), fileName(item, res), {
          signal: ctrl.signal,
          onProgress: (fraction) => setJob({ kind: 'working', fraction, filesDone: 0, total: 1, zipping: false }),
        });
      } else {
        const multiAlbum = new Set(items.map((i) => i.album.id)).size > 1;
        const zip = await buildZip(
          items.map((item) => ({
            url: photoUrl(item.album.id, item.photo.id, res),
            path: `${multiAlbum ? `${item.album.id}/` : ''}${fileName(item, res)}`,
          })),
          {
            signal: ctrl.signal,
            onProgress: (fraction, filesDone) =>
              setJob({ kind: 'working', fraction, filesDone, total: count, zipping: filesDone === count }),
          },
        );
        saveBlob(zip, zipName(items, res));
      }
      setJob({ kind: 'done' });
    } catch (err) {
      setJob(
        isAbort(err)
          ? { kind: 'idle' }
          : { kind: 'error', message: 'Não foi possível baixar. Verifique a conexão e tente de novo.' },
      );
    } finally {
      abortRef.current = null;
    }
  }

  async function shareOne() {
    const item = items[0];
    const id = `${item.key}#${res}`;
    try {
      let blob = shareCache.current?.id === id ? shareCache.current.blob : null;
      if (!blob) {
        setShare('loading');
        const bytes = await fetchBytes(photoUrl(item.album.id, item.photo.id, res));
        blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
        shareCache.current = { id, blob };
      }
      await shareJpeg(blob, fileName(item, res), `Foto por ${SITE.instagram.handle}`);
      setShare('idle');
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'NotAllowedError') setShare('retry');
      else if (name === 'AbortError') setShare('idle');
      else setShare('error');
    }
  }

  let downloadLabel = `Baixar em ${resLabel}`;
  if (job.kind === 'working') {
    if (job.zipping) downloadLabel = 'Montando o arquivo .zip';
    else if (job.total > 1) downloadLabel = `Baixando ${job.filesDone} de ${job.total}`;
    else downloadLabel = `Baixando ${Math.round(job.fraction * 100)}%`;
  }

  const shareLabel = {
    idle: 'Compartilhar ou salvar',
    loading: 'Preparando a foto',
    retry: 'Toque para compartilhar',
    error: 'Tentar compartilhar de novo',
  }[share];

  return (
    <div class="sel-bar" ref={barRef} role="region" aria-label="Fotos selecionadas">
      <div class="sel-summary">
        <span class="sel-count">
          {count === 1 ? '1 foto selecionada' : `${count} fotos selecionadas`}
          <span class="sel-size"> · ≈ {formatMb(estimateMb)} MB</span>
        </span>
        <button type="button" class="sel-clear" onClick={onClear} disabled={working}>
          Limpar seleção
        </button>
      </div>

      <div class="sel-res" role="group" aria-label="Resolução">
        {options.map((r) => (
          <button
            type="button"
            key={r.id}
            class={r.format ? 'is-format' : undefined}
            aria-pressed={res === r.id}
            onClick={() => onRes(r.id)}
            disabled={working}
          >
            <span class="sel-res-label">{r.label}</span>
            <span class="sel-res-px">{r.detail}</span>
          </button>
        ))}
      </div>

      <div class="sel-actions">
        {count === 1 && shareSupported && (
          <button type="button" class="sel-share" onClick={shareOne} disabled={share === 'loading' || working}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
            </svg>
            {shareLabel}
          </button>
        )}
        <button type="button" class="sel-dl" onClick={download} disabled={overLimit || working} aria-describedby={overLimit ? 'sel-limit' : undefined}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
          </svg>
          {downloadLabel}
        </button>
        {working && (
          <button type="button" class="sel-cancel" onClick={() => abortRef.current?.abort()}>
            Cancelar
          </button>
        )}
      </div>

      {job.kind === 'working' && (
        <progress class="sel-progress" max={1} value={job.fraction} aria-label="Progresso do download" />
      )}

      {overLimit && (
        <p id="sel-limit" class="sel-note sel-warn" role="alert">
          Em {resLabel} cabem {max} fotos por download (até {DOWNLOAD_LIMIT_MB} MB). Desmarque {count - max}{' '}
          {count - max === 1 ? 'foto' : 'fotos'}
          {fitting ? ` ou escolha ${fitting.label}, onde cabem todas.` : ' ou baixe em partes.'}
        </p>
      )}

      {count === 1 && !working && (
        <div class="sel-removal">
          <RemovalLink item={items[0]} />
        </div>
      )}

      <div class="sel-live" role="status">
        {job.kind === 'done' && (
          <p class="sel-note">
            {HAS_PIX ? (
              <>
                Download iniciado. Se curtiu, a <a href="#apoie">ajuda de custo é opcional</a>, e marcar {SITE.instagram.handle} já ajuda muito.
              </>
            ) : (
              <>
                Download iniciado. Se curtiu, <a href="#apoie">marcar {SITE.instagram.handle}</a> no Instagram já ajuda muito.
              </>
            )}
          </p>
        )}
        {job.kind === 'error' && <p class="sel-note sel-warn">{job.message}</p>}
        {share === 'error' && <p class="sel-note sel-warn">Não foi possível compartilhar a foto. Tente de novo ou use o botão de baixar.</p>}
      </div>
    </div>
  );
}
