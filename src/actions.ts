import type { Clip, MediaRecord, TextStyle } from './types';
import {
  appendMedia,
  clipEnd,
  insertTrack,
  makeClip,
  mainTrack,
  MIN_CLIP,
  overlaps,
  placeClip,
  pruneTracks,
  retimed,
  rippleMain,
  sourceTime,
  splitClip,
  uid,
} from './model';
import { clock, store } from './store';

export function selectedClip(): Clip | undefined {
  const { project, selectedId } = store.get();
  return project.clips.find((c) => c.id === selectedId);
}

/** Changes the average rate while keeping the same source range, then closes gaps on the magnetic main track. */
export function commitTiming(id: string, speed: number, extra: Partial<Clip> = {}) {
  const { project, media } = store.get();
  const current = project.clips.find((c) => c.id === id);
  const record = current?.mediaId ? media[current.mediaId]?.record : undefined;
  updateClip(
    id,
    (c) => {
      let next = retimed(c, speed, extra);
      let duration = next.duration ?? c.duration;
      if (!c.hold && record && next.speed) duration = Math.min(duration, (record.duration - c.in) / next.speed);
      const p = store.get().project;
      const end = p.clips.filter((x) => x.trackId === c.trackId && x.start >= clipEnd(c) - 1e-6).reduce((m, x) => Math.min(m, x.start), Infinity);
      const magneticMain = p.magnetic && c.trackId === mainTrack(p)?.id;
      if (!magneticMain && overlaps(p, c.trackId, c.start, c.start + duration, c.id)) duration = Math.min(duration, Math.max(0.05, end - c.start));
      return { ...next, duration };
    },
    `${id}:speed`,
  );
  if (current && current.trackId === mainTrack(store.get().project)?.id) store.commit(rippleMain, `${id}:speed`);
}

const FREEZE_LEN = 2;

/** Inserts a still of the frame under the playhead and shifts the rest of that track forward. */
export function freezeAtPlayhead() {
  const t = clock.time;
  const { project, media } = store.get();
  const clip = project.clips.find((c) => c.kind === 'video' && !c.hold && t >= c.start && t < clipEnd(c) && media[c.mediaId!]);
  if (!clip) {
    store.toast('Move the playhead over a video clip to freeze a frame.');
    return;
  }
  const frame = sourceTime(clip, t);
  const interior = t > clip.start + MIN_CLIP / 2 && t < clipEnd(clip) - MIN_CLIP / 2;
  const at = interior ? t : t - clip.start <= MIN_CLIP / 2 ? clip.start : clipEnd(clip);
  store.commit((p) => {
    const split = interior ? splitClip(p, clip.id, t) : null;
    const base = split?.project ?? p;
    const frozen: Clip = {
      ...clip,
      id: uid(),
      start: at,
      duration: FREEZE_LEN,
      in: frame,
      speed: 1,
      curve: [],
      reversed: false,
      hold: true,
      volume: 0,
      fadeIn: 0,
      fadeOut: 0,
    };
    const clips = base.clips.map((c) => (c.trackId === clip.trackId && c.start >= at - 1e-6 ? { ...c, start: c.start + FREEZE_LEN } : c));
    const next = { ...base, clips: [...clips, frozen] };
    return clip.trackId === mainTrack(p)?.id ? rippleMain(next) : next;
  });
  store.toast('Froze 2 seconds on that frame.');
}

export function updateClip(id: string, patch: Partial<Clip> | ((c: Clip) => Partial<Clip>), coalesceKey?: string) {
  store.commit(
    (p) => ({
      ...p,
      clips: p.clips.map((c) => (c.id === id ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)),
    }),
    coalesceKey,
  );
}

export function addMediaToTimeline(media: MediaRecord) {
  let clipId = '';
  store.commit((p) => {
    const r = appendMedia(p, media);
    clipId = r.clipId;
    return r.project;
  });
  store.select(clipId);
}

export function dropMediaAt(media: MediaRecord, trackId: string | null, start: number) {
  const kind = media.kind;
  const clip = makeClip(kind, trackId ?? '', Math.max(0, start), media);
  store.commit((p) => {
    const track = p.tracks.find((t) => t.id === trackId);
    const compatible = track && (track.kind === (kind === 'image' ? 'video' : kind));
    if (compatible && !overlaps(p, track.id, clip.start, clipEnd(clip))) return { ...p, clips: [...p.clips, { ...clip, trackId: track.id }] };
    return placeClip(p, clip);
  });
  store.select(clip.id);
}

export function addText(style?: Partial<TextStyle>, place?: Partial<Pick<Clip, 'x' | 'y' | 'scale'>>) {
  const t = clock.time;
  const clip = makeClip('text', '', t, undefined, style as TextStyle);
  store.commit((p) => placeClip(p, { ...clip, ...place }));
  store.select(clip.id);
}

export function splitAtPlayhead() {
  const t = clock.time;
  const { project, selectedId } = store.get();
  const sel = project.clips.find((c) => c.id === selectedId && t > c.start && t < clipEnd(c));
  const targets = sel ? [sel] : project.clips.filter((c) => t > c.start && t < clipEnd(c));
  if (!targets.length) {
    store.toast('Move the playhead over a clip to split it.');
    return;
  }
  let nextSel: string | null = selectedId;
  store.commit((p) => {
    let out = p;
    for (const c of targets) {
      const r = splitClip(out, c.id, t);
      if (r) {
        out = r.project;
        if (c.id === selectedId) nextSel = r.rightId;
      }
    }
    return out;
  });
  store.select(nextSel);
}

export function deleteSelected() {
  const { selectedId, project } = store.get();
  const clip = project.clips.find((c) => c.id === selectedId);
  if (!clip) return;
  const onMain = clip.trackId === mainTrack(project)?.id;
  store.commit((p) => {
    const next = { ...p, clips: p.clips.filter((c) => c.id !== clip.id) };
    return pruneTracks(onMain ? rippleMain(next) : next);
  });
  store.select(null);
}

export function duplicateSelected() {
  const clip = selectedClip();
  if (!clip) return;
  const copy: Clip = { ...clip, id: uid(), start: clipEnd(clip) };
  store.commit((p) => {
    if (!overlaps(p, clip.trackId, copy.start, clipEnd(copy))) return { ...p, clips: [...p.clips, copy] };
    return placeClip(p, copy);
  });
  store.select(copy.id);
}

export function applyFilter(lutId: string | null, toAll = false) {
  const { selectedId, project } = store.get();
  const sel = project.clips.find((c) => c.id === selectedId);
  if (!toAll && (!sel || sel.kind === 'text' || sel.kind === 'audio')) {
    store.toast('Select a video or image clip first, or use "Apply to all".');
    return;
  }
  store.commit((p) => ({
    ...p,
    clips: p.clips.map((c) =>
      (toAll ? c.kind === 'video' || c.kind === 'image' : c.id === sel!.id) ? { ...c, filter: { lutId, intensity: c.filter.intensity || 1 } } : c,
    ),
  }));
}

export function applyLookToAll(source: Clip) {
  store.commit((p) => ({
    ...p,
    clips: p.clips.map((c) => (c.kind === 'video' || c.kind === 'image' ? { ...c, filter: { ...source.filter }, adjust: { ...source.adjust } } : c)),
  }));
  store.toast('Filter and adjustments applied to all clips.');
}

export function addTrack(kind: 'video' | 'audio' | 'text') {
  store.commit((p) => insertTrack(p, kind).project);
}
