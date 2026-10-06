import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

export function isPreconditionFailed(err) {
  return statusOf(err) === 412 || err?.name === 'PreconditionFailed';
}

// Retorna { text, etag }, ou null se o objeto não existir.
export async function getText(client, bucket, key) {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return { text: await res.Body.transformToString('utf-8'), etag: res.ETag };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

// Todos os objetos com o prefixo: [{ key, size }].
export async function listObjects(client, bucket, prefix) {
  const out = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const obj of res.Contents ?? []) out.push({ key: obj.Key, size: obj.Size ?? 0 });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

// Grava num arquivo temporário e renomeia no fim, para nunca deixar arquivo pela metade.
export async function downloadToFile(client, bucket, key, filePath) {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const tmp = `${filePath}.part`;
  try {
    await pipeline(res.Body, createWriteStream(tmp));
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export async function deleteObject(client, bucket, key) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// `ifMatch` / `ifNoneMatch` tornam a escrita condicional (falha com 412 se a condição não vale).
export async function putObject(client, bucket, key, body, { contentType, cacheControl, ifMatch, ifNoneMatch }) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
      IfMatch: ifMatch,
      IfNoneMatch: ifNoneMatch,
    }),
  );
}
