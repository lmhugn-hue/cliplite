import type { Clip } from '../types';
import { clipEnd, fadeFactor, outputSize, projectDuration, rateAt, sourceTime } from '../model';
import { clock, store } from '../store';
import { Compositor } from './compositor';
import { buildLayers, type FrameSource } from './layers';

interface ElementEntry {
  el: HTMLMediaElement;
  gain: GainNode | null;
  mediaId: string;
}

/** Drives live preview: syncs one media element per clip to the playhead and composites the visible frame. */
export class PreviewEngine {
  private compositor: Compositor;
  private elements = new Map<string, ElementEntry>();
  private images = new Map<string, HTMLImageElement>();
  private audioCtx: AudioContext | null = null;
  private raf = 0;
  private playStartWall = 0;
  private playStartTime = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.compositor = new Compositor(canvas);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private ensureAudio() {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    return this.audioCtx;
  }

  play() {
    const { project } = store.get();
    const dur = projectDuration(project);
    if (dur <= 0) return;
    this.ensureAudio();
    let t = clock.time;
    if (t >= dur - 0.02) t = 0;
    this.playStartTime = t;
    this.playStartWall = performance.now();
    clock.set(t, true);
  }

  pause() {
    clock.set(clock.time, false);
    for (const e of this.elements.values()) e.el.pause();
  }

  toggle() {
    if (clock.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const dur = projectDuration(store.get().project);
    const clamped = Math.max(0, Math.min(t, dur));
    if (clock.playing) {
      this.playStartTime = clamped;
      this.playStartWall = performance.now();
    }
    clock.set(clamped);
  }

  hitTest(nx: number, ny: number) {
    return this.compositor.hitTest(nx, ny);
  }

  private element(clip: Clip): ElementEntry | null {
    const media = clip.mediaId ? store.get().media[clip.mediaId] : undefined;
    if (!media) return null;
    let entry = this.elements.get(clip.id);
    if (entry && entry.mediaId !== media.record.id) {
      this.dropElement(clip.id);
      entry = undefined;
    }
    if (!entry) {
      const el = document.createElement(media.record.kind === 'audio' ? 'audio' : 'video') as HTMLMediaElement;
      el.src = media.url;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      (el as HTMLVideoElement).playsInline = true;
      let gain: GainNode | null = null;
      if (this.audioCtx) {
        const src = this.audioCtx.createMediaElementSource(el);
        gain = this.audioCtx.createGain();
        src.connect(gain).connect(this.audioCtx.destination);
      } else el.muted = true;
      entry = { el, gain, mediaId: media.record.id };
      this.elements.set(clip.id, entry);
    } else if (!entry.gain && this.audioCtx) {
      // Element was created before audio was unlocked; rebuild it with an audio graph.
      this.dropElement(clip.id);
      return this.element(clip);
    }
    return entry;
  }

  private dropElement(id: string) {
    const e = this.elements.get(id);
    if (!e) return;
    e.el.pause();
    e.el.removeAttribute('src');
    e.el.load();
    e.gain?.disconnect();
    this.elements.delete(id);
  }

  private image(mediaId: string): HTMLImageElement | null {
    const media = store.get().media[mediaId];
    if (!media) return null;
    let img = this.images.get(mediaId);
    if (!img) {
      img = new Image();
      img.src = media.url;
      this.images.set(mediaId, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  private syncMedia(t: number, playing: boolean) {
    const { project, media } = store.get();
    const muted = new Set(project.tracks.filter((tr) => tr.muted).map((tr) => tr.id));
    const live = new Set<string>();
    for (const clip of project.clips) {
      if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
      const active = t >= clip.start && t < clipEnd(clip);
      const upcoming = !active && clip.start > t && clip.start - t < 1.5;
      if (!active && !upcoming) continue;
      const entry = this.element(clip);
      if (!entry) continue;
      live.add(clip.id);
      const el = entry.el;
      const target = active ? sourceTime(clip, t) : clip.in;
      if (!active) {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
        continue;
      }
      const hasAudio = clip.kind === 'audio' || (media[clip.mediaId!]?.record.hasAudio ?? false);
      const vol = muted.has(clip.trackId) || !hasAudio || clip.hold || clip.reversed ? 0 : clip.volume * fadeFactor(clip, t);
      if (entry.gain) entry.gain.gain.value = vol;
      el.preservesPitch = clip.preservePitch;
      el.playbackRate = Math.min(16, Math.max(0.0625, clip.hold ? 1 : rateAt(clip, t)));
      if (clip.hold || clip.reversed) {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - target) > 0.03) el.currentTime = target;
        continue;
      }
      if (playing) {
        if (el.paused) {
          el.currentTime = target;
          void el.play().catch(() => undefined);
        } else if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
      }
    }
    for (const [id, entry] of this.elements) {
      if (live.has(id)) continue;
      if (!project.clips.some((c) => c.id === id)) this.dropElement(id);
      else if (!entry.el.paused) entry.el.pause();
    }
  }

  private resolve = (clip: Clip): FrameSource | null => {
    if (clip.kind === 'image') {
      const img = clip.mediaId ? this.image(clip.mediaId) : null;
      return img ? { source: img, width: img.naturalWidth, height: img.naturalHeight, dynamic: false, version: img.src } : null;
    }
    const entry = this.elements.get(clip.id);
    const v = entry?.el as HTMLVideoElement | undefined;
    if (!v || v.readyState < 2 || !v.videoWidth) return null;
    return { source: v, width: v.videoWidth, height: v.videoHeight, dynamic: true, version: '' };
  };

  private loop() {
    this.raf = requestAnimationFrame(this.loop);
    const { project, luts } = store.get();
    let t = clock.time;
    if (clock.playing) {
      const dur = projectDuration(project);
      t = this.playStartTime + (performance.now() - this.playStartWall) / 1000;
      if (t >= dur) {
        t = dur;
        clock.set(t, false);
      } else clock.set(t);
    }
    this.syncMedia(t, clock.playing);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const out = outputSize(project.aspect, 1080);
    const maxW = (this.canvas.clientWidth || 640) * dpr;
    const maxH = (this.canvas.clientHeight || 360) * dpr;
    const s = Math.min(maxW / out.width, maxH / out.height, 1);
    this.compositor.resize(Math.max(2, Math.round(out.width * s)), Math.max(2, Math.round(out.height * s)));
    this.compositor.render(buildLayers(project, t, luts, this.resolve), project.background);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const id of [...this.elements.keys()]) this.dropElement(id);
    this.compositor.dispose();
    void this.audioCtx?.close();
  }
}

export const playback = {
  engine: null as PreviewEngine | null,
  seek(t: number) {
    if (this.engine) this.engine.seek(t);
    else clock.set(Math.max(0, t));
  },
  toggle() {
    this.engine?.toggle();
  },
  pause() {
    this.engine?.pause();
  },
};
