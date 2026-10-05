import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');
export const ORIGINALS_DIR = path.join(ROOT_DIR, 'originals');

// Incrementar quando a lógica de geração mudar de um jeito que a configuração abaixo não capture.
export const PIPELINE_VERSION = 1;

export const INPUT_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

export const JPEG_OPTIONS = { quality: 85, mozjpeg: true };

export const VARIANTS = [
  { key: 'thumb', dir: 'thumb', size: 600, watermark: false },
  { key: 'preview', dir: 'preview', size: 1600, watermark: false },
  { key: '4k', dir: 'dl/4k', size: 3840, watermark: true },
  { key: '2k', dir: 'dl/2k', size: 2560, watermark: true },
  { key: 'fhd', dir: 'dl/fhd', size: 1920, watermark: true },
  { key: 'hd', dir: 'dl/hd', size: 1280, watermark: true },
];

// Proporções relativas ao lado maior da imagem final (widthRatio, marginRatio)
// ou ao tamanho da fonte (shadow).
export const WATERMARK = {
  text: '@carvalho_.vini',
  fontFile: path.join(ROOT_DIR, 'assets/fonts/DMSans-Bold.ttf'),
  widthRatio: 0.16,
  marginRatio: 0.025,
  color: '#FFFFFF',
  opacity: 0.75,
  shadow: {
    color: '#000000',
    opacity: 0.55,
    blur: 0.06,
    offsetX: 0,
    offsetY: 0.04,
  },
};

export const UPLOAD = {
  concurrency: 5,
  maxAttempts: 4,
  retryBaseDelayMs: 500,
  photoCacheControl: 'public, max-age=31536000, immutable',
  manifestKey: 'manifest.json',
  manifestCacheControl: 'public, max-age=60',
  manifestContentType: 'application/json; charset=utf-8',
};

export const R2_ENV_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_BASE_URL',
];
