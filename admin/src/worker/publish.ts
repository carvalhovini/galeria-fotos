import { ALBUM_ID_RE, INBOX_META_FILE, type PublishRun, type PublishStatus } from '../shared/types';
import type { Env } from './env';
import { HttpError, isLoopback } from './http';

// Gravado ao disparar: cobre os segundos em que a execução ainda não aparece na API do GitHub.
const MARKER_KEY = '_publishing.json';
const MARKER_WINDOW_MS = 3 * 60 * 1000;
const CACHE_MS = 10 * 1000;
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_RE = /^[A-Za-z0-9_.-]+\.ya?ml$/;
const RUN_NAME_RE = /^Publicar (\S+)$/;

interface Marker {
  albumId: string;
  at: number;
  runId: number | null;
}

interface GithubConfig {
  base: string;
  token: string;
  repo: string;
  workflow: string;
  ref: string;
}

let cache: { at: number; value: PublishStatus } | null = null;

function githubConfig(env: Env): GithubConfig | null {
  const token = env.GITHUB_TOKEN?.trim();
  const repo = env.GITHUB_REPO?.trim();
  const workflow = env.GITHUB_WORKFLOW?.trim();
  const ref = env.GITHUB_REF?.trim();
  if (!token || !repo || !REPO_RE.test(repo) || !workflow || !WORKFLOW_RE.test(workflow) || !ref) return null;
  let base = 'https://api.github.com';
  const override = env.GITHUB_API_BASE?.trim();
  if (override) {
    try {
      const url = new URL(override);
      if (isLoopback(url)) base = url.origin;
      else console.warn('publish: GITHUB_API_BASE ignorado (só vale para 127.0.0.1 ou localhost)');
    } catch {
      console.warn('publish: GITHUB_API_BASE inválido, ignorado');
    }
  }
  return { base, token, repo, workflow, ref };
}

async function github(cfg: GithubConfig, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${cfg.base}/repos/${cfg.repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'galeria-admin',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

async function readMarker(env: Env): Promise<Marker | null> {
  const obj = await env.INBOX.get(MARKER_KEY);
  if (!obj) return null;
  try {
    const data = (await obj.json()) as Marker;
    return typeof data.at === 'number' ? data : null;
  } catch {
    return null;
  }
}

interface GithubRun {
  id: number;
  status: string;
  conclusion: string | null;
  display_title?: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

async function latestRun(cfg: GithubConfig): Promise<PublishRun | null> {
  const res = await github(cfg, `/actions/workflows/${cfg.workflow}/runs?per_page=1`);
  if (!res.ok) {
    console.warn(`publish: GitHub respondeu ${res.status} ao listar execuções`);
    await res.body?.cancel();
    throw new Error('github');
  }
  const data = (await res.json()) as { workflow_runs?: GithubRun[] };
  const run = data.workflow_runs?.[0];
  if (!run) return null;

  const out: PublishRun = {
    id: run.id,
    albumId: run.display_title?.match(RUN_NAME_RE)?.[1] ?? null,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    step: null,
    stepsDone: 0,
    stepsTotal: 0,
  };
  if (run.status !== 'completed' || run.conclusion === 'failure') {
    const jobsRes = await github(cfg, `/actions/runs/${run.id}/jobs?per_page=5`);
    if (jobsRes.ok) {
      const jobs = (await jobsRes.json()) as { jobs?: { steps?: { name: string; status: string; conclusion: string | null }[] }[] };
      const steps = (jobs.jobs?.[0]?.steps ?? []).filter((s) => !/^(Set up job|Complete job|Post )/.test(s.name));
      out.stepsTotal = steps.length;
      out.stepsDone = steps.filter((s) => s.status === 'completed').length;
      const failed = steps.find((s) => s.conclusion === 'failure');
      out.step = (failed ?? steps.find((s) => s.status === 'in_progress') ?? null)?.name ?? null;
    } else {
      await jobsRes.body?.cancel();
    }
  }
  return out;
}

// Estado da publicação. `busy` bloqueia envio e exclusões; se o GitHub não responder, fica
// bloqueado por segurança (uma publicação pode estar rodando).
export async function publishStatus(env: Env, { fresh = false } = {}): Promise<PublishStatus> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const cfg = githubConfig(env);
  const marker = await readMarker(env);
  const markerActive = marker !== null && Date.now() - marker.at < MARKER_WINDOW_MS;
  let value: PublishStatus;

  if (!cfg) {
    value = {
      configured: false,
      busy: markerActive,
      message: markerActive ? 'Uma publicação foi disparada há pouco.' : null,
      run: null,
    };
  } else {
    try {
      const run = await latestRun(cfg);
      const runActive = run !== null && ACTIVE.has(run.status);
      // A execução disparada ainda não apareceu se a mais recente é anterior ao disparo.
      const notYetListed = markerActive && (!run || Date.parse(run.createdAt) < marker!.at - 5000);
      const busy = runActive || notYetListed;
      value = {
        configured: true,
        busy,
        message: busy ? `Publicação em andamento${run?.albumId && runActive ? ` (${run.albumId})` : ''}.` : null,
        run,
      };
    } catch {
      value = {
        configured: true,
        busy: true,
        message: 'Não foi possível consultar o GitHub para saber se há publicação em andamento. Tente de novo em instantes.',
        run: null,
      };
    }
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function assertNotPublishing(env: Env): Promise<void> {
  const status = await publishStatus(env);
  if (status.busy) {
    throw new HttpError(409, `${status.message ?? 'Publicação em andamento.'} Envio e exclusões ficam bloqueados até ela terminar.`, 'publishing');
  }
}

export async function startPublish(env: Env, albumId: string): Promise<PublishStatus> {
  if (!ALBUM_ID_RE.test(albumId)) throw new HttpError(404, 'Álbum não encontrado.');
  const cfg = githubConfig(env);
  if (!cfg) throw new HttpError(500, 'Publicação não configurada: falta o secret GITHUB_TOKEN ou as vars do GitHub.');

  const status = await publishStatus(env, { fresh: true });
  if (status.busy) throw new HttpError(409, status.message ?? 'Já existe uma publicação em andamento.', 'publishing');

  const listing = await env.INBOX.list({ prefix: `${albumId}/` });
  const photos = listing.objects.filter((o) => o.key !== `${albumId}/${INBOX_META_FILE}`).length;
  if (photos === 0) throw new HttpError(400, 'Esse álbum não tem fotos na entrada para publicar.');

  const res = await github(cfg, `/actions/workflows/${cfg.workflow}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: cfg.ref, inputs: { albumId }, return_run_details: true }),
  });
  if (res.status !== 200 && res.status !== 204) {
    console.warn(`publish: GitHub recusou o disparo (${res.status})`);
    await res.body?.cancel();
    const hint =
      res.status === 401 || res.status === 403
        ? 'confira se o token do GitHub vale e tem permissão Actions: Read and write'
        : res.status === 404 || res.status === 422
          ? 'confira o repositório, o arquivo do workflow e o branch nas vars'
          : 'tente de novo';
    throw new HttpError(502, `O GitHub recusou o disparo da publicação (HTTP ${res.status}): ${hint}.`);
  }
  let runId: number | null = null;
  if (res.status === 200) {
    try {
      runId = ((await res.json()) as { workflow_run_id?: number }).workflow_run_id ?? null;
    } catch {
      runId = null;
    }
  }
  const marker: Marker = { albumId, at: Date.now(), runId };
  await env.INBOX.put(MARKER_KEY, JSON.stringify(marker), { httpMetadata: { contentType: 'application/json' } });
  cache = null;
  console.log(`publish: disparado para ${albumId}`);
  return publishStatus(env, { fresh: true });
}

export const PUBLISH_MARKER_KEY = MARKER_KEY;
