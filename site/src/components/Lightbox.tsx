import { useEffect, useRef, useState } from 'preact/hooks';
import { resolution, type ResolutionId } from '../config';
import { downloadFile } from '../lib/download';
import { photoFileName } from '../lib/files';
import { formatDate, photoUrl, scaledSize } from '../lib/manifest';
import RemovalLink from './RemovalLink';
import type { PhotoRef } from './types';

interface Props {
  items: PhotoRef[];
  index: number | null;
  onIndex: (index: number | null) => void;
  isSelected: (key: string) => boolean;
  onToggle: (key: string) => void;
  res: ResolutionId;
}

type Download = { state: 'idle' } | { state: 'working'; fraction: number } | { state: 'done' } | { state: 'error' };

const PrevIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
const NextIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export default function Lightbox({ items, index, onIndex, isSelected, onToggle, res }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [download, setDownload] = useState<Download>({ state: 'idle' });
  const current = index !== null ? items[index] : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (current && !dialog.open) dialog.showModal();
    if (!current && dialog.open) dialog.close();
  }, [current]);

  // Trocar de foto, de resolução ou fechar cancela o download em andamento.
  useEffect(() => {
    setDownload({ state: 'idle' });
    return () => abortRef.current?.abort();
  }, [current?.key, res]);

  useEffect(() => {
    if (index === null) return;
    for (const i of [index + 1, index - 1]) {
      const near = items[i];
      if (near) new Image().src = photoUrl(near.album.id, near.photo.id, 'preview');
    }
  }, [index, items]);

  const go = (delta: number) => {
    if (index === null) return;
    const next = index + delta;
    if (next >= 0 && next < items.length) onIndex(next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onIndex(null);
    }
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  };

  const onPointerDown = (e: PointerEvent) => {
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  async function downloadCurrent() {
    if (!current || download.state === 'working') return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setDownload({ state: 'working', fraction: 0 });
    try {
      await downloadFile(photoUrl(current.album.id, current.photo.id, res), photoFileName(current, res), {
        signal: ctrl.signal,
        onProgress: (fraction) => setDownload({ state: 'working', fraction }),
      });
      setDownload({ state: 'done' });
    } catch (err) {
      setDownload((err as Error)?.name === 'AbortError' ? { state: 'idle' } : { state: 'error' });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  const selected = current ? isSelected(current.key) : false;
  const preview = current ? scaledSize(current.photo, 1600) : null;
  const resLabel = resolution(res).label;
  const downloadLabel =
    download.state === 'working'
      ? `Baixando ${Math.round(download.fraction * 100)}%`
      : download.state === 'done'
        ? 'Download iniciado'
        : download.state === 'error'
          ? 'Tentar de novo'
          : `Baixar em ${resLabel}`;

  return (
    <dialog ref={dialogRef} class="lightbox" aria-label="Foto ampliada" onClose={() => onIndex(null)} onKeyDown={onKeyDown}>
      {current && preview && index !== null && (
        <div class="lb-inner">
          <div class="lb-top">
            <p class="lb-info">
              <span class="lb-count">
                {index + 1} de {items.length}
              </span>
              <span class="lb-meta">
                {formatDate(current.album.date)}
                {current.album.title ? ` · ${current.album.title}` : ''}
              </span>
            </p>
            <button type="button" class="lb-close" aria-label="Fechar" autofocus onClick={() => onIndex(null)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div class="lb-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
            <div class="lb-frame" style={{ aspectRatio: `${current.photo.w} / ${current.photo.h}` }}>
              <img class="lb-thumb" src={photoUrl(current.album.id, current.photo.id, 'thumb')} alt="" />
              <img
                key={current.key}
                class="lb-img"
                src={photoUrl(current.album.id, current.photo.id, 'preview')}
                width={preview.w}
                height={preview.h}
                alt={`Foto ${current.n}${current.album.title ? ` de ${current.album.title}` : ''}`}
                draggable={false}
              />
            </div>
            <button type="button" class="lb-nav lb-prev" aria-label="Foto anterior" disabled={index === 0} onClick={() => go(-1)}>
              <PrevIcon />
            </button>
            <button type="button" class="lb-nav lb-next" aria-label="Próxima foto" disabled={index === items.length - 1} onClick={() => go(1)}>
              <NextIcon />
            </button>
          </div>

          <div class="lb-bar">
            <button type="button" class="lb-step" aria-label="Foto anterior" disabled={index === 0} onClick={() => go(-1)}>
              <PrevIcon />
            </button>
            <button type="button" class="lb-select" aria-pressed={selected} onClick={() => onToggle(current.key)}>
              <span class="tile-check" aria-hidden="true">
                {selected && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </span>
              {selected ? 'Selecionada' : 'Selecionar'}
            </button>
            <button
              type="button"
              class="lb-download"
              onClick={download.state === 'working' ? () => abortRef.current?.abort() : downloadCurrent}
              aria-label={download.state === 'working' ? `${downloadLabel}. Toque para cancelar` : undefined}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
              </svg>
              {downloadLabel}
            </button>
            <button type="button" class="lb-step" aria-label="Próxima foto" disabled={index === items.length - 1} onClick={() => go(1)}>
              <NextIcon />
            </button>
            <p class="visually-hidden" role="status">
              {download.state === 'done' ? 'Download iniciado.' : download.state === 'error' ? 'Não foi possível baixar a foto.' : ''}
            </p>
          </div>
          <div class="lb-extra">
            <RemovalLink item={current} />
          </div>
        </div>
      )}
    </dialog>
  );
}
