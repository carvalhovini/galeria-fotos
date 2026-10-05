import { zipSync } from 'fflate';

export interface ZipItem {
  url: string;
  path: string;
}

export async function fetchBytes(
  url: string,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<Uint8Array> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.(buf.length, buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress?.(loaded, loaded);
  return out;
}

export async function fetchJpeg(url: string, signal?: AbortSignal): Promise<Blob> {
  const bytes = await fetchBytes(url, { signal });
  return new Blob([bytes as BlobPart], { type: 'image/jpeg' });
}

export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

// Baixa os arquivos com concorrência limitada e monta um zip sem compressão
// (JPEG não comprime mais, e assim o celular não trava). `onProgress` recebe 0..1.
export async function buildZip(
  items: ZipItem[],
  { signal, concurrency = 4, onProgress }: { signal?: AbortSignal; concurrency?: number; onProgress?: (fraction: number, filesDone: number) => void } = {},
): Promise<Blob> {
  const fractions = new Array(items.length).fill(0);
  const files: Record<string, Uint8Array> = {};
  let filesDone = 0;
  let next = 0;
  const report = () => onProgress?.(fractions.reduce((a, b) => a + b, 0) / items.length, filesDone);

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      files[item.path] = await fetchBytes(item.url, {
        signal,
        onProgress: (loaded, total) => {
          fractions[index] = total ? Math.min(loaded / total, 1) : 0;
          report();
        },
      });
      fractions[index] = 1;
      filesDone++;
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  signal?.throwIfAborted();

  const zipped = zipSync(files, { level: 0 });
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'teste.jpg', { type: 'image/jpeg' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function shareJpeg(blob: Blob, filename: string, text: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/jpeg' });
  await navigator.share({ files: [file], text });
}
