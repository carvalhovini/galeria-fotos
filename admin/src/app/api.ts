import {
  MUTATION_HEADER,
  type AlbumsResponse,
  type DeleteResponse,
  type InboxMeta,
  type InboxResponse,
  type PublishStatus,
  type PurgeResult,
  type RenameResponse,
  type UploadListResponse,
  type UploadResponse,
} from '../shared/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

function errorFrom(status: number, data: unknown): ApiError {
  const body = data as { error?: string; code?: string } | null;
  return new ApiError(status, body?.error ?? `Erro ${status}. Tente de novo.`, body?.code);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers[MUTATION_HEADER] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    // Com a sessão do Access vencida, o fetch é redirecionado para o login e falha aqui.
    throw new ApiError(0, 'Sem conexão ou sessão expirada. Recarregue a página.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // resposta sem JSON
  }
  if (!res.ok) throw errorFrom(res.status, data);
  return data as T;
}

const albumPath = (id: string) => `/api/albums/${encodeURIComponent(id)}`;
const uploadPath = (id: string) => `/api/upload/${encodeURIComponent(id)}`;

export const api = {
  albums: () => call<AlbumsResponse>('GET', '/api/albums'),
  rename: (id: string, title: string) => call<RenameResponse>('PATCH', albumPath(id), { title }),
  deletePhotos: (id: string, photoIds: string[]) => call<DeleteResponse>('POST', `${albumPath(id)}/delete-photos`, { photoIds }),
  deleteAlbum: (id: string, confirmTitle: string) => call<DeleteResponse>('DELETE', albumPath(id), { confirmTitle }),
  purge: (urls: string[]) => call<PurgeResult>('POST', '/api/purge', { urls }),
  inbox: () => call<InboxResponse>('GET', '/api/inbox'),
  uploadList: (id: string) => call<UploadListResponse>('GET', uploadPath(id)),
  putMeta: (id: string, title: string) => call<InboxMeta>('PUT', `${uploadPath(id)}/_album.json`, { title }),
  discardUpload: (id: string) => call<{ deleted: number }>('DELETE', uploadPath(id)),
  publishStatus: () => call<PublishStatus>('GET', '/api/publish'),
  publish: (id: string) => call<PublishStatus>('POST', `/api/publish/${encodeURIComponent(id)}`),
};

// XMLHttpRequest em vez de fetch: é o único jeito de ter o progresso do envio no Safari.
export function uploadFile(
  albumId: string,
  name: string,
  file: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${uploadPath(albumId)}/${encodeURIComponent(name)}`);
    xhr.setRequestHeader(MUTATION_HEADER, '1');
    xhr.setRequestHeader('Content-Type', 'image/jpeg');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) resolve(xhr.response as UploadResponse);
      else reject(errorFrom(xhr.status, xhr.response));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Falha de conexão no envio.'));
    xhr.ontimeout = () => reject(new ApiError(0, 'O envio demorou demais.'));
    xhr.onabort = () => reject(new DOMException('Envio cancelado.', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

const PURGE_CHUNK = 500;

// Continua o purge que o servidor deixou pendente e junta as falhas.
export async function finishPurge(
  first: PurgeResult,
  onProgress: (done: number, total: number) => void,
): Promise<{ configured: boolean; failed: string[]; message?: string }> {
  const failed = [...first.failed];
  let pending = [...first.pending];
  let message = first.message;
  let configured = first.configured;
  const total = first.purged.length + failed.length + pending.length;
  let done = total - pending.length;

  while (pending.length > 0) {
    onProgress(done, total);
    const chunk = pending.slice(0, PURGE_CHUNK);
    pending = pending.slice(PURGE_CHUNK);
    try {
      const r = await api.purge(chunk);
      failed.push(...r.failed);
      pending = [...r.pending, ...pending];
      message ??= r.message;
      configured &&= r.configured;
      done += r.purged.length + r.failed.length;
    } catch (err) {
      failed.push(...chunk, ...pending);
      pending = [];
      message ??= err instanceof Error ? err.message : 'Falha ao limpar o cache.';
    }
  }
  onProgress(total, total);
  return { configured, failed, message };
}
