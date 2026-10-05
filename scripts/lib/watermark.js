import fs from 'node:fs';
import opentype from 'opentype.js';
import { WATERMARK } from './config.js';

let font;

function loadFont() {
  if (!font) {
    const buf = fs.readFileSync(WATERMARK.fontFile);
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return font;
}

// Gera a marca d'água como SVG de caminhos (sem depender de fontes do sistema),
// pronta para o composite do sharp numa imagem de width x height.
export function createWatermark(width, height) {
  const f = loadFont();
  const { text, widthRatio, marginRatio, color, opacity, shadow } = WATERMARK;
  const longSide = Math.max(width, height);
  const targetWidth = longSide * widthRatio;
  const margin = longSide * marginRatio;

  const ref = f.getPath(text, 0, 0, 1000).getBoundingBox();
  const fontSize = (targetWidth / (ref.x2 - ref.x1)) * 1000;

  const bb = f.getPath(text, 0, 0, fontSize).getBoundingBox();
  const textW = bb.x2 - bb.x1;
  const textH = bb.y2 - bb.y1;

  const blur = fontSize * shadow.blur;
  const dx = fontSize * shadow.offsetX;
  const dy = fontSize * shadow.offsetY;
  const pad = Math.ceil(blur * 3 + Math.max(Math.abs(dx), Math.abs(dy)));

  const d = f.getPath(text, pad - bb.x1, pad - bb.y1, fontSize).toPathData(2);
  const svgW = Math.ceil(textW) + pad * 2;
  const svgH = Math.ceil(textH) + pad * 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
<defs><filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${blur.toFixed(2)}"/></filter></defs>
<g opacity="${opacity}">
<path d="${d}" fill="${shadow.color}" fill-opacity="${shadow.opacity}" filter="url(#s)" transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)})"/>
<path d="${d}" fill="${color}"/>
</g>
</svg>`;

  const left = Math.max(0, Math.round(width - margin - textW - pad));
  const top = Math.max(0, Math.round(height - margin - textH - pad));

  return { input: Buffer.from(svg), left, top };
}
