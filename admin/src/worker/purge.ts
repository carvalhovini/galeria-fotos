import type { PurgeResult } from '../shared/types';
import type { Env } from './env';
import { isLoopback, sleep } from './http';

// Limite atual da API de purge por URL nos planos Free, Pro e Business: 100 itens por chamada.
const ITEMS_PER_CALL = 100;
// O plano Free do Workers permite 50 subrequisições externas por chamada; o resto volta como pendente.
const MAX_CALLS_PER_REQUEST = 20;
const PAUSE_BETWEEN_CALLS_MS = 150;
const ZONE_ID_RE = /^[0-9a-f]{32}$/i;

type PurgeItem = string | { url: string; headers: { Origin: string } };
type CallOutcome = { ok: true } | { ok: false; fatal: boolean; message: string };

export function purgeOrigins(env: Env): string[] {
  const origins = new Set<string>();
  for (const raw of (env.PURGE_ORIGINS ?? '').split(/[\s,]+/)) {
    if (!raw) continue;
    try {
      origins.add(new URL(raw).origin);
    } catch {
      console.warn('purge: ignorando uma origem inválida em PURGE_ORIGINS');
    }
  }
  return [...origins];
}

function apiBase(env: Env): string {
  const override = env.CF_API_BASE?.trim();
  if (override) {
    try {
      const url = new URL(override);
      if (isLoopback(url)) return url.origin;
    } catch {
      // cai no padrão
    }
    console.warn('purge: CF_API_BASE ignorado (só vale para 127.0.0.1 ou localhost)');
  }
  return 'https://api.cloudflare.com';
}

async function callPurge(endpoint: string, token: string, files: PurgeItem[], retryOn429 = true): Promise<CallOutcome> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
  } catch {
    console.warn('purge: falha de rede ao chamar a API da Cloudflare');
    return { ok: false, fatal: false, message: 'Não foi possível falar com a API da Cloudflare.' };
  }

  if (res.status === 429 && retryOn429) {
    const waitS = Math.min(Number(res.headers.get('retry-after')) || 2, 10);
    await res.body?.cancel();
    await sleep(waitS * 1000);
    return callPurge(endpoint, token, files, false);
  }

  let body: { success?: boolean; errors?: { code?: number; message?: string }[] } | null = null;
  try {
    body = await res.json();
  } catch {
    // corpo não é JSON
  }
  if (res.ok && body?.success) return { ok: true };

  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const detail = errors.length
    ? errors.map((e) => `${e.code ?? '?'}: ${e.message ?? 'erro'}`).join('; ')
    : `HTTP ${res.status}`;
  console.warn(`purge: recusado pela API (${detail})`);
  return {
    ok: false,
    fatal: res.status === 401 || res.status === 403,
    message: `A API da Cloudflare recusou o purge (${detail}).`,
  };
}

// Limpa o cache das URLs, incluindo as cópias guardadas por origem (a resposta das fotos varia
// com o cabeçalho Origin por causa do CORS). Cada URL vira 1 + N itens, sempre no mesmo lote.
export async function purgeUrls(env: Env, urls: string[]): Promise<PurgeResult> {
  const unique = [...new Set(urls)];
  const result: PurgeResult = { configured: true, purged: [], failed: [], pending: [] };
  if (unique.length === 0) return result;

  const token = env.CF_API_TOKEN?.trim();
  const zone = env.CF_ZONE_ID?.trim();
  if (!token || !zone) {
    return { ...result, configured: false, failed: unique, message: 'Purge não configurado: faltam os secrets CF_API_TOKEN e CF_ZONE_ID.' };
  }
  if (!ZONE_ID_RE.test(zone)) {
    return { ...result, configured: false, failed: unique, message: 'O secret CF_ZONE_ID não tem o formato de um ID de zona.' };
  }

  const endpoint = `${apiBase(env)}/client/v4/zones/${zone}/purge_cache`;
  const origins = purgeOrigins(env);
  const urlsPerCall = Math.max(1, Math.floor(ITEMS_PER_CALL / (1 + origins.length)));

  let index = 0;
  let calls = 0;
  while (index < unique.length && calls < MAX_CALLS_PER_REQUEST) {
    const batch = unique.slice(index, index + urlsPerCall);
    index += batch.length;
    if (calls > 0) await sleep(PAUSE_BETWEEN_CALLS_MS);
    calls++;

    const files = batch.flatMap((url): PurgeItem[] => [url, ...origins.map((Origin) => ({ url, headers: { Origin } }))]);
    const outcome = await callPurge(endpoint, token, files);
    if (outcome.ok) {
      result.purged.push(...batch);
      continue;
    }
    result.failed.push(...batch);
    result.message ??= outcome.message;
    if (outcome.fatal) {
      result.failed.push(...unique.slice(index));
      index = unique.length;
    }
  }
  result.pending = unique.slice(index);
  return result;
}
