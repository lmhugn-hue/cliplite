import { useEffect, useRef, useState } from 'react';
import { addMediaToTimeline, addText, applyFilter } from '../actions';
import { db } from '../db';
import { lutPreview, parseCube } from '../lut';
import { importFiles, removeMedia } from '../media';
import { formatTime, uid } from '../model';
import { FULL_CAR_PRESETS } from '../presets/fullcar';
import { store, useStore } from '../store';
import type { LutPreset, TextStyle } from '../types';
import { Icon } from './controls';

type Tab = 'media' | 'text' | 'filters';

export function MediaPanel() {
  const [tab, setTab] = useState<Tab>('media');
  return (
    <aside className="panel media-panel">
      <div className="tabs">
        {(['media', 'text', 'filters'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t === 'media' ? 'Media' : t === 'text' ? 'Text' : 'Filters'}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'media' && <MediaTab />}
        {tab === 'text' && <TextTab />}
        {tab === 'filters' && <FiltersTab />}
      </div>
    </aside>
  );
}

function MediaTab() {
  const media = useStore((s) => s.media);
  const clips = useStore((s) => s.project.clips);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const items = Object.values(media)
    .map((m) => m.record)
    .sort((a, b) => (a.importedAt ?? 0) - (b.importedAt ?? 0));

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    await importFiles([...files]);
    setBusy(false);
  };

  return (
    <>
      <button className="import-btn" onClick={() => input.current?.click()} disabled={busy}>
        <Icon name="plus" /> {busy ? 'Importing…' : 'Import media'}
      </button>
      <input ref={input} type="file" multiple hidden accept="video/*,image/*,audio/*" onChange={(e) => (void onFiles(e.target.files), (e.target.value = ''))} />
      {!items.length && <p className="hint">Import videos, photos or music, or drop files anywhere in the window.</p>}
      <div className="media-grid">
        {items.map((m) => (
          <div
            key={m.id}
            className="media-tile"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-media-id', m.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onDoubleClick={() => addMediaToTimeline(m)}
            title={`${m.name}\nDouble-click or press + to add; drag onto the timeline to place.`}
          >
            <div className="media-thumb" style={m.thumb ? { backgroundImage: `url(${m.thumb})` } : undefined}>
              {m.kind === 'audio' && <div className="audio-thumb">♪</div>}
              {m.kind !== 'image' && <span className="media-dur">{formatTime(m.duration, false)}</span>}
              {clips.some((c) => c.mediaId === m.id) && <span className="media-used">Added</span>}
              <button className="media-add" onClick={() => addMediaToTimeline(m)} title="Add to timeline">
                <Icon name="plus" />
              </button>
              <button
                className="media-remove"
                title="Remove from project"
                onClick={() => {
                  store.commit((p) => ({ ...p, clips: p.clips.filter((c) => c.mediaId !== m.id) }));
                  removeMedia(m.id);
                }}
              >
                ×
              </button>
            </div>
            <div className="media-name">{m.name}</div>
          </div>
        ))}
      </div>
    </>
  );
}

const TEXT_PRESETS: { name: string; style: Partial<TextStyle> }[] = [
  { name: 'Default', style: {} },
  { name: 'Outline', style: { strokeWidth: 6, strokeColor: '#000000' } },
  { name: 'Caption', style: { fontSize: 56, color: '#ffe14d', strokeWidth: 4, strokeColor: '#000000', content: 'Your caption here' } },
  { name: 'Label', style: { fontSize: 48, color: '#111111', background: '#ffffff', bold: true, content: 'LABEL' } },
  { name: 'Title', style: { fontSize: 120, fontFamily: 'Impact', bold: false, content: 'TITLE', strokeWidth: 3, strokeColor: '#000000' } },
  { name: 'Serif', style: { fontSize: 80, fontFamily: 'Georgia', bold: false, italic: true, content: 'Chapter one' } },
];

function TextTile({ name, style, onClick }: { name: string; style: Partial<TextStyle>; onClick: () => void }) {
  return (
    <button className="text-tile" onClick={onClick}>
      <span
        style={{
          fontFamily: style.fontFamily ?? 'Segoe UI',
          fontWeight: style.bold === false ? 400 : 700,
          fontStyle: style.italic ? 'italic' : 'normal',
          color: style.color ?? '#fff',
          background: style.background ?? 'transparent',
          padding: style.background ? '2px 6px' : 0,
          borderRadius: 4,
          WebkitTextStroke: style.strokeWidth ? `1px ${style.strokeColor}` : undefined,
        }}
      >
        {name}
      </span>
    </button>
  );
}

function TextTab() {
  return (
    <>
      <p className="hint">Adds a text layer at the playhead.</p>
      <div className="text-grid">
        {TEXT_PRESETS.map((p) => (
          <TextTile key={p.name} name={p.name} style={p.style} onClick={() => addText(p.style)} />
        ))}
      </div>
      <p className="hint preset-label">Full Car</p>
      <div className="text-grid">
        {FULL_CAR_PRESETS.map((p, i) => (
          <TextTile key={`${p.name}-${i}`} name={p.name} style={p.style} onClick={() => addText(p.style, { x: p.x ?? 0, y: p.y ?? 0 })} />
        ))}
      </div>
    </>
  );
}

function FilterTile({ lut, active, src, onClick }: { lut: LutPreset | null; active: boolean; src?: string; onClick: () => void }) {
  const [img, setImg] = useState<string>('');
  useEffect(() => {
    let live = true;
    void lutPreview(lut, src).then((u) => live && setImg(u));
    return () => {
      live = false;
    };
  }, [lut, src]);
  return (
    <button className={active ? 'filter-tile active' : 'filter-tile'} onClick={onClick}>
      <div className="filter-thumb" style={{ backgroundImage: img ? `url(${img})` : undefined }} />
      <span>{lut ? lut.name : 'None'}</span>
    </button>
  );
}

function FiltersTab() {
  const luts = useStore((s) => s.luts);
  const selected = useStore((s) => s.project.clips.find((c) => c.id === s.selectedId));
  const media = useStore((s) => s.media);
  const input = useRef<HTMLInputElement>(null);
  const visual = selected && (selected.kind === 'video' || selected.kind === 'image') ? selected : undefined;
  const thumb = visual?.mediaId ? media[visual.mediaId]?.record.thumb : Object.values(media).find((m) => m.record.thumb)?.record.thumb;

  const importLut = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lut = parseCube(text, uid(), file.name.replace(/\.cube$/i, ''));
      store.set({ luts: [...store.get().luts, lut] });
      const saved = (await db.loadLuts()) ?? [];
      await db.saveLuts([...saved, { id: lut.id, name: lut.name, text }]);
      store.toast(`Added filter "${lut.name}".`);
    } catch (e) {
      store.toast(`Could not load LUT: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <p className="hint">{visual ? 'Click a filter to apply it to the selected clip.' : 'Select a video or image clip, then pick a filter.'}</p>
      <div className="filter-grid">
        <FilterTile lut={null} src={thumb} active={!!visual && !visual.filter.lutId} onClick={() => applyFilter(null)} />
        {luts.map((l) => (
          <FilterTile key={l.id} lut={l} src={thumb} active={visual?.filter.lutId === l.id} onClick={() => applyFilter(l.id)} />
        ))}
      </div>
      <div className="filter-actions">
        <button onClick={() => applyFilter(visual?.filter.lutId ?? luts[0]?.id ?? null, true)}>Apply to all clips</button>
        <button onClick={() => input.current?.click()}>Import .cube LUT</button>
        <input ref={input} type="file" hidden accept=".cube" onChange={(e) => (void importLut(e.target.files), (e.target.value = ''))} />
      </div>
    </>
  );
}
