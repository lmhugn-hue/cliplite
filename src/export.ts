import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  canEncodeAudio,
  canEncodeVideo,
  type WrappedCanvas,
} from 'mediabunny';
import type { Clip, LutPreset, Project } from './types';
import type { MediaEntry } from './store';
import { clipEnd, outputSize, projectDuration } from './model';
import { Compositor } from './render/compositor';
import { buildLayers, type FrameSource } from './render/layers';

export type ExportQuality = 'low' | 'medium' | 'high';

export interface ExportOptions {
  project: Project;
  media: Record<string, MediaEntry>;
  luts: LutPreset[];
  shortSide: number;
  fps: number;
  quality: ExportQuality;
  onProgress: (fraction: number, stage: string) => void;
  signal: AbortSignal;
}

const SAMPLE_RATE = 48000;

async function mixAudio(p: Project, media: Record<string, MediaEntry>, duration: number): Promise<AudioBuffer | null> {
  const muted = new Set(p.tracks.filter((t) => t.muted).map((t) => t.id));
  const clips = p.clips.filter(
    (c) =>
      (c.kind === 'audio' || (c.kind === 'video' && media[c.mediaId!]?.record.hasAudio)) &&
      !muted.has(c.trackId) &&
      c.volume > 0 &&
      media[c.mediaId!],
  );
  if (!clips.length) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const decoded = new Map<string, AudioBuffer | null>();
  for (const clip of clips) {
    if (!decoded.has(clip.mediaId!)) {
      try {
        decoded.set(clip.mediaId!, await ctx.decodeAudioData(await media[clip.mediaId!].blob.arrayBuffer()));
      } catch {
        decoded.set(clip.mediaId!, null);
      }
    }
    const buffer = decoded.get(clip.mediaId!);
    if (!buffer) continue;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = clip.speed;
    const gain = ctx.createGain();
    const end = clipEnd(clip);
    gain.gain.setValueAtTime(clip.fadeIn > 0 ? 0 : clip.volume, clip.start);
    if (clip.fadeIn > 0) gain.gain.linearRampToValueAtTime(clip.volume, clip.start + clip.fadeIn);
    if (clip.fadeOut > 0) {
      gain.gain.setValueAtTime(clip.volume, end - clip.fadeOut);
      gain.gain.linearRampToValueAtTime(0, end);
    }
    src.connect(gain).connect(ctx.destination);
    src.start(clip.start, clip.in, clip.duration * clip.speed);
  }
  return ctx.startRendering();
}

interface ClipReader {
  iterator: AsyncGenerator<WrappedCanvas | null, void, unknown>;
  last: WrappedCanvas | null;
}

export async function exportProject(o: ExportOptions): Promise<Blob> {
  const { project, media, luts, fps, signal } = o;
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('The timeline is empty.');
  const { width, height } = outputSize(project.aspect, o.shortSide);

  if (!(await canEncodeVideo('avc', { width, height }))) throw new Error(`This browser cannot encode H.264 at ${width}x${height}.`);
  const audioCodec = (await canEncodeAudio('aac')) ? 'aac' : 'opus';
  const quality = o.quality === 'high' ? QUALITY_HIGH : o.quality === 'low' ? QUALITY_LOW : QUALITY_MEDIUM;

  o.onProgress(0, 'Mixing audio');
  const mix = await mixAudio(project, media, duration);
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const compositor = new Compositor(canvas, true);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: quality, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource: AudioBufferSource | null = null;
  if (mix) {
    audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH });
    output.addAudioTrack(audioSource);
  }

  const inputs = new Map<string, Input>();
  const readers = new Map<string, ClipReader>();
  const images = new Map<string, ImageBitmap>();
  const totalFrames = Math.max(1, Math.ceil(duration * fps));

  const frameTimes = function* (clip: Clip) {
    const first = Math.ceil(clip.start * fps - 1e-6);
    for (let f = first; f < totalFrames && f / fps < clipEnd(clip); f++) yield clip.in + (f / fps - clip.start) * clip.speed;
  };

  try {
    await output.start();
    if (audioSource && mix) await audioSource.add(mix);

    for (const clip of project.clips) {
      if (clip.kind === 'image' && clip.mediaId && !images.has(clip.mediaId) && media[clip.mediaId])
        images.set(clip.mediaId, await createImageBitmap(media[clip.mediaId].blob));
    }

    const longSide = Math.max(width, height);
    const reader = async (clip: Clip): Promise<ClipReader | null> => {
      let r = readers.get(clip.id);
      if (r) return r;
      const entry = media[clip.mediaId!];
      if (!entry) return null;
      let input = inputs.get(entry.record.id);
      if (!input) {
        input = new Input({ source: new BlobSource(entry.blob), formats: ALL_FORMATS });
        inputs.set(entry.record.id, input);
      }
      const track = await input.getPrimaryVideoTrack();
      if (!track) return null;
      const landscape = track.displayWidth >= track.displayHeight;
      const sink = new CanvasSink(track, landscape ? { width: Math.min(track.displayWidth, longSide) } : { height: Math.min(track.displayHeight, longSide) });
      r = { iterator: sink.canvasesAtTimestamps(frameTimes(clip)), last: null };
      readers.set(clip.id, r);
      return r;
    };

    for (let f = 0; f < totalFrames; f++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = f / fps;
      const frames = new Map<string, FrameSource>();
      for (const clip of project.clips) {
        if (clip.kind !== 'video' || t < clip.start || t >= clipEnd(clip)) continue;
        const r = await reader(clip);
        if (!r) continue;
        const next = await r.iterator.next();
        if (!next.done && next.value) r.last = next.value;
        if (r.last) frames.set(clip.id, { source: r.last.canvas, width: r.last.canvas.width, height: r.last.canvas.height, dynamic: true, version: '' });
      }
      for (const [id, r] of readers) {
        const c = project.clips.find((x) => x.id === id);
        if (c && t >= clipEnd(c)) {
          void r.iterator.return();
          readers.delete(id);
        }
      }
      const layers = buildLayers(project, t, luts, (clip) => {
        if (clip.kind === 'image') {
          const bmp = clip.mediaId ? images.get(clip.mediaId) : undefined;
          return bmp ? { source: bmp, width: bmp.width, height: bmp.height, dynamic: false, version: clip.mediaId! } : null;
        }
        return frames.get(clip.id) ?? null;
      });
      compositor.render(layers, project.background);
      await videoSource.add(t, 1 / fps);
      if (f % 5 === 0) o.onProgress(f / totalFrames, 'Rendering');
    }

    o.onProgress(1, 'Finalizing');
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('Export produced no data.');
    return new Blob([buffer], { type: 'video/mp4' });
  } catch (e) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    for (const r of readers.values()) void r.iterator.return();
    for (const input of inputs.values()) input.dispose();
    for (const bmp of images.values()) bmp.close();
    compositor.dispose();
  }
}
