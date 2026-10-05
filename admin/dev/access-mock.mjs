// Só para desenvolvimento local. Simula o Cloudflare Access e a API de purge:
// - http://127.0.0.1:8788/cdn-cgi/access/certs  chaves públicas de teste (JWKS)
// - http://127.0.0.1:8788/client/v4/zones/:zone/purge_cache  purge falso, com registro
// - http://127.0.0.1:8790  proxy para o wrangler dev (8787) que injeta um JWT válido,
//   como o Access faz em produção. Escuta só em 127.0.0.1: nunca exponha na rede.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const ADMIN_DIR = path.resolve(import.meta.dirname, '..');
const KEY_FILE = path.join(ADMIN_DIR, '.wrangler', 'dev-access', 'keys.json');
const ISSUER_PORT = 8788;
const PROXY_PORT = 8790;
const TARGET = { host: '127.0.0.1', port: 8787 };
const ISSUER = `http://127.0.0.1:${ISSUER_PORT}`;
const EMAIL = 'voce@exemplo.com';

async function readDevVar(name, fallback) {
  try {
    const text = await fs.readFile(path.join(ADMIN_DIR, '.dev.vars'), 'utf8');
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : fallback;
  } catch {
    return fallback;
  }
}

const AUD = await readDevVar('ACCESS_AUD', 'galeria-admin-local');
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const kid = crypto.randomUUID();
const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
await fs.mkdir(path.dirname(KEY_FILE), { recursive: true });
await fs.writeFile(
  KEY_FILE,
  JSON.stringify({ issuer: ISSUER, aud: AUD, email: EMAIL, kid, privateJwk: { ...(await exportJWK(privateKey)), kid, alg: 'RS256' } }),
  { mode: 0o600 },
);

const signToken = () =>
  new SignJWT({ email: EMAIL, type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(ISSUER)
    .setAudience([AUD])
    .setSubject('usuario-local')
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('10m')
    .sign(privateKey);

const purgeLog = [];
let purgeFail = false;

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, ISSUER);
    if (req.method === 'GET' && url.pathname === '/cdn-cgi/access/certs') {
      return sendJson(res, 200, { keys: [publicJwk] });
    }
    const purge = url.pathname.match(/^\/client\/v4\/zones\/([^/]+)\/purge_cache$/);
    if (req.method === 'POST' && purge) {
      if (!/^Bearer \S+$/.test(req.headers.authorization ?? '')) {
        return sendJson(res, 403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });
      }
      const body = JSON.parse(await readBody(req));
      const files = Array.isArray(body.files) ? body.files : [];
      purgeLog.push({ zone: purge[1], files, failed: purgeFail });
      if (files.length > 100) {
        return sendJson(res, 400, { success: false, errors: [{ code: 1134, message: 'Too many files (max 100)' }] });
      }
      if (purgeFail) return sendJson(res, 503, { success: false, errors: [{ code: 1000, message: 'Falha simulada' }] });
      return sendJson(res, 200, { success: true, errors: [], result: { id: 'local' } });
    }
    if (url.pathname === '/__purge-log') {
      if (req.method === 'DELETE') purgeLog.length = 0;
      return sendJson(res, 200, purgeLog);
    }
    if (req.method === 'POST' && url.pathname === '/__purge-mode') {
      purgeFail = url.searchParams.get('fail') === '1';
      return sendJson(res, 200, { fail: purgeFail });
    }
    sendJson(res, 404, { error: 'não encontrado' });
  })
  .listen(ISSUER_PORT, '127.0.0.1', () => console.log(`Access e purge falsos em ${ISSUER}`));

http
  .createServer(async (req, res) => {
    const headers = { ...req.headers };
    delete headers['cf-access-jwt-assertion'];
    headers['cf-access-jwt-assertion'] = await signToken();
    const upstream = http.request({ ...TARGET, method: req.method, path: req.url, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('wrangler dev não está rodando em 127.0.0.1:8787.');
    });
    req.pipe(upstream);
  })
  .listen(PROXY_PORT, '127.0.0.1', () => console.log(`Gerenciador com login simulado em http://127.0.0.1:${PROXY_PORT}`));
