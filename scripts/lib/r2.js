import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { UPLOAD } from './config.js';

// R2_ENDPOINT é opcional e serve só para testar contra um servidor S3 local.
export function createR2Client(env) {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT?.trim() || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function statusOf(err) {
  return err?.$metadata?.httpStatusCode;
}

function isNotFound(err) {
  return statusOf(err) === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey';
}

function isRetryable(err) {
  const status = statusOf(err);
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

// Mensagens de rede podem conter o host com o Account ID; `secrets` são mascarados.
export function describeError(err, secrets = []) {
  const status = statusOf(err);
  let text = [err?.name, status ? `HTTP ${status}` : null, err?.message].filter(Boolean).join(': ');
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('***');
  }
  return text;
}

export async function withRetry(fn, { onRetry } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= UPLOAD.maxAttempts || !isRetryable(err)) throw err;
      const delay = UPLOAD.retryBaseDelayMs * 2 ** (attempt - 1);
      onRetry?.(err, attempt, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Retorna o tamanho do objeto no bucket, ou null se não existir.
export async function headSize(client, bucket, key) {
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return res.ContentLength ?? 0;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function getText(client, bucket, key) {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return await res.Body.transformToString('utf-8');
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function putObject(client, bucket, key, body, { contentType, cacheControl }) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}
