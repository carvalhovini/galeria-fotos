import { MAX_UPLOAD_BYTES, inboxFileName, type InboxFile } from '../shared/types';
import { ApiError, uploadFile } from './api';
import { readJpegInfo, type JpegInfo } from './jpeg-info';

export type ItemStatus = 'waiting' | 'uploading' | 'retrying' | 'done' | 'skipped' | 'failed' | 'rejected';

export interface UploadItem {
  key: number;
  file: File;
  original: string;
  name: string | null;
  size: number;
  status: ItemStatus;
  loaded: number;
  attempts: number;
  message: string | null;
  info: JpegInfo | null;
}

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2000, 6000];
const NOTIFY_EVERY_MS = 150;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function retryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
}

function waitAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Envio cancelado.', 'AbortError'));
      },
      { once: true },
    );
  });
}

// Fila de envio: até 3 fotos ao mesmo tempo, novas tentativas automáticas em falhas de rede ou
// do servidor, e retomada sem reenviar o que já está na entrada.
export class Uploader {
  items: UploadItem[] = [];
  running = false;
  private nextKey = 1;
  private ctrl: AbortController | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly albumId: string,
    private readonly onChange: () => void,
    private readonly onStop: (message: string) => void,
  ) {}

  private notify(now = false) {
    if (now) {
      if (this.notifyTimer) clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
      this.onChange();
      return;
    }
    this.notifyTimer ??= setTimeout(() => {
      this.notifyTimer = null;
      this.onChange();
    }, NOTIFY_EVERY_MS);
  }

  // Dá nome a cada foto. Uma foto que já está na entrada com o mesmo nome base e o mesmo tamanho
  // é pulada (retomada). Nomes repetidos, como vários "image.jpg" do iPhone, ganham -2, -3...
  addFiles(files: File[], server: InboxFile[], published: Set<string>) {
    const taken = new Set([...server.map((f) => f.name), ...this.items.map((i) => i.name).filter(Boolean)] as string[]);
    const claimed = new Set(this.items.filter((i) => i.status === 'skipped' && i.name).map((i) => i.name!));
    const seen = new Set(this.items.map((i) => `${i.original}|${i.size}|${i.file.lastModified}`));

    for (const file of files) {
      const signature = `${file.name}|${file.size}|${file.lastModified}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      const item: UploadItem = {
        key: this.nextKey++,
        file,
        original: file.name,
        name: null,
        size: file.size,
        status: 'waiting',
        loaded: 0,
        attempts: 0,
        message: null,
        info: null,
      };
      this.items.push(item);

      const name = inboxFileName(file.name);
      if (!name || (file.type && file.type !== 'image/jpeg')) {
        item.status = 'rejected';
        item.message = 'Não é uma foto .jpg ou .jpeg.';
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        item.status = 'rejected';
        item.message = `Passa de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
        continue;
      }
      const base = name.slice(0, -4);
      if (published.has(base)) {
        item.name = name;
        item.status = 'skipped';
        item.message = 'Já publicada neste álbum.';
        continue;
      }
      const sameBase = new RegExp(`^${escapeRe(base)}(-\\d+)?\\.jpg$`);
      const match = server.find((f) => sameBase.test(f.name) && f.size === file.size && !claimed.has(f.name));
      if (match) {
        claimed.add(match.name);
        item.name = match.name;
        item.status = 'skipped';
        item.loaded = file.size;
        item.message = 'Já estava na entrada.';
        continue;
      }
      let candidate = name;
      for (let n = 2; taken.has(candidate) || published.has(candidate.slice(0, -4)); n++) candidate = `${base}-${n}.jpg`;
      taken.add(candidate);
      item.name = candidate;
    }
    this.notify(true);
    void this.readInfo();
  }

  private async readInfo() {
    for (const item of this.items) {
      if (item.info || item.status === 'rejected') continue;
      try {
        item.info = await readJpegInfo(item.file);
        if (!item.info.jpeg && item.status === 'waiting') {
          item.status = 'rejected';
          item.message = 'O conteúdo não é JPEG.';
        }
      } catch {
        // diagnóstico é opcional
      }
      this.notify();
    }
  }

  retryFailed() {
    for (const item of this.items) {
      if (item.status === 'failed') {
        item.status = 'waiting';
        item.attempts = 0;
        item.loaded = 0;
        item.message = null;
      }
    }
    return this.start();
  }

  cancel() {
    this.ctrl?.abort();
  }

  async start(): Promise<void> {
    if (this.running) return;
    const queue = this.items.filter((i) => i.status === 'waiting');
    if (queue.length === 0) return;
    this.running = true;
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.notify(true);

    let next = 0;
    const worker = async () => {
      while (next < queue.length && !ctrl.signal.aborted) {
        const item = queue[next++];
        if (item.status === 'waiting') await this.send(item, ctrl);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    this.running = false;
    this.ctrl = null;
    this.notify(true);
  }

  private async send(item: UploadItem, ctrl: AbortController) {
    while (true) {
      item.status = 'uploading';
      item.attempts++;
      item.loaded = 0;
      item.message = null;
      this.notify();
      try {
        await uploadFile(this.albumId, item.name!, item.file, (loaded) => {
          item.loaded = Math.min(loaded, item.size);
          this.notify();
        }, ctrl.signal);
        item.status = 'done';
        item.loaded = item.size;
        this.notify();
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          item.status = 'waiting';
          item.loaded = 0;
          return;
        }
        if (err instanceof ApiError && (err.code === 'publishing' || err.status === 401 || err.code === 'no-meta')) {
          item.status = 'waiting';
          item.loaded = 0;
          ctrl.abort();
          this.onStop(err.status === 401 ? 'Sessão expirada. Recarregue a página e escolha as fotos de novo: as que já subiram serão puladas.' : err.message);
          return;
        }
        if (err instanceof ApiError && err.code === 'published') {
          item.status = 'skipped';
          item.message = 'Já publicada neste álbum.';
          this.notify();
          return;
        }
        if (retryable(err) && item.attempts < MAX_ATTEMPTS) {
          item.status = 'retrying';
          item.message = `Falhou (${(err as Error).message}). Nova tentativa em instantes.`;
          this.notify();
          try {
            await waitAbortable(RETRY_DELAYS_MS[item.attempts - 1] ?? 6000, ctrl.signal);
          } catch {
            item.status = 'waiting';
            return;
          }
          continue;
        }
        item.status = 'failed';
        item.message = (err as Error).message;
        this.notify();
        return;
      }
    }
  }
}
