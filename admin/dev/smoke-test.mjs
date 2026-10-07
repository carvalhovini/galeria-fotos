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

console.log('\nManifest antigo (sem capa e sem tags)');
const untouched = list.data.albums.filter((a) => a.id !== TEST);
check('álbuns sem os campos novos são listados', untouched.length > 0 && untouched.every((a) => Array.isArray(a.photos)));
const patchAlbum = (body, id = TEST) => api('PATCH', `/api/albums/${id}`, { body });
check('PATCH sem nenhum campo: 400', (await patchAlbum({})).status === 400);
check('campo desconhecido sozinho: 400', (await patchAlbum({ foo: 1 })).status === 400);

console.log('\nCapa');
const coverSet = await patchAlbum({ cover: 'DSC_0002' });
check('define a capa', coverSet.status === 200 && coverSet.data.album.cover === 'DSC_0002', JSON.stringify(coverSet.data?.album?.cover));
check('capa grava backup', /^manifest-backups\//.test(coverSet.data?.backupKey ?? ''));
check('capa mantém título e fotos', coverSet.data?.album.title === 'Teste renomeado' && coverSet.data.album.photos.length === 2);
check('foto que não está no álbum: 400', (await patchAlbum({ cover: 'NAO_EXISTE' })).status === 400);
check('id de foto inválido: 400', (await patchAlbum({ cover: '../x' })).status === 400);
check('capa numérica: 400', (await patchAlbum({ cover: 12 })).status === 400);
check('capa inválida não altera nada', (await find(TEST)).cover === 'DSC_0002');
const coverNull = await patchAlbum({ cover: null });
check('cover null volta para a primeira foto', coverNull.status === 200 && !('cover' in coverNull.data.album));

console.log('\nTags');
const tagged = await patchAlbum({ tags: ['  Pôr   do Sol ', 'PRAIA', 'praia', '', 'São-Paulo'] });
check(
  'normaliza (minúsculas, sem acento, espaços simples) e remove repetidas',
  tagged.status === 200 && JSON.stringify(tagged.data.album.tags) === '["por do sol","praia","sao-paulo"]',
  JSON.stringify(tagged.data),
);
check('mais de 5 tags: 400', (await patchAlbum({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).status === 400);
check('5 tags com repetidas: 200', (await patchAlbum({ tags: ['a', 'b', 'c', 'd', 'e', 'A', 'é'] })).status === 200);
check('caractere inválido: 400', (await patchAlbum({ tags: ['festa!'] })).status === 400);
check('tag com travessão: 400', (await patchAlbum({ tags: ['a — b'] })).status === 400);
check('tag com mais de 24 caracteres: 400', (await patchAlbum({ tags: ['x'.repeat(25)] })).status === 400);
check('tags que não são lista: 400', (await patchAlbum({ tags: 'praia' })).status === 400);
check('item que não é texto: 400', (await patchAlbum({ tags: ['praia', 3] })).status === 400);
check('tags inválidas não alteram nada', (await find(TEST)).tags?.join() === 'a,b,c,d,e');
const combo = await patchAlbum({ title: 'Teste renomeado', cover: 'DSC_0001', tags: ['rua', 'noite'] });
check('título, capa e tags juntos', combo.status === 200 && combo.data.album.cover === 'DSC_0001' && combo.data.album.tags.join() === 'rua,noite');
check('título inválido não grava capa nem tags', (await patchAlbum({ title: ' ', tags: ['x'] })).status === 400 && (await find(TEST)).tags.join() === 'rua,noite');
const cleared = await patchAlbum({ tags: [] }, COPY);
check('lista vazia em álbum sem tags: sem o campo', cleared.status === 200 && !('tags' in cleared.data.album));
check('outros álbuns continuam sem os campos novos', untouched.every((a) => ('tags' in a) === false) && !('tags' in (await find('2026-10-04_ibirapuera'))));

console.log('\nExcluir foto');
await mock('/__purge-log', 'DELETE');
const del1 = await api('POST', `/api/albums/${TEST}/delete-photos`, { body: { photoIds: ['DSC_0001'] } });
check('200 e álbum com 1 foto', del1.status === 200 && del1.data.album?.photos.length === 1);
check('excluir a foto da capa remove o cover e mantém as tags', !('cover' in (del1.data.album ?? {})) && del1.data.album?.tags?.join() === 'rua,noite');
check('8 arquivos apagados (6 versões + 2 formatos do Instagram)', del1.data?.deletedObjects === 8);
check('purge de 9 URLs (8 versões + manifest)', del1.data?.purge.purged.length === 9 && del1.data.purge.failed.length === 0);
check(
  'purge inclui as versões do Instagram',
  ['dl/ig45', 'dl/ig916'].every((dir) => del1.data?.purge.purged.some((u) => u.includes(`/${dir}/DSC_0001.jpg`))),
);
let log = await mock('/__purge-log');
check('1 chamada com 36 itens (9 URLs x 4 variantes de origem)', log.length === 1 && log[0].files.length === 36, JSON.stringify(log.map((c) => c.files.length)));
check(
  'inclui variantes com Origin de www e workers.dev',
  log[0].files.some((f) => f.headers?.Origin === 'https://www.carvalhovini.com') &&
    log[0].files.some((f) => f.headers?.Origin === 'https://galeria-fotos.carvalhovini2002.workers.dev'),
);
check('foto já excluída: 404', (await api('POST', `/api/albums/${TEST}/delete-photos`, { body: { photoIds: ['DSC_0001'] } })).status === 404);

console.log('\nPurge com falha');
await mock('/__purge-mode?fail=1', 'POST');
const del2 = await api('POST', `/api/albums/${COPY}/delete-photos`, { body: { photoIds: ['DSC_0001'] } });
check('exclusão continua funcionando', del2.status === 200 && del2.data.deletedObjects === 8);
check('purge falho é reportado', del2.data?.purge.failed.length === 9 && /recusou/.test(del2.data.purge.message ?? ''), JSON.stringify(del2.data?.purge));
await mock('/__purge-mode?fail=0', 'POST');
const retry = await api('POST', '/api/purge', { body: { urls: del2.data.purge.failed } });
check('nova tentativa limpa tudo', retry.status === 200 && retry.data.purged.length === 9 && retry.data.failed.length === 0);

console.log('\nAlterações simultâneas (ETag)');
const [r1, r2, r3, r4, r5] = await Promise.all([
  api('PATCH', `/api/albums/${COPY}`, { body: { title: 'Cópia renomeada' } }),
  api('POST', `/api/albums/${TEST}/delete-photos`, { body: { photoIds: ['DSC_0002'] } }),
  api('PATCH', '/api/albums/2026-10-04_ibirapuera', { body: { title: 'Ibirapuera local' } }),
  api('PATCH', `/api/albums/${COPY}`, { body: { tags: ['concorrencia'] } }),
  api('PATCH', `/api/albums/${COPY}`, { body: { cover: 'DSC_0002' } }),
]);
const all5 = [r1, r2, r3, r4, r5];
check('as 5 operações terminam com 200', all5.every((r) => r.status === 200), all5.map((r) => r.status).join(','));
const after = await albums();
const copyAfter = after.find((a) => a.id === COPY);
check('nenhuma alteração se perdeu', copyAfter?.title === 'Cópia renomeada' && !after.some((a) => a.id === TEST) && after.find((a) => a.id === '2026-10-04_ibirapuera')?.title === 'Ibirapuera local');
check('título, tags e capa no mesmo álbum ao mesmo tempo', copyAfter?.tags?.join() === 'concorrencia' && copyAfter.cover === 'DSC_0002', JSON.stringify({ t: copyAfter?.tags, c: copyAfter?.cover }));
check('álbum que ficou sem fotos saiu do manifest', r2.data?.albumRemoved === true);

console.log('\nExcluir álbum');
check('título errado: 400', (await api('DELETE', `/api/albums/${COPY}`, { body: { confirmTitle: 'Outro' } })).status === 400);
check('sem cabeçalho customizado: 403', (await api('DELETE', `/api/albums/${COPY}`, { mutationHeader: false, body: { confirmTitle: 'Cópia renomeada' } })).status === 403);
await mock('/__purge-log', 'DELETE');
const delAlbum = await api('DELETE', `/api/albums/${COPY}`, { body: { confirmTitle: ' cópia renomeada ' } });
check('título com maiúsculas diferentes: 400', delAlbum.status === 400);
const delAlbum2 = await api('DELETE', `/api/albums/${COPY}`, { body: { confirmTitle: ' Cópia  renomeada ' } });
check('título certo: 200, apaga os 6 arquivos restantes (o álbum de teste não tem formatos do Instagram)', delAlbum2.status === 200 && delAlbum2.data.deletedObjects === 6, JSON.stringify(delAlbum2.data));
check('álbum sumiu do manifest', !(await find(COPY)));

console.log('\nPurge em lotes (cópia local do Ibirapuera)');
const ibira = await find('2026-10-04_ibirapuera');
await mock('/__purge-log', 'DELETE');
const many = ibira.photos.slice(0, 100).map((p) => p.id);
const big = await api('POST', '/api/albums/2026-10-04_ibirapuera/delete-photos', { body: { photoIds: many } });
log = await mock('/__purge-log');
check('801 URLs: 20 chamadas no Worker, nenhuma com mais de 100 itens', big.status === 200 && log.length === 20 && log.every((c) => c.files.length <= 100), `${log.length} chamadas`);
check('o que passou do teto volta como pendente', big.data?.purge.purged.length === 500 && big.data.purge.pending.length === 301, JSON.stringify({ p: big.data?.purge.purged.length, pend: big.data?.purge.pending.length }));
const rest = await api('POST', '/api/purge', { body: { urls: big.data.purge.pending } });
check('pendentes limpos numa segunda chamada', rest.status === 200 && rest.data.purged.length === 301 && rest.data.pending.length === 0);

// Envio e publicação. O GitHub é o falso do access-mock (GITHUB_API_BASE no .dev.vars).
const UP = '2026-10-05_envio-teste';
const PUBLISHED = '2026-10-04_ibirapuera';
const jpeg = await fs.readFile(path.resolve(ADMIN_DIR, '..', 'output', 'albums', '2026-09-27_teste', 'thumb', 'DSC_0001.jpg'));
const github = (query = '', method = 'POST') => fetch(`${MOCK}/__github${query}`, { method }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function put(albumId, name, body, { headers = {}, mutationHeader = true } = {}) {
  const h = { 'Cf-Access-Jwt-Assertion': validToken, 'Content-Type': 'image/jpeg', ...headers };
  if (mutationHeader) h['X-Galeria-Admin'] = '1';
  const init = { method: 'PUT', headers: h, body };
  if (body instanceof ReadableStream) init.duplex = 'half';
  const res = await fetch(`${API}/api/upload/${albumId}/${encodeURIComponent(name)}`, init);
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

async function waitIdle(timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let s;
  do {
    await sleep(400);
    s = (await api('GET', '/api/publish')).data;
  } while (s.busy && Date.now() < end);
  return s;
}

await github('', 'DELETE');
await github('?stepMs=300&dispatch=200&list=200&failAt=');
validToken = await token();

console.log('\nEnvio para a entrada');
const idle = await api('GET', '/api/publish');
check('estado da publicação: configurado e livre', idle.status === 200 && idle.data.configured === true && idle.data.busy === false, JSON.stringify(idle.data));
check('foto antes de criar o álbum: 409 no-meta', (await put(UP, 'IMG_0001.jpg', jpeg)).data?.code === 'no-meta');
check('título com travessão: 400', (await api('PUT', `/api/upload/${UP}/_album.json`, { body: { title: 'A — B' } })).status === 400);
check('id de álbum inválido: 404', (await api('PUT', '/api/upload/2026-10-05_Maiusculo/_album.json', { body: { title: 'x' } })).status === 404);
const meta = await api('PUT', `/api/upload/${UP}/_album.json`, { body: { title: '  Jogo de Teste:  São Paulo ' } });
check('cria o álbum com acentos', meta.status === 200 && meta.data.title === 'Jogo de Teste: São Paulo' && meta.data.date === '2026-10-05', JSON.stringify(meta.data));
check('PUT sem X-Galeria-Admin: 403', (await put(UP, 'IMG_0001.jpg', jpeg, { mutationHeader: false })).status === 403);
const up1 = await put(UP, 'IMG 0001.JPG', jpeg);
check('envia e sanitiza o nome (IMG 0001.JPG -> IMG-0001.jpg)', up1.status === 200 && up1.data.name === 'IMG-0001.jpg' && up1.data.size === jpeg.length, JSON.stringify(up1.data));
check('Ação.jpeg vira Acao.jpg', (await put(UP, 'Ação.jpeg', jpeg)).data?.name === 'Acao.jpg');
const png = await put(UP, 'foto.png', jpeg);
check('extensão .png: 415', png.status === 415 && png.data?.code === 'type');
const fake = await put(UP, 'falso.jpg', Buffer.from('isto não é um jpeg'));
check('conteúdo que não é JPEG: 415', fake.status === 415 && fake.data?.code === 'type');
const chunked = await put(UP, 'sem-tamanho.jpg', new ReadableStream({ start(c) { c.enqueue(jpeg); c.close(); } }));
check('envio sem Content-Length: 411', chunked.status === 411, String(chunked.status));
const bigBody = Buffer.alloc(20 * 1024 * 1024, 7);
jpeg.copy(bigBody, 0, 0, 3);
const big20 = await put(UP, 'grande.jpg', bigBody);
check('foto de 20 MB em fluxo: 200 com o tamanho certo', big20.status === 200 && big20.data.size === bigBody.length, JSON.stringify(big20.data));
const tooBig = Buffer.alloc(50 * 1024 * 1024 + 1, 7);
jpeg.copy(tooBig, 0, 0, 3);
const big51 = await put(UP, 'enorme.jpg', tooBig);
check('foto acima de 50 MB: 413', big51.status === 413 && big51.data?.code === 'too-large', String(big51.status));

const listing = await api('GET', `/api/upload/${UP}`);
const names = listing.data?.files.map((f) => f.name).sort().join(',');
check('lista para retomar: só as que entraram', names === 'Acao.jpg,IMG-0001.jpg,grande.jpg', names);
check('lista devolve o título original', listing.data?.meta?.title === 'Jogo de Teste: São Paulo');
const inboxList = await api('GET', '/api/inbox');
const inboxAlbum = inboxList.data?.albums.find((a) => a.albumId === UP);
check('entrada lista o álbum com 3 fotos', inboxAlbum?.photos === 3 && inboxAlbum.title === 'Jogo de Teste: São Paulo', JSON.stringify(inboxAlbum));
check('marcador de publicação não aparece como álbum', !inboxList.data?.albums.some((a) => a.albumId.startsWith('_')));

console.log('\nJuntar a álbum publicado');
const pubAlbum = await find(PUBLISHED);
await api('PUT', `/api/upload/${PUBLISHED}/_album.json`, { body: { title: pubAlbum.title } });
const dup = await put(PUBLISHED, `${pubAlbum.photos[0].id}.jpg`, jpeg);
check('foto já publicada: 409 published', dup.status === 409 && dup.data?.code === 'published', JSON.stringify(dup));
const pubList = await api('GET', `/api/upload/${PUBLISHED}`);
check('lista informa as fotos publicadas', pubList.data?.published.length === pubAlbum.photos.length);
check('foto nova no álbum publicado: 200', (await put(PUBLISHED, 'NOVA_0001.jpg', jpeg)).status === 200);
const discard = await api('DELETE', `/api/upload/${PUBLISHED}`);
check('descartar apaga foto e metadados', discard.status === 200 && discard.data.deleted === 2, JSON.stringify(discard.data));

console.log('\nPublicar');
check('álbum sem fotos na entrada: 400', (await api('POST', '/api/publish/2020-01-01_vazio')).status === 400);
check('publicar sem X-Galeria-Admin: 403', (await api('POST', `/api/publish/${UP}`, { mutationHeader: false })).status === 403);
const pub = await api('POST', `/api/publish/${UP}`);
check('dispara e fica ocupado', pub.status === 200 && pub.data.busy === true, JSON.stringify(pub.data));
let gh = await github('', 'GET');
const sent = gh.dispatches.at(-1);
check('disparo com ref, entrada albumId e return_run_details', sent?.workflow === 'publish.yml' && sent.ref === 'main' && sent.inputs?.albumId === UP && sent.return_run_details === true, JSON.stringify(sent));
check('enquanto publica: novo envio 409', (await put(UP, 'IMG_0009.jpg', jpeg)).data?.code === 'publishing');
check('enquanto publica: excluir foto 409', (await api('POST', `/api/albums/${PUBLISHED}/delete-photos`, { body: { photoIds: [pubAlbum.photos[0].id] } })).data?.code === 'publishing');
check('enquanto publica: excluir álbum 409', (await api('DELETE', `/api/albums/${PUBLISHED}`, { body: { confirmTitle: pubAlbum.title } })).data?.code === 'publishing');
check('enquanto publica: descartar 409', (await api('DELETE', `/api/upload/${UP}`)).status === 409);
check('enquanto publica: criar álbum 409', (await api('PUT', '/api/upload/2026-10-06_outro/_album.json', { body: { title: 'Outro' } })).status === 409);
check('enquanto publica: segunda publicação 409', (await api('POST', `/api/publish/${UP}`)).status === 409);
const duringPublish = await api('PATCH', `/api/albums/${PUBLISHED}`, { body: { tags: ['parque'], cover: pubAlbum.photos[1].id } });
check('enquanto publica: capa e tags continuam editáveis', duringPublish.status === 200 && duringPublish.data.album.tags.join() === 'parque', String(duringPublish.status));
await sleep(900);
const mid = (await api('GET', '/api/publish')).data;
check('andamento mostra o passo atual', mid.busy && mid.run?.status === 'in_progress' && typeof mid.run.step === 'string' && mid.run.stepsTotal === 8, JSON.stringify(mid.run));
const done = await waitIdle();
check('execução termina com sucesso e libera', !done.busy && done.run?.conclusion === 'success' && done.run.albumId === UP, JSON.stringify(done));
check('depois de publicar: envio volta a funcionar', (await put(UP, 'IMG_0010.jpg', jpeg)).status === 200);

console.log('\nFalhas do GitHub');
await github('?list=500');
const down = (await api('GET', '/api/publish')).data;
check('GitHub fora do ar: bloqueia por segurança', down.busy === true && /GitHub/.test(down.message ?? ''), JSON.stringify(down));
check('GitHub fora do ar: envio 409', (await put(UP, 'IMG_0011.jpg', jpeg)).data?.code === 'publishing');
await github('?list=200');
check('GitHub de volta: libera', (await api('GET', '/api/publish')).data.busy === false);
await github('?dispatch=403');
const refused = await api('POST', `/api/publish/${UP}`);
check('disparo recusado: 502 com dica do token', refused.status === 502 && /token/.test(refused.data?.error ?? ''), JSON.stringify(refused.data));
check('disparo recusado não deixa bloqueado', (await api('GET', '/api/publish')).data.busy === false);
await github('?dispatch=200&failAt=Processar fotos');
await api('POST', `/api/publish/${UP}`);
const failed = await waitIdle();
check('execução com falha mostra o passo', failed.run?.conclusion === 'failure' && failed.run.step === 'Processar fotos', JSON.stringify(failed.run));
await github('?failAt=');
const cleanup = await api('DELETE', `/api/upload/${UP}`);
check('descartar o envio de teste', cleanup.status === 200 && cleanup.data.deleted === 5, JSON.stringify(cleanup.data));
check('entrada vazia de novo', !(await api('GET', '/api/inbox')).data.albums.some((a) => a.albumId === UP));

console.log(failures === 0 ? '\nTodos os testes passaram.' : `\n${failures} teste(s) falharam.`);
process.exitCode = failures === 0 ? 0 : 1;
