import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteSelected, dropMediaAt, duplicateSelected, freezeAtPlayhead, splitAtPlayhead } from '../actions';
import { clipEnd, mainTrack, maxDuration, MIN_CLIP, overlaps, projectDuration, pruneTracks, rippleMain, trackKindFor } from '../model';
import { playback } from '../render/preview';
import { clock, store, useClock, useStore } from '../store';
import type { Clip, Project, Track } from '../types';
import { Icon } from './controls';

const HEADER = 84;
const RULER = 26;
const ROW_HEIGHT: Record<Track['kind'], number> = { video: 64, audio: 44, text: 34 };
const SNAP_PX = 8;

function snapPoints(p: Project, excludeId: string) {
  const pts = [0, clock.time];
  for (const c of p.clips) if (c.id !== excludeId) pts.push(c.start, clipEnd(c));
  return pts;
}

function snapValue(value: number, points: number[], pps: number, length = 0): number {
  const thr = SNAP_PX / pps;
  let best = value;
  let dist = thr;
  for (const pt of points) {
    if (Math.abs(value - pt) < dist) (dist = Math.abs(value - pt)), (best = pt);
    if (length && Math.abs(value + length - pt) < dist) (dist = Math.abs(value + length - pt)), (best = pt - length);
  }
  return best;
}

/** Reorders the main track by clip centre so dragging a clip inserts it between neighbours. */
function reorderMain(p: Project, movedId: string): Project {
  const main = mainTrack(p);
  if (!main) return p;
  const ordered = p.clips
    .filter((c) => c.trackId === main.id)
    .sort((a, b) => a.start + a.duration / 2 - (b.start + b.duration / 2) || (a.id === movedId ? -1 : 1));
  let cursor = 0;
  const starts = new Map<string, number>();
  for (const c of ordered) {
    starts.set(c.id, cursor);
    cursor += c.duration;
  }
  return { ...p, clips: p.clips.map((c) => (starts.has(c.id) ? { ...c, start: starts.get(c.id)! } : c)) };
}

export function Timeline() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const [pps, setPps] = useState(60);
  const scrollRef = useRef<HTMLDivElement>(null);
  const duration = projectDuration(project);
  const width = Math.max(duration + 30, 60) * pps;
  const main = mainTrack(project);

  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setPps((v) => Math.max(8, Math.min(400, v * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const seekFromEvent = (e: React.PointerEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const toTime = (x: number) => Math.max(0, (x - rect.left) / pps);
    playback.seek(toTime(e.clientX));
    const move = (ev: PointerEvent) => playback.seek(toTime(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="panel timeline">
      <div className="tl-toolbar">
        <button onClick={() => store.undo()} title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
        <button onClick={() => store.redo()} title="Redo (Ctrl+Shift+Z)"><Icon name="redo" /></button>
        <span className="sep" />
        <button onClick={splitAtPlayhead} title="Split at playhead (S)"><Icon name="split" /> Split</button>
        <button onClick={freezeAtPlayhead} title="Hold the frame under the playhead for 2 seconds">Freeze</button>
        <button onClick={deleteSelected} disabled={!selectedId} title="Delete (Del)"><Icon name="trash" /> Delete</button>
        <button onClick={duplicateSelected} disabled={!selectedId} title="Duplicate (Ctrl+D)"><Icon name="copy" /> Duplicate</button>
        <span className="sep" />
        <button
          className={project.magnetic ? 'toggle on' : 'toggle'}
          onClick={() => store.commit((p) => rippleMain({ ...p, magnetic: !p.magnetic }))}
          title="Magnetic main track: closes gaps and lets you reorder by dragging"
        >
          <Icon name="magnet" /> Magnetic
        </button>
        <span className="grow" />
        <button onClick={() => setPps((v) => Math.max(8, v / 1.4))} title="Zoom out"><Icon name="zoomOut" /></button>
        <input type="range" min={8} max={400} value={pps} onChange={(e) => setPps(Number(e.target.value))} className="zoom" />
        <button onClick={() => setPps((v) => Math.min(400, v * 1.4))} title="Zoom in (Ctrl+wheel)"><Icon name="zoomIn" /></button>
      </div>
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width: HEADER + width }}>
          <div className="tl-ruler-row" style={{ height: RULER }}>
            <div className="tl-corner" style={{ width: HEADER }} />
            <div className="tl-ruler" style={{ width }} onPointerDown={(e) => seekFromEvent(e, e.currentTarget)}>
              <Ruler pps={pps} width={width} />
            </div>
          </div>
          {project.tracks.map((track) => (
            <div className="tl-row" key={track.id} style={{ height: ROW_HEIGHT[track.kind] }}>
              <TrackHeader track={track} isMain={track.id === main?.id} />
              <Lane track={track} project={project} pps={pps} width={width} selectedId={selectedId} isMain={track.id === main?.id} onEmptyPointerDown={seekFromEvent} />
            </div>
          ))}
          <div
            className="tl-row tl-newtrack"
            onDragOver={(e) => e.dataTransfer.types.includes('application/x-media-id') && e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData('application/x-media-id');
              const m = store.get().media[id];
              if (!m) return;
              const rect = e.currentTarget.getBoundingClientRect();
              dropMediaAt(m.record, null, (e.clientX - rect.left - HEADER) / pps);
            }}
          >
            <div className="tl-newtrack-label" style={{ left: HEADER + 8 }}>
              {project.clips.length ? 'Drop media here to add it on a new track' : 'Drag media here, or double-click a media tile to add it'}
            </div>
          </div>
          <Playhead pps={pps} scrollRef={scrollRef} />
        </div>
      </div>
    </section>
  );
}

function Ruler({ pps, width }: { pps: number; width: number }) {
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 80) ?? 600;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t * pps < width; t += step) out.push(t);
    return out;
  }, [pps, width, step]);
  return (
    <>
      {ticks.map((t) => (
        <div key={t} className="tick" style={{ left: t * pps, width: step * pps }}>
          <span>{t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${t}s`}</span>
        </div>
      ))}
    </>
  );
}

function Playhead({ pps, scrollRef }: { pps: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const time = useClock((c) => c.time);
  const playing = useClock((c) => c.playing);
  const x = HEADER + time * pps;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft + HEADER) el.scrollLeft = x - HEADER - 40;
  }, [x, playing, scrollRef]);
  return (
    <div className="playhead" style={{ left: x }}>
      <div className="playhead-knob" />
    </div>
  );
}

function TrackHeader({ track, isMain }: { track: Track; isMain: boolean }) {
  const toggle = (key: 'muted' | 'hidden') =>
    store.commit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, [key]: !t[key] } : t)) }));
  return (
    <div className="tl-header" style={{ width: HEADER }}>
      <span className="tl-header-name">{isMain ? 'Main' : track.kind === 'video' ? 'Overlay' : track.kind === 'audio' ? 'Audio' : 'Text'}</span>
      <div className="tl-header-btns">
        {track.kind !== 'audio' && (
          <button onClick={() => toggle('hidden')} title={track.hidden ? 'Show track' : 'Hide track'} className={track.hidden ? 'off' : ''}>
            <Icon name={track.hidden ? 'eyeOff' : 'eye'} />
          </button>
        )}
        {track.kind !== 'text' && (
          <button onClick={() => toggle('muted')} title={track.muted ? 'Unmute track' : 'Mute track'} className={track.muted ? 'off' : ''}>
            <Icon name={track.muted ? 'mute' : 'volume'} />
          </button>
        )}
      </div>
    </div>
  );
}

function Lane(props: {
  track: Track;
  project: Project;
  pps: number;
  width: number;
  selectedId: string | null;
  isMain: boolean;
  onEmptyPointerDown: (e: React.PointerEvent, el: HTMLElement) => void;
}) {
  const { track, project, pps, width, selectedId, isMain, onEmptyPointerDown } = props;
  const clips = project.clips.filter((c) => c.trackId === track.id);
  return (
    <div
      className={`tl-lane lane-${track.kind}${track.hidden ? ' hidden' : ''}`}
      data-track-id={track.id}
      data-track-kind={track.kind}
      style={{ width }}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        store.select(null);
        onEmptyPointerDown(e, e.currentTarget);
      }}
      onDragOver={(e) => e.dataTransfer.types.includes('application/x-media-id') && e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('application/x-media-id');
        const m = store.get().media[id];
        if (!m) return;
        const rect = e.currentTarget.getBoundingClientRect();
        dropMediaAt(m.record, track.id, (e.clientX - rect.left) / pps);
      }}
    >
      {clips.map((c) => (
        <ClipView key={c.id} clip={c} pps={pps} selected={c.id === selectedId} isMain={isMain} />
      ))}
    </div>
  );
}

function ClipView({ clip, pps, selected, isMain }: { clip: Clip; pps: number; selected: boolean; isMain: boolean }) {
  const media = useStore((s) => (clip.mediaId ? s.media[clip.mediaId]?.record : undefined));
  const lutName = useStore((s) => s.luts.find((l) => l.id === clip.filter.lutId)?.name);

  const style: React.CSSProperties = { left: clip.start * pps, width: Math.max(2, clip.duration * pps) };
  const fullW = media ? (media.duration / clip.speed) * pps : 0;
  const offset = media ? -(clip.in / clip.speed) * pps : 0;
  if (clip.kind === 'video' && media?.thumb) {
    style.backgroundImage = media.waveform ? `url(${media.thumb}), url(${media.waveform})` : `url(${media.thumb})`;
    style.backgroundSize = media.waveform ? `auto calc(100% - 14px), ${fullW}px 14px` : 'auto 100%';
    style.backgroundPosition = media.waveform ? `0 0, ${offset}px 100%` : '0 0';
    style.backgroundRepeat = media.waveform ? 'repeat-x, no-repeat' : 'repeat-x';
  } else if (clip.kind === 'image' && media?.thumb) {
    style.backgroundImage = `url(${media.thumb})`;
    style.backgroundSize = 'auto 100%';
    style.backgroundRepeat = 'repeat-x';
  } else if (clip.kind === 'audio' && media?.waveform) {
    style.backgroundImage = `url(${media.waveform})`;
    style.backgroundSize = `${fullW}px 100%`;
    style.backgroundPosition = `${offset}px 0`;
    style.backgroundRepeat = 'no-repeat';
  }

  const label = clip.kind === 'text' ? clip.text?.content.split('\n')[0] || 'Text' : (media?.name ?? 'Missing media');

  const startMove = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    store.select(clip.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = store.get().project;
    const points = snapPoints(origin, clip.id);
    const origTrack = clip.trackId;
    const kind = trackKindFor(clip.kind);
    let moved = false;
    store.beginGesture();
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
      moved = true;
      let start = Math.max(0, snapValue(clip.start + (ev.clientX - startX) / pps, points, pps, clip.duration));
      start = Math.max(0, start);
      const lane = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-track-id]');
      const trackId = lane && lane.dataset.trackKind === kind ? lane.dataset.trackId! : store.get().project.clips.find((c) => c.id === clip.id)!.trackId;
      store.live((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? { ...c, start, trackId } : c)) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) return store.endGesture(true);
      const p = store.get().project;
      const c = p.clips.find((x) => x.id === clip.id)!;
      const mainId = mainTrack(p)?.id;
      if (p.magnetic && c.trackId === mainId) {
        store.live((q) => pruneTracks(reorderMain(q, clip.id)));
        return store.endGesture();
      }
      if (overlaps(p, c.trackId, c.start, clipEnd(c), c.id)) {
        store.endGesture(true);
        return store.toast('No room there: clips on the same track cannot overlap.');
      }
      if (p.magnetic && origTrack === mainId) store.live((q) => rippleMain(q));
      store.live((q) => pruneTracks(q));
      store.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startTrim = (e: React.PointerEvent, side: 'left' | 'right') => {
    e.stopPropagation();
    store.select(clip.id);
    const startX = e.clientX;
    const p0 = store.get().project;
    const orig = clip;
    const origEnd = clipEnd(orig);
    const points = snapPoints(p0, clip.id);
    const magneticMain = p0.magnetic && isMain;
    const siblings = p0.clips.filter((c) => c.trackId === orig.trackId && c.id !== orig.id);
    const prevEnd = magneticMain ? 0 : siblings.filter((c) => clipEnd(c) <= orig.start + 1e-6).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const nextStart = magneticMain ? Infinity : siblings.filter((c) => c.start >= origEnd - 1e-6).reduce((m, c) => Math.min(m, c.start), Infinity);
        const timed = (orig.kind === 'video' || orig.kind === 'audio') && !orig.hold;
    store.beginGesture();
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - startX) / pps;
      let patch: Partial<Clip>;
      if (side === 'left') {
        const minStart = Math.max(prevEnd, timed ? orig.start - orig.in / orig.speed : 0, 0);
        const start = Math.min(origEnd - MIN_CLIP, Math.max(minStart, snapValue(orig.start + dt, points, pps)));
        patch = { start, duration: origEnd - start, in: timed ? orig.in + (start - orig.start) * orig.speed : orig.in };
      } else {
        const limit = Math.min(nextStart, orig.start + maxDuration(orig, media));
        const end = Math.max(orig.start + MIN_CLIP, Math.min(limit, snapValue(origEnd + dt, points, pps)));
        patch = { duration: end - orig.start };
      }
      store.live((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (magneticMain) store.live((q) => rippleMain(q));
      store.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`clip clip-${clip.kind}${selected ? ' selected' : ''}`} style={style} onPointerDown={startMove}>
      <div className="clip-handle left" onPointerDown={(e) => startTrim(e, 'left')} />
      <div className="clip-label">
        {clip.hold && <span className="badge">Freeze</span>}
        {clip.reversed && <span className="badge">Rev</span>}
        {!clip.hold && clip.curve.length >= 2 && <span className="badge">Ramp</span>}
        {!clip.hold && clip.curve.length < 2 && clip.speed !== 1 && <span className="badge">{clip.speed.toFixed(2).replace(/\.?0+$/, '')}x</span>}
        {lutName && <span className="badge">{lutName}</span>}
        <span className="clip-name">{label}</span>
      </div>
      <div className="clip-handle right" onPointerDown={(e) => startTrim(e, 'right')} />
    </div>
  );
}
