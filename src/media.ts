import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { MediaKind, MediaRecord } from './types';
import { uid } from './model';
import { db } from './db';
import { store, type MediaEntry } from './store';

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mov', 'webm', 'mkv', 'm4v'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(ext)) return 'audio';
  return null;
}

function once<T extends Event>(el: EventTarget, ok: string, fail = 'error', ms = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out reading media.')), ms);
    el.addEventListener(ok, (e) => (clearTimeout(timer), resolve(e as T)), { once: true });
    el.addEventListener(fail, () => (clearTimeout(timer), reject(new Error('This file format is not supported by the browser.'))), { once: true });
  });
}

function snapshot(source: CanvasImageSource, w: number, h: number, maxW = 240): string {
  const scale = Math.min(1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

async function probeVideo(url: string, blob: Blob) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  await once(v, 'loadeddata');
  const duration = v.duration;
  v.currentTime = Math.min(1, duration / 3);
  await once(v, 'seeked').catch(() => undefined);
  const thumb = snapshot(v, v.videoWidth, v.videoHeight);
  let hasAudio = false;
  try {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    hasAudio = !!(await input.getPrimaryAudioTrack());
    input.dispose();
  } catch {
    hasAudio = true;
  }
  const result = { duration, width: v.videoWidth, height: v.videoHeight, thumb, hasAudio };
  v.removeAttribute('src');
  v.load();
  return result;
}

async function probeImage(url: string) {
  const img = new Image();
  img.src = url;
  await once(img, 'load');
  return { duration: 0, width: img.naturalWidth, height: img.naturalHeight, thumb: snapshot(img, img.naturalWidth, img.naturalHeight), hasAudio: false };
}

async function probeAudio(url: string) {
  const a = document.createElement('audio');
  a.preload = 'metadata';
  a.src = url;
  await once(a, 'loadedmetadata');
  return { duration: a.duration, width: 0, height: 0, thumb: undefined, hasAudio: true };
}

/** Renders a waveform strip covering the whole file, used as the audio clip background. */
async function waveform(blob: Blob): Promise<string | undefined> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 8000);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const bars = Math.min(2000, Math.max(200, Math.round(buf.duration * 20)));
    const data = buf.getChannelData(0);
    const step = Math.floor(data.length / bars) || 1;
    const c = document.createElement('canvas');
    c.width = bars;
    c.height = 48;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < bars; i++) {
      let peak = 0;
      for (let j = i * step; j < (i + 1) * step && j < data.length; j += 4) peak = Math.max(peak, Math.abs(data[j]));
      const h = Math.max(1, peak * 46);
      g.fillRect(i, 24 - h / 2, 1, h);
    }
    return c.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

export async function importFiles(files: File[]): Promise<MediaRecord[]> {
  const added: MediaRecord[] = [];
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) {
      store.toast(`Skipped ${file.name}: unsupported file type.`);
      continue;
    }
    const url = URL.createObjectURL(file);
    try {
      const info = kind === 'video' ? await probeVideo(url, file) : kind === 'image' ? await probeImage(url) : await probeAudio(url);
      if (kind !== 'image' && !(info.duration > 0 && Number.isFinite(info.duration)))
        throw new Error('Could not read the media duration.');
      const record: MediaRecord = { id: uid(), name: file.name, kind, mime: file.type, importedAt: Date.now(), ...info };
      addMediaEntry({ record, blob: file, url });
      added.push(record);
      void db.putMedia({ record, blob: file });
      if (kind === 'audio' || (kind === 'video' && info.hasAudio)) {
        void waveform(file).then((wf) => {
          if (!wf) return;
          const entry = store.get().media[record.id];
          if (!entry) return;
          const updated = { ...entry.record, waveform: wf };
          addMediaEntry({ ...entry, record: updated });
          void db.putMedia({ record: updated, blob: entry.blob });
        });
      }
    } catch (e) {
      URL.revokeObjectURL(url);
      store.toast(`Could not import ${file.name}: ${(e as Error).message}`);
    }
  }
  return added;
}

export function addMediaEntry(entry: MediaEntry) {
  store.set({ media: { ...store.get().media, [entry.record.id]: entry } });
}

export async function restoreMedia() {
  const all = await db.allMedia();
  const media: Record<string, MediaEntry> = {};
  for (const m of all) media[m.record.id] = { ...m, url: URL.createObjectURL(m.blob) };
  store.set({ media });
}

export function removeMedia(id: string) {
  const { media } = store.get();
  const entry = media[id];
  if (!entry) return;
  const next = { ...media };
  delete next[id];
  URL.revokeObjectURL(entry.url);
  store.set({ media: next });
  void db.deleteMedia(id);
}
