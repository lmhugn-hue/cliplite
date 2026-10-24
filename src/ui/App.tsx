import { useEffect, useState } from 'react';
import { deleteSelected, duplicateSelected, splitAtPlayhead } from '../actions';
import { db } from '../db';
import { BUILTIN_LUTS, parseCube } from '../lut';
import { importFiles, restoreMedia } from '../media';
import { newProject, projectDuration } from '../model';
import { playback } from '../render/preview';
import { clock, store, useStore } from '../store';
import { ExportDialog } from './ExportDialog';
import { Inspector } from './Inspector';
import { MediaPanel } from './MediaPanel';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { Icon } from './controls';

export function App() {
  const [loaded, setLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const toast = useStore((s) => s.toast);
  const name = useStore((s) => s.project.name);
  const project = useStore((s) => s.project);

  useEffect(() => {
    void (async () => {
      try {
        await restoreMedia();
        const saved = await db.loadProject();
        if (saved?.version === 1) store.set({ project: saved });
        const luts = (await db.loadLuts()) ?? [];
        const custom = luts.flatMap((l) => {
          try {
            return [parseCube(l.text, l.id, l.name)];
          } catch {
            return [];
          }
        });
        store.set({ luts: [...BUILTIN_LUTS, ...custom] });
      } catch (e) {
        store.toast(`Could not restore the last session: ${(e as Error).message}`);
      }
      store.resetHistory();
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => void db.saveProject(project), 400);
    return () => clearTimeout(timer);
  }, [project, loaded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const fps = 30;
      if (e.code === 'Space') {
        e.preventDefault();
        playback.toggle();
      } else if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (!ctrl && e.key.toLowerCase() === 's') {
        splitAtPlayhead();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / fps;
        playback.seek(clock.time + (e.key === 'ArrowLeft' ? -step : step));
      } else if (e.key === 'Home') playback.seek(0);
      else if (e.key === 'End') playback.seek(projectDuration(store.get().project));
      else if (e.key === 'Escape') store.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    (window as unknown as { cliplite: object }).cliplite = { store, clock, playback, importFiles };
  }, []);

  const onDrop = (e: React.DragEvent) => {
    setDragging(false);
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    void importFiles([...e.dataTransfer.files]);
  };

  const resetProject = async () => {
    if (!confirm('Start a new project? The current timeline and imported media will be cleared.')) return;
    playback.pause();
    await db.clearMedia();
    for (const m of Object.values(store.get().media)) URL.revokeObjectURL(m.url);
    store.set({ project: newProject(), media: {}, selectedId: null });
    store.resetHistory();
    playback.seek(0);
  };

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <header className="header">
        <div className="brand">
          <span className="logo">✂</span> Clip<span className="lite">Lite</span>
        </div>
        <input className="project-name" value={name} onChange={(e) => store.commit((p) => ({ ...p, name: e.target.value }), 'name')} />
        <span className="grow" />
        <button onClick={() => store.undo()} title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
        <button onClick={() => store.redo()} title="Redo (Ctrl+Shift+Z)"><Icon name="redo" /></button>
        <button onClick={resetProject}>New project</button>
        <button className="primary" onClick={() => setExporting(true)} disabled={!project.clips.length}>
          Export
        </button>
      </header>
      <main className="workspace">
        <MediaPanel />
        <Preview />
        <Inspector />
      </main>
      <Timeline />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {toast && <div className="toast">{toast}</div>}
      {dragging && <div className="drop-overlay">Drop files to import</div>}
      {!loaded && <div className="loading">Loading…</div>}
    </div>
  );
}
