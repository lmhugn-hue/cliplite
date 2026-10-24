import type { ReactNode } from 'react';

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  resetTo?: number;
}) {
  const { label, value, min, max, step = 1, format, onChange, resetTo } = props;
  return (
    <label className="slider" onDoubleClick={() => resetTo !== undefined && onChange(resetTo)} title="Double-click to reset">
      <span className="slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="slider-value">{format ? format(value) : Math.round(value)}</span>
    </label>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <div className="row-body">{children}</div>
    </div>
  );
}

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    play: 'M8 5v14l11-7z',
    pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
    split: 'M11 2h2v20h-2zM4 7l5 5-5 5zM20 7l-5 5 5 5z',
    trash: 'M6 7h12l-1 14H7zM9 4h6l1 2H8z',
    copy: 'M8 8h12v12H8zM4 4h12v2H6v10H4z',
    undo: 'M12 5a8 8 0 1 1-7.4 11h2.2A6 6 0 1 0 12 7v3L7 6l5-4z',
    redo: 'M12 5a8 8 0 1 0 7.4 11h-2.2A6 6 0 1 1 12 7v3l5-4-5-4z',
    magnet: 'M5 3h4v9a3 3 0 0 0 6 0V3h4v9a7 7 0 0 1-14 0zM5 3v3h4V3zm10 0v3h4V3z',
    plus: 'M11 5h2v14h-2zM5 11h14v2H5z',
    eye: 'M12 6c5 0 9 6 9 6s-4 6-9 6-9-6-9-6 4-6 9-6zm0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    eyeOff: 'M3 4l17 17-1.4 1.4-3.2-3.2A9 9 0 0 1 12 18c-5 0-9-6-9-6a17 17 0 0 1 3.9-4.3L1.6 5.4zm9 2c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2L8.8 6.6A9 9 0 0 1 12 6z',
    volume: 'M4 9h4l5-4v14l-5-4H4zM16 8a5 5 0 0 1 0 8V8z',
    mute: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 5m0-5l-5 5',
    zoomIn: 'M10 4a6 6 0 0 1 4.8 9.6l5 5-1.4 1.4-5-5A6 6 0 1 1 10 4zm-1 3v2H7v2h2v2h2v-2h2V9h-2V7z',
    zoomOut: 'M10 4a6 6 0 0 1 4.8 9.6l5 5-1.4 1.4-5-5A6 6 0 1 1 10 4zM7 9v2h6V9z',
  };
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke={name === 'mute' ? 'currentColor' : undefined} strokeWidth={name === 'mute' ? 2 : undefined}>
      <path d={paths[name]} />
    </svg>
  );
}
