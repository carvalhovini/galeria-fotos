import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PHOTOS_PER_BATCH, bestFittingResolution, maxPhotosFor, resolution, resolutionsFor, type ResolutionId } from '../config';
import { formatDateLong, photoCount, type Album } from '../lib/manifest';
import Lightbox from './Lightbox';
import Masonry, { useColumns } from './Masonry';
import SelectionBar from './SelectionBar';
import type { PhotoRef } from './types';

interface Props {
  album: Album;
  refs: PhotoRef[];
  selected: Set<string>;
  res: ResolutionId;
  homeHref: string;
  onRes: (res: ResolutionId) => void;
  onSelectionChange: (next: Set<string>) => void;
  onBack: () => void;
}

export default function AlbumView({ album, refs, selected, res, homeHref, onRes, onSelectionChange, onBack }: Props) {
  const columns = useColumns();
  const [visible, setVisible] = useState(PHOTOS_PER_BATCH);
  const [viewer, setViewer] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const sentinelRef = useRef<HTMLDivElement>(null);
  const lastViewed = useRef<string | null>(null);

  const total = refs.length;
  const shown = Math.min(visible, total);
  const max = maxPhotosFor(res);
  const cap = Math.min(total, max);
  const allOn = selected.size > 0 && selected.size >= cap;
  const name = album.title || formatDateLong(album.date);

  const loadMore = useCallback(() => setVisible((v) => Math.min(v + PHOTOS_PER_BATCH, total)), [total]);

  // Recria o observador a cada lote: se o fim da grade continuar perto da tela, carrega o próximo.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || shown >= total || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, total, loadMore]);

  const toggle = useCallback(
    (key: string) => {
      const next = new Set(selected);
      if (!next.delete(key)) next.add(key);
      onSelectionChange(next);
      setNote('');
    },
    [selected, onSelectionChange],
  );

  const selectAll = () => {
    if (allOn) {
      onSelectionChange(new Set());
      setNote('');
      return;
    }
    onSelectionChange(new Set(refs.slice(0, cap).map((r) => r.key)));
    if (total > max) {
      const fit = bestFittingResolution(total, res);
      setNote(
        `Selecionadas as primeiras ${max} de ${total} fotos: é o que cabe em ${resolution(res).label} num download.` +
          (fit ? ` Em ${fit.label} cabem todas.` : ' Baixe em partes.'),
      );
    } else {
      setNote('');
    }
  };

  const zoom = useCallback(
    (key: string) => {
      const index = refs.findIndex((r) => r.key === key);
      if (index >= 0) setViewer(index);
    },
    [refs],
  );

  const changeViewer = (index: number | null) => {
    if (index === null) {
      const key = lastViewed.current;
      setViewer(null);
      // Depois que o diálogo devolve o foco, leva o foco (e a rolagem) para a foto que estava aberta.
      if (key) setTimeout(() => document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] .tile-zoom`)?.focus(), 0);
      return;
    }
    lastViewed.current = refs[index]?.key ?? null;
    if (index >= visible) setVisible(Math.min(Math.ceil((index + 1) / PHOTOS_PER_BATCH) * PHOTOS_PER_BATCH, total));
    setViewer(index);
  };

  const selectedRefs = useMemo(() => refs.filter((r) => selected.has(r.key)), [refs, selected]);
  const isSelected = useCallback((key: string) => selected.has(key), [selected]);

  return (
    <>
      <main class="container album-page" id="fotos" aria-labelledby="album-title">
        <a
          class="back-link"
          href={homeHref}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onBack();
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Voltar para os álbuns
        </a>

        <div class="album-head">
          <div>
            <h1 id="album-title" class="album-page-title">
              {name}
            </h1>
            <p class="album-sub">
              {album.title ? `${formatDateLong(album.date)} · ` : ''}
              {photoCount(total)}
            </p>
          </div>
          <button type="button" class="btn-outline" onClick={selectAll}>
            {allOn ? 'Desmarcar todas' : 'Selecionar todas'}
          </button>
        </div>
        <p class="select-note" role="status">
          {note}
        </p>

        <Masonry items={refs} visible={shown} columns={columns} isSelected={isSelected} onToggle={toggle} onZoom={zoom} />

        <div class="load-more">
          <p class="load-count">
            Mostrando {shown.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}
          </p>
          {shown < total && (
            <button type="button" class="btn-outline" onClick={loadMore}>
              Carregar mais
            </button>
          )}
          <div ref={sentinelRef} class="load-sentinel" aria-hidden="true" />
        </div>
      </main>

      <SelectionBar
        items={selectedRefs}
        options={resolutionsFor(album.formats)}
        res={res}
        onRes={onRes}
        onClear={() => onSelectionChange(new Set())}
      />

      <Lightbox items={refs} index={viewer} onIndex={changeViewer} isSelected={isSelected} onToggle={toggle} res={res} />
    </>
  );
}
