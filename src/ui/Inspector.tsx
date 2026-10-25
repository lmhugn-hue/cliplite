import { useState } from 'react';
import { applyLookToAll, commitTiming, freezeAtPlayhead, updateClip } from '../actions';
import { curveAverage } from '../model';
import { store, useStore } from '../store';
import type { Clip, TextStyle } from '../types';
import { Row, Section, Slider } from './controls';

const FONTS = ['Segoe UI', 'Arial', 'Georgia', 'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Courier New', 'Comic Sans MS'];
const pct = (v: number) => `${Math.round(v * 100)}%`;

type Tab = 'basic' | 'speed' | 'audio' | 'filter' | 'adjust' | 'text';

export function Inspector() {
  const clip = useStore((s) => s.project.clips.find((c) => c.id === s.selectedId));
  return <aside className="panel inspector">{clip ? <ClipInspector clip={clip} key={clip.id} /> : <ProjectInspector />}</aside>;
}

function ProjectInspector() {
  const project = useStore((s) => s.project);
  return (
    <div className="panel-body">
      <Section title="Project">
        <Row label="Name">
          <input value={project.name} onChange={(e) => store.commit((p) => ({ ...p, name: e.target.value }), 'name')} />
        </Row>
        <Row label="Background">
          <input type="color" value={project.background} onChange={(e) => store.commit((p) => ({ ...p, background: e.target.value }), 'bg')} />
        </Row>
      </Section>
      <p className="hint">Select a clip in the timeline or the preview to edit it.</p>
      <div className="shortcuts">
        <b>Shortcuts</b>
        <span>Space</span> play / pause
        <span>S</span> split at playhead
        <span>Del</span> delete clip
        <span>Ctrl+D</span> duplicate
        <span>Ctrl+Z / Ctrl+Shift+Z</span> undo / redo
        <span>← →</span> step one frame (Shift: 1 s)
        <span>Ctrl+wheel</span> zoom timeline
      </div>
    </div>
  );
}

function ClipInspector({ clip }: { clip: Clip }) {
  const media = useStore((s) => (clip.mediaId ? s.media[clip.mediaId]?.record : undefined));
  const luts = useStore((s) => s.luts);
  const tabs: Tab[] =
    clip.kind === 'text'
      ? ['text', 'basic']
      : clip.kind === 'audio'
        ? ['audio', 'speed']
        : clip.kind === 'image'
          ? ['basic', 'filter', 'adjust']
          : ['basic', 'filter', 'adjust', 'speed', ...(media?.hasAudio ? (['audio'] as Tab[]) : [])];
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const set = (patch: Partial<Clip>, key: string) => updateClip(clip.id, patch, `${clip.id}:${key}`);
  const setText = (patch: Partial<TextStyle>, key: string) => updateClip(clip.id, (c) => ({ text: { ...c.text!, ...patch } }), `${clip.id}:t:${key}`);
  const maxFade = Math.max(0, clip.duration / 2);
  const ramp = clip.curve.length >= 2;
  const setSpeed = (speed: number) => commitTiming(clip.id, speed, { curve: [] });
  const setRamp = (on: boolean) => {
    if (!on) {
      commitTiming(clip.id, clip.speed || 1, { curve: [] });
      return;
    }
    const start = Math.min(8, Math.max(0.25, (clip.speed || 1) * 0.5));
    const end = Math.min(8, Math.max(0.25, (clip.speed || 1) * 2));
    const curve = [
      { at: 0, speed: start },
      { at: 1, speed: end },
    ];
    commitTiming(clip.id, curveAverage(curve), { curve });
  };
  const setCurveSpeed = (index: number, speed: number) => {
    const curve = clip.curve.map((p, i) => (i === index ? { ...p, speed } : p));
    commitTiming(clip.id, curveAverage(curve), { curve });
  };

  return (
    <>
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'text' && clip.text && (
          <>
            <Section title="Text">
              <textarea value={clip.text.content} rows={3} onChange={(e) => setText({ content: e.target.value }, 'content')} />
              <Row label="Font">
                <select value={clip.text.fontFamily} onChange={(e) => setText({ fontFamily: e.target.value }, 'font')}>
                  {FONTS.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: f }}>
                      {f}
                    </option>
                  ))}
                </select>
              </Row>
              <Slider label="Size" min={12} max={300} value={clip.text.fontSize} onChange={(v) => setText({ fontSize: v }, 'size')} />
              <Row label="Style">
                <div className="btn-group">
                  <button className={clip.text.bold ? 'on' : ''} onClick={() => setText({ bold: !clip.text!.bold }, 'bold')}><b>B</b></button>
                  <button className={clip.text.italic ? 'on' : ''} onClick={() => setText({ italic: !clip.text!.italic }, 'italic')}><i>I</i></button>
                  {(['left', 'center', 'right'] as const).map((a) => (
                    <button key={a} className={clip.text!.align === a ? 'on' : ''} onClick={() => setText({ align: a }, 'align')}>
                      {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="Color">
                <input type="color" value={clip.text.color} onChange={(e) => setText({ color: e.target.value }, 'color')} />
              </Row>
            </Section>
            <Section title="Stroke">
              <Row label="Color">
                <input type="color" value={clip.text.strokeColor} onChange={(e) => setText({ strokeColor: e.target.value }, 'scolor')} />
              </Row>
              <Slider label="Width" min={0} max={20} value={clip.text.strokeWidth} onChange={(v) => setText({ strokeWidth: v }, 'swidth')} />
            </Section>
            <Section title="Background">
              <Row label="Enabled">
                <input type="checkbox" checked={!!clip.text.background} onChange={(e) => setText({ background: e.target.checked ? '#000000' : null }, 'bgon')} />
                {clip.text.background && <input type="color" value={clip.text.background} onChange={(e) => setText({ background: e.target.value }, 'bg')} />}
              </Row>
            </Section>
          </>
        )}

        {tab === 'basic' && (
          <>
            <Section title="Transform" action={<button className="link" onClick={() => set({ x: 0, y: 0, scale: 1, rotation: 0 }, 'reset')}>Reset</button>}>
              <Slider label="Scale" min={0.1} max={4} step={0.01} value={clip.scale} format={pct} resetTo={1} onChange={(v) => set({ scale: v }, 'scale')} />
              <Slider label="X" min={-1} max={1} step={0.005} value={clip.x} format={pct} resetTo={0} onChange={(v) => set({ x: v }, 'x')} />
              <Slider label="Y" min={-1} max={1} step={0.005} value={clip.y} format={pct} resetTo={0} onChange={(v) => set({ y: v }, 'y')} />
              <Slider label="Rotate" min={-180} max={180} value={clip.rotation} format={(v) => `${Math.round(v)}°`} resetTo={0} onChange={(v) => set({ rotation: v }, 'rot')} />
              <Slider label="Opacity" min={0} max={1} step={0.01} value={clip.opacity} format={pct} resetTo={1} onChange={(v) => set({ opacity: v }, 'opacity')} />
            </Section>
            <Section title="Fade">
              <Slider label="Fade in" min={0} max={maxFade} step={0.05} value={Math.min(clip.fadeIn, maxFade)} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => set({ fadeIn: v }, 'fadein')} />
              <Slider label="Fade out" min={0} max={maxFade} step={0.05} value={Math.min(clip.fadeOut, maxFade)} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => set({ fadeOut: v }, 'fadeout')} />
            </Section>
          </>
        )}

        {tab === 'speed' && (
          <Section title="Speed">
            {clip.hold ? (
              <p className="hint">This clip holds one frame. Drag its edge to change how long it stays.</p>
            ) : (
              <>
                <Slider label="Speed" min={0.1} max={10} step={0.05} value={clip.speed} format={(v) => `${v.toFixed(2)}x`} resetTo={1} onChange={setSpeed} />
                <div className="btn-group wrap">
                  {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
                    <button key={s} className={!ramp && clip.speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
                      {s}x
                    </button>
                  ))}
                </div>
                <Row label="Speed ramp">
                  <input type="checkbox" checked={ramp} onChange={(e) => setRamp(e.target.checked)} />
                </Row>
                {ramp && (
                  <>
                    <Slider label="Start" min={0.25} max={8} step={0.05} value={clip.curve[0].speed} format={(v) => `${v.toFixed(2)}x`} onChange={(v) => setCurveSpeed(0, v)} />
                    <Slider label="End" min={0.25} max={8} step={0.05} value={clip.curve[clip.curve.length - 1].speed} format={(v) => `${v.toFixed(2)}x`} onChange={(v) => setCurveSpeed(clip.curve.length - 1, v)} />
                  </>
                )}
                <Row label="Reverse">
                  <input type="checkbox" checked={clip.reversed} onChange={(e) => set({ reversed: e.target.checked }, 'reverse')} />
                </Row>
                <Row label="Keep pitch">
                  <input type="checkbox" checked={clip.preservePitch} onChange={(e) => set({ preservePitch: e.target.checked }, 'pitch')} />
                </Row>
                <p className="hint">Keep pitch applies in preview. Export still shifts pitch with the speed. Reversed audio is included in the export.</p>
              </>
            )}
            {clip.kind === 'video' && (
              <button onClick={freezeAtPlayhead}>Freeze frame</button>
            )}
            <p className="hint">Duration: {clip.duration.toFixed(2)}s</p>
          </Section>
        )}

        {tab === 'audio' && (
          <Section title="Audio">
            <Slider label="Volume" min={0} max={2} step={0.01} value={clip.volume} format={pct} resetTo={1} onChange={(v) => set({ volume: v }, 'vol')} />
            <Slider label="Fade in" min={0} max={maxFade} step={0.05} value={Math.min(clip.fadeIn, maxFade)} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => set({ fadeIn: v }, 'fadein')} />
            <Slider label="Fade out" min={0} max={maxFade} step={0.05} value={Math.min(clip.fadeOut, maxFade)} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => set({ fadeOut: v }, 'fadeout')} />
          </Section>
        )}

        {tab === 'filter' && (
          <Section title="Filter">
            <Row label="Preset">
              <select value={clip.filter.lutId ?? ''} onChange={(e) => set({ filter: { ...clip.filter, lutId: e.target.value || null } }, 'lut')}>
                <option value="">None</option>
                {luts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Row>
            {clip.filter.lutId && (
              <Slider label="Intensity" min={0} max={1} step={0.01} value={clip.filter.intensity} format={pct} resetTo={1} onChange={(v) => set({ filter: { ...clip.filter, intensity: v } }, 'intensity')} />
            )}
            <button className="wide" onClick={() => applyLookToAll(clip)}>Apply filter &amp; adjustments to all clips</button>
          </Section>
        )}

        {tab === 'adjust' && (
          <Section title="Adjust" action={<button className="link" onClick={() => set({ adjust: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 } }, 'areset')}>Reset</button>}>
            {(['brightness', 'contrast', 'saturation', 'temperature'] as const).map((k) => (
              <Slider key={k} label={k[0].toUpperCase() + k.slice(1)} min={-100} max={100} value={clip.adjust[k]} resetTo={0} onChange={(v) => set({ adjust: { ...clip.adjust, [k]: v } }, k)} />
            ))}
          </Section>
        )}
      </div>
    </>
  );
}
