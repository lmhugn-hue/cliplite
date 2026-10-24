import { useEffect, useRef, useState } from 'react';
import { formatTime, projectDuration, ASPECTS } from '../model';
import { PreviewEngine, playback } from '../render/preview';
import { store, useClock, useStore } from '../store';
import type { Aspect } from '../types';
import { Icon } from './controls';

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const aspect = useStore((s) => s.project.aspect);
  const duration = useStore((s) => projectDuration(s.project));
  const playing = useClock((c) => c.playing);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ratio = ASPECTS[aspect];
  const boxW = Math.max(0, Math.min(stage.w, stage.h * ratio));
  const boxH = boxW / ratio;

  useEffect(() => {
    const engine = new PreviewEngine(canvasRef.current!);
    engineRef.current = engine;
    playback.engine = engine;
    return () => {
      playback.engine = null;
      engine.dispose();
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const hit = engine.hitTest(nx, ny);
    store.select(hit);
    if (!hit) return;
    const clip = store.get().project.clips.find((c) => c.id === hit);
    if (!clip) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = clip.x;
    const oy = clip.y;
    store.beginGesture();
    const move = (ev: PointerEvent) => {
      let x = ox + (ev.clientX - startX) / rect.width;
      let y = oy + (ev.clientY - startY) / rect.height;
      if (Math.abs(x) < 0.01) x = 0;
      if (Math.abs(y) < 0.01) y = 0;
      store.live((p) => ({ ...p, clips: p.clips.map((c) => (c.id === hit ? { ...c, x, y } : c)) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="panel preview-panel">
      <div className="preview-stage" ref={stageRef}>
        <canvas ref={canvasRef} onPointerDown={onPointerDown} style={{ width: boxW, height: boxH }} />
      </div>
      <div className="transport">
        <TimeReadout duration={duration} />
        <button className="play-btn" onClick={() => playback.toggle()} title="Play / pause (Space)">
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <select
          className="aspect-select"
          value={aspect}
          onChange={(e) => store.commit((p) => ({ ...p, aspect: e.target.value as Aspect }))}
          title="Canvas ratio"
        >
          {(Object.keys(ASPECTS) as Aspect[]).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

function TimeReadout({ duration }: { duration: number }) {
  const time = useClock((c) => c.time);
  return (
    <span className="time-readout">
      <b>{formatTime(Math.min(time, duration || time))}</b> / {formatTime(duration)}
    </span>
  );
}