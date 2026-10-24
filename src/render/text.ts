import type { TextStyle } from '../types';

/** Text is rasterised at 2x the 1080-px reference size so it stays sharp at 1080p and above. */
export const TEXT_SUPERSAMPLE = 2;

const cache = new Map<string, HTMLCanvasElement>();

export function textKey(style: TextStyle) {
  return JSON.stringify(style);
}

export function renderText(style: TextStyle): HTMLCanvasElement {
  const key = textKey(style);
  const hit = cache.get(key);
  if (hit) return hit;
  const k = TEXT_SUPERSAMPLE;
  const size = style.fontSize * k;
  const font = `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '400 '}${size}px "${style.fontFamily}", sans-serif`;
  const lines = (style.content || ' ').split('\n');
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const lineHeight = size * 1.25;
  const stroke = style.strokeWidth * k;
  const shadow = style.shadow;
  const shadowPad = shadow ? Math.ceil((Math.abs(shadow.x) + Math.abs(shadow.y) + shadow.blur) * k) : 0;
  const pad = Math.ceil(stroke + size * (style.background ? 0.35 : 0.1)) + shadowPad;
  const textW = Math.max(1, ...lines.map((l) => measure.measureText(l).width));
  const w = Math.ceil(textW + pad * 2);
  const h = Math.ceil(lineHeight * lines.length + pad * 2);

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  if (style.background) {
    g.fillStyle = style.background;
    const r = Math.min(size * 0.25, h / 2);
    g.beginPath();
    g.roundRect(0, 0, w, h, r);
    g.fill();
  }
  g.font = font;
  g.textBaseline = 'middle';
  g.textAlign = style.align;
  g.lineJoin = 'round';
  const x = style.align === 'left' ? pad : style.align === 'right' ? w - pad : w / 2;
  lines.forEach((line, i) => {
    const y = pad + lineHeight * (i + 0.5);
    if (shadow) {
      g.shadowColor = shadow.color;
      g.shadowBlur = shadow.blur * k;
      g.shadowOffsetX = shadow.x * k;
      g.shadowOffsetY = shadow.y * k;
    }
    g.fillStyle = style.color;
    g.fillText(line, x, y);
    g.shadowColor = 'transparent';
    if (stroke > 0) {
      g.strokeStyle = style.strokeColor;
      g.lineWidth = stroke * 2;
      g.strokeText(line, x, y);
      g.fillText(line, x, y);
    }
  });

  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  cache.set(key, c);
  return c;
}
