import type { LutPreset } from './types';
import builtinCube from './presets/maunhat.cube?raw';

export function parseCube(text: string, id: string, fallbackName: string, builtIn = false): LutPreset {
  let size = 0;
  let title = '';
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (upper.startsWith('LUT_3D_SIZE')) size = parseInt(line.split(/\s+/)[1], 10);
    else if (upper.startsWith('LUT_1D_SIZE')) throw new Error('1D LUTs are not supported; use a 3D .cube file.');
    else if (upper.startsWith('DOMAIN_MIN')) domainMin = line.split(/\s+/).slice(1).map(Number);
    else if (upper.startsWith('DOMAIN_MAX')) domainMax = line.split(/\s+/).slice(1).map(Number);
    else if (/^[-+.\d]/.test(line)) {
      const parts = line.split(/\s+/);
      values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
  }
  if (!size || size < 2 || size > 128) throw new Error('Missing or invalid LUT_3D_SIZE.');
  const count = size * size * size;
  if (values.length < count * 3) throw new Error(`Expected ${count} LUT entries, found ${values.length / 3}.`);
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    for (let ch = 0; ch < 3; ch++) {
      const v = (values[i * 3 + ch] - domainMin[ch]) / (domainMax[ch] - domainMin[ch] || 1);
      data[i * 4 + ch] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }
    data[i * 4 + 3] = 255;
  }
  return { id, name: fallbackName || title || 'LUT', size, data, builtIn };
}

export const BUILTIN_LUTS: LutPreset[] = [parseCube(builtinCube, 'maunhat', 'Mau Nhat', true)];

/** Trilinear lookup on the CPU, used for filter thumbnails. */
export function applyLutPixel(lut: LutPreset, r: number, g: number, b: number, out: number[]) {
  const n = lut.size;
  const s = (n - 1) / 255;
  const fr = r * s, fg = g * s, fb = b * s;
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(r0 + 1, n - 1), g1 = Math.min(g0 + 1, n - 1), b1 = Math.min(b0 + 1, n - 1);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const d = lut.data;
  const at = (ri: number, gi: number, bi: number, ch: number) => d[((bi * n + gi) * n + ri) * 4 + ch];
  for (let ch = 0; ch < 3; ch++) {
    const c00 = at(r0, g0, b0, ch) * (1 - dr) + at(r1, g0, b0, ch) * dr;
    const c10 = at(r0, g1, b0, ch) * (1 - dr) + at(r1, g1, b0, ch) * dr;
    const c01 = at(r0, g0, b1, ch) * (1 - dr) + at(r1, g0, b1, ch) * dr;
    const c11 = at(r0, g1, b1, ch) * (1 - dr) + at(r1, g1, b1, ch) * dr;
    const c0 = c00 * (1 - dg) + c10 * dg;
    const c1 = c01 * (1 - dg) + c11 * dg;
    out[ch] = c0 * (1 - db) + c1 * db;
  }
}

const sampleImage = (() => {
  let cached: string | null = null;
  return () => {
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 96;
    const g = c.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, 60);
    sky.addColorStop(0, '#4a90d9');
    sky.addColorStop(1, '#f2c48d');
    g.fillStyle = sky;
    g.fillRect(0, 0, 160, 60);
    g.fillStyle = '#3d7a3a';
    g.fillRect(0, 60, 160, 36);
    g.fillStyle = '#e0ac8a';
    g.beginPath();
    g.arc(110, 52, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c0392b';
    g.fillRect(30, 50, 30, 30);
    cached = c.toDataURL();
    return cached;
  };
})();

const previewCache = new Map<string, Promise<string>>();

/** Returns a data URL of `src` (or a built-in sample scene) with the LUT applied. */
export function lutPreview(lut: LutPreset | null, src?: string): Promise<string> {
  const image = src ?? sampleImage();
  if (!lut) return Promise.resolve(image);
  const key = `${lut.id}|${image.length}|${image.slice(-64)}`;
  let p = previewCache.get(key);
  if (!p) {
    p = new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = Math.min(160, img.width);
        const h = Math.round((img.height / img.width) * w);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0, w, h);
        const px = g.getImageData(0, 0, w, h);
        const out = [0, 0, 0];
        for (let i = 0; i < px.data.length; i += 4) {
          applyLutPixel(lut, px.data[i], px.data[i + 1], px.data[i + 2], out);
          px.data[i] = out[0];
          px.data[i + 1] = out[1];
          px.data[i + 2] = out[2];
        }
        g.putImageData(px, 0, 0);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(image);
      img.src = image;
    });
    previewCache.set(key, p);
  }
  return p;
}
