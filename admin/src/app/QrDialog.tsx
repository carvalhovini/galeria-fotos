import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { encode } from 'uqr';
import type { Album } from '../shared/types';
import { PUBLIC_SITE, formatDateLong } from './format';

interface Props {
  album: Album;
  onClose: () => void;
}

// Margem branca de 4 módulos: o mínimo da norma para os leitores acharem o código.
const QUIET = 4;
const PNG_W = 1200;
const PNG_H = 1560;
const HANDLE = '@carvalho_.vini';

export function albumUrl(albumId: string): string {
  return `${PUBLIC_SITE}/?album=${encodeURIComponent(albumId)}`;
}

function qrPath(data: boolean[][]): string {
  let d = '';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    }),
  );
  return d;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S*$/, '')}…`;
    return kept;
  }
  return lines;
}

async function renderPng(album: Album, url: string, data: boolean[][]): Promise<Blob> {
  await Promise.all([document.fonts.load('800 80px "Big Shoulders Display"'), document.fonts.load('500 36px "DM Sans"')]).catch(() => {});
  const canvas = document.createElement('canvas');
  canvas.width = PNG_W;
  canvas.height = PNG_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PNG_W, PNG_H);
  ctx.fillStyle = '#121110';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = '800 92px "Big Shoulders Display", "Arial Narrow", sans-serif';
  const titleLines = wrapLines(ctx, album.title.toUpperCase(), PNG_W - 160, 2);
  let y = 150;
  for (const line of titleLines) {
    ctx.fillText(line, PNG_W / 2, y);
    y += 96;
  }
  ctx.font = '500 38px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = '#4a443c';
  ctx.fillText(formatDateLong(album.date), PNG_W / 2, y + 4);

  const modules = data.length + QUIET * 2;
  const qrSize = 960;
  const cell = qrSize / modules;
  const top = PNG_H - qrSize - 230;
  const left = (PNG_W - qrSize) / 2;
  ctx.fillStyle = '#000000';
  data.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect(Math.floor(left + (c + QUIET) * cell), Math.floor(top + (r + QUIET) * cell), Math.ceil(cell), Math.ceil(cell));
    }),
  );

  ctx.fillStyle = '#121110';
  ctx.font = '500 34px "DM Sans", system-ui, sans-serif';
  ctx.fillText(url.replace(/^https:\/\//, ''), PNG_W / 2, PNG_H - 150);
  ctx.fillStyle = '#4a443c';
  ctx.fillText(`Fotos por ${HANDLE}`, PNG_W / 2, PNG_H - 90);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

export default function QrDialog({ album, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = albumUrl(album.id);
  const qr = useMemo(() => encode(url, { ecc: 'M', border: 0 }), [url]);
  const path = useMemo(() => qrPath(qr.data), [qr]);
  const viewBox = `0 0 ${qr.size + QUIET * 2} ${qr.size + QUIET * 2}`;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const downloadPng = async () => {
    setSaving(true);
    setError(null);
    try {
      const blob = await renderPng(album, url, qr.data);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `qr-${album.id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch {
      setError('Não foi possível gerar o PNG. Tente de novo.');
    } finally {
      setSaving(false);
    }
  };

  const svg = (cls: string) => (
    <svg class={cls} viewBox={viewBox} shape-rendering="crispEdges" role="img" aria-label={`QR code do endereço ${url}`}>
      <rect width="100%" height="100%" fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );

  return (
    <dialog
      ref={ref}
      class="qr-dialog"
      aria-labelledby="qr-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div class="qr-screen">
        <div class="qr-head">
          <div>
            <h2 id="qr-title">{album.title}</h2>
            <p class="muted small">{formatDateLong(album.date)}</p>
          </div>
          <button type="button" class="notice-close" aria-label="Fechar" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div class="qr-box">{svg('qr-svg')}</div>
        <p class="qr-url">
          <a href={url} target="_blank" rel="noopener">
            {url.replace(/^https:\/\//, '')}
          </a>
        </p>
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
        <div class="qr-actions">
          <button type="button" class="btn-primary" disabled={saving} onClick={downloadPng}>
            {saving ? 'Gerando…' : 'Baixar PNG'}
          </button>
          <button type="button" class="btn-outline" onClick={() => print()}>
            Imprimir
          </button>
        </div>
      </div>

      <div class="qr-print" aria-hidden="true">
        <p class="qr-print-title">{album.title}</p>
        <p class="qr-print-date">{formatDateLong(album.date)}</p>
        {svg('qr-print-svg')}
        <p class="qr-print-hint">Aponte a câmera do celular para ver e baixar as fotos.</p>
        <p class="qr-print-url">{url.replace(/^https:\/\//, '')}</p>
        <p class="qr-print-by">Fotos por {HANDLE}</p>
      </div>
    </dialog>
  );
}
