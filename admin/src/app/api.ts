import {
  MUTATION_HEADER,
  type AlbumsResponse,
  type DeleteResponse,
  type PurgeResult,
  type RenameResponse,
} from '../shared/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
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
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Erro ${res.status}. Tente de novo.`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

const albumPath = (id: string) => `/api/albums/${encodeURIComponent(id)}`;

export const api = {
  albums: () => call<AlbumsResponse>('GET', '/api/albums'),
  rename: (id: string, title: string) => call<RenameResponse>('PATCH', albumPath(id), { title }),
  deletePhotos: (id: string, photoIds: string[]) => call<DeleteResponse>('POST', `${albumPath(id)}/delete-photos`, { photoIds }),
  deleteAlbum: (id: string, confirmTitle: string) => call<DeleteResponse>('DELETE', albumPath(id), { confirmTitle }),
  purge: (urls: string[]) => call<PurgeResult>('POST', '/api/purge', { urls }),
};

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
