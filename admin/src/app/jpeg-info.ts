export interface JpegInfo {
  jpeg: boolean;
  width: number | null;
  height: number | null;
  exif: boolean;
  takenAt: string | null;
}

const HEADER_BYTES = 256 * 1024;
const EXIF_DATE_RE = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

// Lê só o começo do arquivo: dimensões do quadro (SOF) e se há EXIF com data. Serve para
// conferir se o celular entregou a foto original ou uma cópia reduzida/convertida.
export async function readJpegInfo(file: Blob): Promise<JpegInfo> {
  const bytes = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const info: JpegInfo = { jpeg: false, width: null, height: null, exif: false, takenAt: null };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return info;
  info.jpeg = true;

  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && i + 9 <= bytes.length) {
      info.height = (bytes[i + 5] << 8) | bytes[i + 6];
      info.width = (bytes[i + 7] << 8) | bytes[i + 8];
      break;
    }
    if (marker === 0xe1 && !info.exif) {
      const segment = bytes.subarray(i + 4, Math.min(i + 2 + length, bytes.length));
      const head = String.fromCharCode(...segment.subarray(0, 6));
      if (head === 'Exif\0\0') {
        info.exif = true;
        const text = String.fromCharCode(...segment.subarray(0, Math.min(segment.length, 8192)));
        const m = text.match(EXIF_DATE_RE);
        if (m) info.takenAt = `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
      }
    }
    if (marker === 0xda) break;
    i += 2 + length;
  }
  return info;
}
