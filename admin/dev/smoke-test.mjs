// Teste local da API. Pré-requisitos: npm run seed:local, depois wrangler dev (8787) e
// npm run dev:access (8788) rodando. Altera só o R2 simulado.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPair, importJWK, SignJWT } from 'jose';

const ADMIN_DIR = path.resolve(import.meta.dirname, '..');
const API = 'http://127.0.0.1:8787';
const MOCK = 'http://127.0.0.1:8788';
const BASE = 'https://fotos.carvalhovini.com';
const TEST = '2026-09-27_teste';
const COPY = '2026-09-20_copia-teste';

const keys = JSON.parse(await fs.readFile(path.join(ADMIN_DIR, '.wrangler', 'dev-access', 'keys.json'), 'utf8'));
const privateKey = await importJWK(keys.privateJwk, 'RS256');
const otherKey = (await generateKeyPair('RS256')).privateKey;
const now = () => Math.floor(Date.now() / 1000);

function token({ key = privateKey, iss = keys.issuer, aud = [keys.aud], exp = now() + 300, iat = now() } = {}) {
  const jwt = new SignJWT({ email: keys.email }).setProtectedHeader({ alg: 'RS256', kid: keys.kid }).setIssuer(iss).setAudience(aud).setIssuedAt(iat);
  if (exp !== null) jwt.setExpirationTime(exp);
  return jwt.sign(key);
}

let validToken = await token();
async function api(method, route, { body, auth = validToken, mutationHeader = true, headers = {} } = {}) {
  const h = { ...headers };
  if (auth) h['Cf-Access-Jwt-Assertion'] = auth;
  if (mutationHeader && method !== 'GET') h['X-Galeria-Admin'] = '1';
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${route}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FALHOU'}  ${name}${!ok && detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}
const mock = (route, method = 'GET') => fetch(`${MOCK}${route}`, { method }).then((r) => r.json());
const albums = async () => (await api('GET', '/api/albums')).data.albums;
const find = async (id) => (await albums()).find((a) => a.id === id);

console.log('\nAutenticação');
check('sem JWT: 401', (await api('GET', '/api/albums', { auth: null })).status === 401);
check('JWT malformado: 401', (await api('GET', '/api/albums', { auth: 'abc.def.ghi' })).status === 401);
check('assinatura de outra chave: 401', (await api('GET', '/api/albums', { auth: await token({ key: otherKey }) })).status === 401);
check('aud errado: 401', (await api('GET', '/api/albums', { auth: await token({ aud: ['outro-app'] }) })).status === 401);
check('emissor errado: 401', (await api('GET', '/api/albums', { auth: await token({ iss: 'https://outro.cloudflareaccess.com' }) })).status === 401);
check('expirado: 401', (await api('GET', '/api/albums', { auth: await token({ exp: now() - 60, iat: now() - 600 }) })).status === 401);
check('sem exp: 401', (await api('GET', '/api/albums', { auth: await token({ exp: null }) })).status === 401);
check('JWT inválido também em rota de alteração: 401', (await api('POST', '/api/purge', { auth: null, body: { urls: [] } })).status === 401);
const list = await api('GET', '/api/albums');
check('JWT válido: 200 com álbuns', list.status === 200 && list.data.albums.length >= 3, JSON.stringify(list.data).slice(0, 120));
check('mostra o e-mail do JWT', list.data.user === keys.email);

console.log('\nCabeçalho customizado e validação');
check('PATCH sem X-Galeria-Admin: 403', (await api('PATCH', `/api/albums/${TEST}`, { mutationHeader: false, body: { title: 'x' } })).status === 403);
check('Sec-Fetch-Site cross-site: 403', (await api('PATCH', `/api/albums/${TEST}`, { headers: { 'Sec-Fetch-Site': 'cross-site' }, body: { title: 'x' } })).status === 403);
check('título vazio: 400', (await api('PATCH', `/api/albums/${TEST}`, { body: { title: '  ' } })).status === 400);
check('título com travessão: 400', (await api('PATCH', `/api/albums/${TEST}`, { body: { title: 'A — B' } })).status === 400);
check('álbum inexistente: 404', (await api('PATCH', '/api/albums/2020-01-01_nao-existe', { body: { title: 'x' } })).status === 404);
check('rota desconhecida: 404', (await api('GET', '/api/nada')).status === 404);
check('purge de URL de fora: 400', (await api('POST', '/api/purge', { body: { urls: ['https://exemplo.com/a.jpg'] } })).status === 400);

console.log('\nRenomear');
const renamed = await api('PATCH', `/api/albums/${TEST}`, { body: { title: '  Teste   renomeado ' } });
check('renomeia e normaliza espaços', renamed.status === 200 && renamed.data.album.title === 'Teste renomeado');
check('devolve o backup gravado', /^manifest-backups\/manifest-.+\.json$/.test(renamed.data?.backupKey ?? ''));

console.log('\nExcluir foto');
await mock('/__purge-log', 'DELETE');
const del1 = await api('POST', `/api/albums/${TEST}/delete-photos`, { body: { photoIds: ['DSC_0001'] } });
check('200 e álbum com 1 foto', del1.status === 200 && del1.data.album?.photos.length === 1);
check('6 arquivos apagados', del1.data?.deletedObjects === 6);
check('purge de 7 URLs (6 versões + manifest)', del1.data?.purge.purged.length === 7 && del1.data.purge.failed.length === 0);
let log = await mock('/__purge-log');
check('1 chamada com 28 itens (7 URLs x 4 variantes de origem)', log.length === 1 && log[0].files.length === 28, JSON.stringify(log.map((c) => c.files.length)));
check(
  'inclui variantes com Origin de www e workers.dev',
  log[0].files.some((f) => f.headers?.Origin === 'https://www.carvalhovini.com') &&
    log[0].files.some((f) => f.headers?.Origin === 'https://galeria-fotos.carvalhovini2002.workers.dev'),
);
check('foto já excluída: 404', (await api('POST', `/api/albums/${TEST}/delete-photos`, { body: { photoIds: ['DSC_0001'] } })).status === 404);

console.log('\nPurge com falha');
await mock('/__purge-mode?fail=1', 'POST');
const del2 = await api('POST', `/api/albums/${COPY}/delete-photos`, { body: { photoIds: ['DSC_0001'] } });
check('exclusão continua funcionando', del2.status === 200 && del2.data.deletedObjects === 6);
check('purge falho é reportado', del2.data?.purge.failed.length === 7 && /recusou/.test(del2.data.purge.message ?? ''), JSON.stringify(del2.data?.purge));
await mock('/__purge-mode?fail=0', 'POST');
const retry = await api('POST', '/api/purge', { body: { urls: del2.data.purge.failed } });
check('nova tentativa limpa tudo', retry.status === 200 && retry.data.purged.length === 7 && retry.data.failed.length === 0);

console.log('\nAlterações simultâneas (ETag)');
const [r1, r2, r3] = await Promise.all([
  api('PATCH', `/api/albums/${COPY}`, { body: { title: 'Cópia renomeada' } }),
  api('POST', `/api/albums/${TEST}/delete-photos`, { body: { photoIds: ['DSC_0002'] } }),
  api('PATCH', '/api/albums/2026-10-04_ibirapuera', { body: { title: 'Ibirapuera local' } }),
]);
check('as 3 operações terminam com 200', [r1, r2, r3].every((r) => r.status === 200), [r1, r2, r3].map((r) => r.status).join(','));
const after = await albums();
check('nenhuma alteração se perdeu', after.find((a) => a.id === COPY)?.title === 'Cópia renomeada' && !after.some((a) => a.id === TEST) && after.find((a) => a.id === '2026-10-04_ibirapuera')?.title === 'Ibirapuera local');
check('álbum que ficou sem fotos saiu do manifest', r2.data?.albumRemoved === true);

console.log('\nExcluir álbum');
check('título errado: 400', (await api('DELETE', `/api/albums/${COPY}`, { body: { confirmTitle: 'Outro' } })).status === 400);
check('sem cabeçalho customizado: 403', (await api('DELETE', `/api/albums/${COPY}`, { mutationHeader: false, body: { confirmTitle: 'Cópia renomeada' } })).status === 403);
await mock('/__purge-log', 'DELETE');
const delAlbum = await api('DELETE', `/api/albums/${COPY}`, { body: { confirmTitle: ' cópia renomeada ' } });
check('título com maiúsculas diferentes: 400', delAlbum.status === 400);
const delAlbum2 = await api('DELETE', `/api/albums/${COPY}`, { body: { confirmTitle: ' Cópia  renomeada ' } });
check('título certo: 200, apaga os 6 arquivos restantes', delAlbum2.status === 200 && delAlbum2.data.deletedObjects === 6, JSON.stringify(delAlbum2.data));
check('álbum sumiu do manifest', !(await find(COPY)));

console.log('\nPurge em lotes (cópia local do Ibirapuera)');
const ibira = await find('2026-10-04_ibirapuera');
await mock('/__purge-log', 'DELETE');
const many = ibira.photos.slice(0, 100).map((p) => p.id);
const big = await api('POST', '/api/albums/2026-10-04_ibirapuera/delete-photos', { body: { photoIds: many } });
log = await mock('/__purge-log');
check('601 URLs: 20 chamadas no Worker, nenhuma com mais de 100 itens', big.status === 200 && log.length === 20 && log.every((c) => c.files.length <= 100), `${log.length} chamadas`);
check('o que passou do teto volta como pendente', big.data?.purge.purged.length === 500 && big.data.purge.pending.length === 101, JSON.stringify({ p: big.data?.purge.purged.length, pend: big.data?.purge.pending.length }));
const rest = await api('POST', '/api/purge', { body: { urls: big.data.purge.pending } });
check('pendentes limpos numa segunda chamada', rest.status === 200 && rest.data.purged.length === 101 && rest.data.pending.length === 0);

console.log(failures === 0 ? '\nTodos os testes passaram.' : `\n${failures} teste(s) falharam.`);
process.exitCode = failures === 0 ? 0 : 1;
