import { ALBUM_ID_RE, INBOX_META_FILE, MUTATION_HEADER } from '../shared/types';
import { accessAudience, teamOrigin, verifyAccess } from './access';
import { deleteAlbum, deletePhotos, listAlbums, renameAlbum, retryPurge } from './albums';
import type { Env } from './env';
import { HttpError, errorResponse, json, readJson } from './http';
import { discardUpload, listInbox, listUpload, putMeta, putPhoto } from './inbox';
import { publishStatus, startPublish } from './publish';

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!teamOrigin(env.ACCESS_TEAM_DOMAIN) || !accessAudience(env)) {
    console.error('access: ACCESS_TEAM_DOMAIN ou ACCESS_AUD ausente ou inválido');
    return errorResponse(500, 'O gerenciador está sem a configuração do Cloudflare Access.');
  }
  const identity = await verifyAccess(request, env);
  if (!identity) return errorResponse(401, 'Sessão inválida ou expirada. Recarregue a página para entrar de novo.');

  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    const fetchSite = request.headers.get('Sec-Fetch-Site');
    if (request.headers.get(MUTATION_HEADER) !== '1' || (fetchSite && fetchSite !== 'same-origin')) {
      return errorResponse(403, 'Requisição recusada.');
    }
  }

  const [, , resource, albumId, action, ...rest] = url.pathname.split('/');
  if (rest.length > 0) return errorResponse(404, 'Rota não encontrada.');

  if (resource === 'albums' && !albumId) {
    if (method === 'GET') return json(await listAlbums(env, identity));
    return errorResponse(405, 'Método não permitido.');
  }

  if (resource === 'albums') {
    if (!ALBUM_ID_RE.test(albumId)) return errorResponse(404, 'Álbum não encontrado.');
    if (!action && method === 'PATCH') return json(await renameAlbum(env, albumId, await readJson(request)));
    if (!action && method === 'DELETE') return json(await deleteAlbum(env, albumId, await readJson(request)));
    if (action === 'delete-photos' && method === 'POST') return json(await deletePhotos(env, albumId, await readJson(request)));
    return errorResponse(action && action !== 'delete-photos' ? 404 : 405, 'Rota ou método não permitido.');
  }

  if (resource === 'purge' && !albumId) {
    if (method === 'POST') return json(await retryPurge(env, await readJson(request)));
    return errorResponse(405, 'Método não permitido.');
  }

  if (resource === 'inbox' && !albumId) {
    if (method === 'GET') return json(await listInbox(env));
    return errorResponse(405, 'Método não permitido.');
  }

  if (resource === 'upload') {
    if (!ALBUM_ID_RE.test(albumId ?? '')) return errorResponse(404, 'Álbum inválido. Use AAAA-MM-DD_nome-do-jogo.');
    if (!action) {
      if (method === 'GET') return json(await listUpload(env, albumId));
      if (method === 'DELETE') return json(await discardUpload(env, albumId));
      return errorResponse(405, 'Método não permitido.');
    }
    if (method !== 'PUT') return errorResponse(405, 'Método não permitido.');
    if (action === INBOX_META_FILE) return json(await putMeta(env, albumId, await readJson(request)));
    return json(await putPhoto(env, albumId, action, request));
  }

  if (resource === 'publish') {
    if (!albumId && method === 'GET') return json(await publishStatus(env, { fresh: true }));
    if (albumId && !action && method === 'POST') return json(await startPublish(env, albumId));
    return errorResponse(405, 'Rota ou método não permitido.');
  }

  return errorResponse(404, 'Rota não encontrada.');
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return new Response('Não encontrado.', { status: 404 });
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.message, err.code);
      console.error(`api: erro inesperado em ${request.method} ${url.pathname} (${err instanceof Error ? err.name : 'erro'})`);
      return errorResponse(500, 'Erro inesperado no servidor. Tente de novo.');
    }
  },
} satisfies ExportedHandler<Env>;
