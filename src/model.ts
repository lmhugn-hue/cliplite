import type { Aspect, Clip, ClipKind, MediaRecord, Project, TextStyle, Track, TrackKind } from './types';

export const MIN_CLIP = 0.1;
export const IMAGE_DEFAULT_DURATION = 5;
export const TEXT_DEFAULT_DURATION = 3;

export const uid = () => crypto.randomUUID().slice(0, 13);

export const ASPECTS: Record<Aspect, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '3:4': 3 / 4,
};

export function outputSize(aspect: Aspect, shortSide: number): { width: number; height: number } {
  const r = ASPECTS[aspect];
  const even = (n: number) => Math.round(n / 2) * 2;
  return r >= 1
    ? { width: even(shortSide * r), height: shortSide }
    : { width: shortSide, height: even(shortSide / r) };
}

export function newTrack(kind: TrackKind): Track {
  return { id: uid(), kind, muted: false, hidden: false };
}

export function newProject(): Project {
  return {
    version: 1,
    name: 'Untitled project',
    aspect: '16:9',
    background: '#000000',
    magnetic: true,
    tracks: [newTrack('video')],
    clips: [],
  };
}

export const DEFAULT_TEXT: TextStyle = {
  content: 'Enter text',
  fontFamily: 'Segoe UI',
  fontSize: 72,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0,
  background: null,
  bold: true,
  italic: false,
  align: 'center',
};

export function trackKindFor(kind: ClipKind): TrackKind {
  return kind === 'image' ? 'video' : kind;
}

export function clipEnd(c: Clip) {
  return c.start + c.duration;
}

export function projectDuration(p: Project) {
  return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

export function mainTrack(p: Project): Track | undefined {
  const videos = p.tracks.filter((t) => t.kind === 'video');
  return videos[videos.length - 1];
}

export function makeClip(kind: ClipKind, trackId: string, start: number, media?: MediaRecord, text?: TextStyle): Clip {
  const duration =
    kind === 'text' ? TEXT_DEFAULT_DURATION : kind === 'image' ? IMAGE_DEFAULT_DURATION : (media?.duration ?? 1);
  return {
    id: uid(),
    trackId,
    kind,
    mediaId: media?.id,
    start,
    duration,
    in: 0,
    speed: 1,
    volume: 1,
    opacity: 1,
    x: 0,
    y: kind === 'text' ? 0.3 : 0,
    scale: 1,
    rotation: 0,
    fadeIn: 0,
    fadeOut: 0,
    filter: { lutId: null, intensity: 1 },
    adjust: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
    text: kind === 'text' ? { ...DEFAULT_TEXT, ...text } : undefined,
  };
}

export function overlaps(p: Project, trackId: string, start: number, end: number, ignoreId?: string) {
  return p.clips.some(
    (c) => c.trackId === trackId && c.id !== ignoreId && start < clipEnd(c) - 1e-6 && end > c.start + 1e-6,
  );
}

/** Inserts a track of the given kind at the conventional position: text on top, video above existing video, audio at the bottom. */
export function insertTrack(p: Project, kind: TrackKind): { project: Project; track: Track } {
  const track = newTrack(kind);
  const tracks = [...p.tracks];
  if (kind === 'text') tracks.unshift(track);
  else if (kind === 'audio') tracks.push(track);
  else {
    const firstVideo = tracks.findIndex((t) => t.kind === 'video');
    const firstNonText = tracks.findIndex((t) => t.kind !== 'text');
    tracks.splice(firstVideo >= 0 ? firstVideo : firstNonText >= 0 ? firstNonText : tracks.length, 0, track);
  }
  return { project: { ...p, tracks }, track };
}

/** Finds a track of the right kind with room at [start, start+duration), creating one if needed. */
export function placeClip(p: Project, clip: Clip, preferredTrackId?: string): Project {
  const kind = trackKindFor(clip.kind);
  const end = clip.start + clip.duration;
  const candidates = [
    ...p.tracks.filter((t) => t.id === preferredTrackId && t.kind === kind),
    ...[...p.tracks].reverse().filter((t) => t.kind === kind && t.id !== preferredTrackId),
  ];
  const free = candidates.find((t) => !overlaps(p, t.id, clip.start, end));
  if (free) return { ...p, clips: [...p.clips, { ...clip, trackId: free.id }] };
  const { project, track } = insertTrack(p, kind);
  return { ...project, clips: [...project.clips, { ...clip, trackId: track.id }] };
}

/** Appends media to the end of the main video track (or the first audio track for audio). */
export function appendMedia(p: Project, media: MediaRecord): { project: Project; clipId: string } {
  if (media.kind === 'audio') {
    let project = p;
    let track = p.tracks.find((t) => t.kind === 'audio');
    if (!track) ({ project, track } = insertTrack(p, 'audio'));
    const end = project.clips.filter((c) => c.trackId === track!.id).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const clip = makeClip('audio', track.id, end, media);
    return { project: { ...project, clips: [...project.clips, clip] }, clipId: clip.id };
  }
  const main = mainTrack(p)!;
  const end = p.clips.filter((c) => c.trackId === main.id).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const clip = makeClip(media.kind, main.id, end, media);
  return { project: { ...p, clips: [...p.clips, clip] }, clipId: clip.id };
}

/** Closes gaps on the main track when magnetic mode is on. */
export function rippleMain(p: Project): Project {
  if (!p.magnetic) return p;
  const main = mainTrack(p);
  if (!main) return p;
  const ordered = p.clips.filter((c) => c.trackId === main.id).sort((a, b) => a.start - b.start);
  let cursor = 0;
  const moved = new Map<string, number>();
  for (const c of ordered) {
    moved.set(c.id, cursor);
    cursor += c.duration;
  }
  return { ...p, clips: p.clips.map((c) => (moved.has(c.id) ? { ...c, start: moved.get(c.id)! } : c)) };
}

export function splitClip(p: Project, clipId: string, t: number): { project: Project; rightId: string } | null {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c || t <= c.start + MIN_CLIP / 2 || t >= clipEnd(c) - MIN_CLIP / 2) return null;
  const leftDur = t - c.start;
  const left: Clip = { ...c, duration: leftDur, fadeOut: 0 };
  const right: Clip = {
    ...c,
    id: uid(),
    start: t,
    duration: c.duration - leftDur,
    in: c.in + leftDur * c.speed,
    fadeIn: 0,
  };
  return { project: { ...p, clips: p.clips.flatMap((x) => (x.id === c.id ? [left, right] : [x])) }, rightId: right.id };
}

/** Removes tracks left empty, keeping at least the main video track. */
export function pruneTracks(p: Project): Project {
  const main = mainTrack(p);
  const used = new Set(p.clips.map((c) => c.trackId));
  const tracks = p.tracks.filter((t) => used.has(t.id) || t.id === main?.id);
  return tracks.length === p.tracks.length ? p : { ...p, tracks };
}

/** Source-media time shown at timeline time t. */
export function sourceTime(c: Clip, t: number) {
  return c.in + (t - c.start) * c.speed;
}

/** Fade multiplier (0..1) at timeline time t. */
export function fadeFactor(c: Clip, t: number) {
  let f = 1;
  if (c.fadeIn > 0) f = Math.min(f, (t - c.start) / c.fadeIn);
  if (c.fadeOut > 0) f = Math.min(f, (clipEnd(c) - t) / c.fadeOut);
  return Math.max(0, Math.min(1, f));
}

/** Longest timeline duration the clip may have, given its media and speed. */
export function maxDuration(c: Clip, media?: MediaRecord) {
  if (c.kind === 'image' || c.kind === 'text' || !media) return Infinity;
  return (media.duration - c.in) / c.speed;
}

export function formatTime(t: number, withFrames = true) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withFrames ? `${base}.${String(cs).padStart(2, '0')}` : base;
}
