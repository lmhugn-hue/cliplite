import { useRef, useState } from 'react';
import { exportProject, type ExportQuality } from '../export';
import { formatTime, outputSize, projectDuration } from '../model';
import { playback } from '../render/preview';
import { store, useStore } from '../store';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const [shortSide, setShortSide] = useState(1080);
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState<ExportQuality>('high');
  const [progress, setProgress] = useState<{ value: number; stage: string } | null>(null);
  const [result, setResult] = useState<{ url: string; name: string; size: number; seconds: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const duration = projectDuration(project);
  const size = outputSize(project.aspect, shortSide);
  const fileName = `${(project.name || 'cliplite').replace(/[\\/:*?"<>|]+/g, '_')}.mp4`;

  const start = async () => {
    playback.pause();
    setError(null);
    setResult(null);
    abort.current = new AbortController();
    const began = performance.now();
    setProgress({ value: 0, stage: 'Preparing' });
    try {
      const { media, luts } = store.get();
      const blob = await exportProject({
        project,
        media,
        luts,
        shortSide,
        fps,
        quality,
        signal: abort.current.signal,
        onProgress: (value, stage) => setProgress({ value, stage }),
      });
      const url = URL.createObjectURL(blob);
      setResult({ url, name: fileName, size: blob.size, seconds: (performance.now() - began) / 1000 });
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message || String(e));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !progress && onClose()}>
      <div className="modal">
        <h2>Export video</h2>
        <div className="export-grid">
          <label>
            Resolution
            <select value={shortSide} onChange={(e) => setShortSide(Number(e.target.value))} disabled={!!progress}>
              <option value={480}>480p</option>
              <option value={720}>720p</option>
              <option value={1080}>1080p</option>
              <option value={1440}>2K</option>
            </select>
          </label>
          <label>
            Frame rate
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={!!progress}>
              {[24, 25, 30, 50, 60].map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </select>
          </label>
          <label>
            Quality
            <select value={quality} onChange={(e) => setQuality(e.target.value as ExportQuality)} disabled={!!progress}>
              <option value="low">Low (smaller file)</option>
              <option value="medium">Recommended</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <p className="hint">
          {size.width}×{size.height} · {formatTime(duration)} · MP4 (H.264 + AAC)
        </p>
        {progress && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${Math.round(progress.value * 100)}%` }} />
            <span>
              {progress.stage} {Math.round(progress.value * 100)}%
            </span>
          </div>
        )}
        {error && <p className="error">Export failed: {error}</p>}
        {result && (
          <p className="success">
            Exported in {result.seconds.toFixed(1)}s ({(result.size / 1024 / 1024).toFixed(1)} MB).{' '}
            <a href={result.url} download={result.name}>
              Download again
            </a>
          </p>
        )}
        <div className="modal-actions">
          {progress ? (
            <button onClick={() => abort.current?.abort()}>Cancel</button>
          ) : (
            <>
              <button onClick={onClose}>Close</button>
              <button className="primary" onClick={start} disabled={duration <= 0}>
                Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
