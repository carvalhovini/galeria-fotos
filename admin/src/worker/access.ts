import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './env';
import { isLoopback } from './http';

export interface AccessIdentity {
  email: string | null;
}

let jwksCache: { origin: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;

// Aceita "time.cloudflareaccess.com" ou a URL completa. Exige https (exceto loopback, para testes).
export function teamOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value || value.includes('[')) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !isLoopback(url)) return null;
  return url.origin;
}

export function accessAudience(env: Env): string | null {
  const aud = env.ACCESS_AUD?.trim();
  return aud && !aud.includes('[') ? aud : null;
}

// Valida o JWT que o Access injeta: assinatura (chaves do time, escolhidas pelo `kid`),
// emissor, audiência e expiração. Retorna null em qualquer falha.
export async function verifyAccess(request: Request, env: Env): Promise<AccessIdentity | null> {
  const origin = teamOrigin(env.ACCESS_TEAM_DOMAIN);
  const audience = accessAudience(env);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!origin || !audience || !token) return null;

  if (jwksCache?.origin !== origin) {
    jwksCache = { origin, jwks: createRemoteJWKSet(new URL(`${origin}/cdn-cgi/access/certs`)) };
  }
  try {
    const { payload } = await jwtVerify(token, jwksCache.jwks, {
      issuer: origin,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp'],
      clockTolerance: 5,
    });
    return { email: typeof payload.email === 'string' ? payload.email : null };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    console.warn(`access: JWT recusado (${typeof code === 'string' ? code : 'erro ao validar'})`);
    return null;
  }
}
