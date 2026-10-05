import fs from 'node:fs/promises';
import path from 'node:path';
import exifr from 'exifr';
import { INPUT_EXTENSIONS } from './config.js';

const ALBUM_DIR_RE = /^(\d{4}-\d{2}-\d{2})_([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function parseAlbumDir(dir) {
  const name = path.basename(path.resolve(dir));
  const match = name.match(ALBUM_DIR_RE);
  if (!match) {
    throw new Error(
      `Nome de pasta inválido: "${name}". Use AAAA-MM-DD_nome-do-jogo, só com letras minúsculas sem acento, números e hífens.`,
    );
  }
  const [, date, slug] = match;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Data inválida no nome da pasta: "${date}".`);
  }
  const words = slug.replace(/-/g, ' ');
  return { id: name, date, title: words.charAt(0).toUpperCase() + words.slice(1) };
}

export function sanitizePhotoId(baseName) {
  return baseName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Lista as fotos da pasta com photoId sanitizado. Ids que colidem (inclusive só por
// maiúsculas/minúsculas, já que o disco do macOS não diferencia) ficam em `duplicates`.
export async function listPhotos(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .filter((e) => INPUT_EXTENSIONS.includes(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  const photos = [];
  const duplicates = [];
  const seen = new Map();
  for (const name of files) {
    const id = sanitizePhotoId(path.basename(name, path.extname(name)));
    if (!id) {
      duplicates.push({ name, reason: 'o nome não gera um id válido' });
      continue;
    }
    const key = id.toLowerCase();
    if (seen.has(key)) {
      duplicates.push({ name, reason: `gera o mesmo id "${id}" que ${seen.get(key)}` });
      continue;
    }
    seen.set(key, name);
    photos.push({ id, name, file: path.join(dir, name) });
  }
  return { photos, duplicates };
}

export async function readExifInfo(file) {
  let exif;
  try {
    exif = await exifr.parse(file, {
      tiff: true,
      exif: true,
      interop: true,
      gps: false,
      xmp: false,
      icc: false,
      iptc: false,
      jfif: false,
      ihdr: false,
      translateValues: false,
      reviveValues: true,
    });
  } catch {
    exif = undefined;
  }
  if (!exif) return { takenAt: null, colorSpace: null, interopIndex: null };

  const date = exif.DateTimeOriginal ?? exif.CreateDate ?? null;
  let takenAt = date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
  const subSec = exif.SubSecTimeOriginal ?? exif.SubSecTimeDigitized;
  if (takenAt !== null && subSec != null && /^\d+$/.test(String(subSec).trim())) {
    takenAt += Number(`0.${String(subSec).trim()}`) * 1000;
  }
  return {
    takenAt,
    colorSpace: exif.ColorSpace ?? null,
    interopIndex: exif.InteropIndex ?? null,
  };
}

export function sortByTakenAt(photos) {
  return [...photos].sort((a, b) => {
    if (a.takenAt !== b.takenAt) {
      if (a.takenAt === null) return 1;
      if (b.takenAt === null) return -1;
      return a.takenAt - b.takenAt;
    }
    return a.name.localeCompare(b.name, 'en', { numeric: true });
  });
}
