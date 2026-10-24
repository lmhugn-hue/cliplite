import type { Clip, LutPreset, Project } from '../types';
import { clipEnd, fadeFactor } from '../model';
import type { DrawLayer } from './compositor';
import { renderText, textKey, TEXT_SUPERSAMPLE } from './text';

export interface FrameSource {
  source: TexImageSource;
  width: number;
  height: number;
  dynamic: boolean;
  version: string;
}

/** Visual clips active at time t, bottom layer first. Tracks listed lower in the timeline draw underneath. */
export function activeVisualClips(p: Project, t: number): Clip[] {
  const order = new Map<string, number>();
  p.tracks.forEach((tr, i) => order.set(tr.id, p.tracks.length - i));
  const hidden = new Set(p.tracks.filter((tr) => tr.hidden).map((tr) => tr.id));
  return p.clips
    .filter((c) => c.kind !== 'audio' && !hidden.has(c.trackId) && t >= c.start && t < clipEnd(c))
    .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
}

export function buildLayers(
  p: Project,
  t: number,
  luts: LutPreset[],
  resolve: (clip: Clip) => FrameSource | null,
): DrawLayer[] {
  const layers: DrawLayer[] = [];
  for (const clip of activeVisualClips(p, t)) {
    let src: FrameSource | null;
    if (clip.kind === 'text' && clip.text) {
      const canvas = renderText(clip.text);
      src = {
        source: canvas,
        width: canvas.width / TEXT_SUPERSAMPLE,
        height: canvas.height / TEXT_SUPERSAMPLE,
        dynamic: false,
        version: textKey(clip.text),
      };
    } else src = resolve(clip);
    if (!src) continue;
    const lut = clip.kind === 'text' ? null : (luts.find((l) => l.id === clip.filter.lutId) ?? null);
    layers.push({
      key: clip.id,
      source: src.source,
      srcW: src.width,
      srcH: src.height,
      dynamic: src.dynamic,
      version: src.version,
      fit: clip.kind === 'text' ? 'native' : 'contain',
      x: clip.x,
      y: clip.y,
      scale: clip.scale,
      rotation: clip.rotation,
      opacity: clip.opacity * fadeFactor(clip, t),
      lut,
      intensity: clip.filter.intensity,
      adjust: clip.kind === 'text' ? null : clip.adjust,
    });
  }
  return layers;
}
