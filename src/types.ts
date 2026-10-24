export type TrackKind = 'video' | 'audio' | 'text';
export type ClipKind = 'video' | 'image' | 'audio' | 'text';
export type MediaKind = 'video' | 'image' | 'audio';
export type Aspect = '16:9' | '9:16' | '1:1' | '4:5' | '3:4';

export interface MediaRecord {
  id: string;
  name: string;
  kind: MediaKind;
  mime: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  importedAt: number;
  thumb?: string;
  waveform?: string;
}

export interface Adjust {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

export interface TextStyle {
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  background: string | null;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  /** Drop shadow in the same pixel space as fontSize. Omitted when the style has none. */
  shadow?: { color: string; blur: number; x: number; y: number };
}

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  mediaId?: string;
  /** Position on the timeline, in seconds. */
  start: number;
  /** Length on the timeline, in seconds (already divided by speed). */
  duration: number;
  /** Offset into the source media, in source seconds. */
  in: number;
  speed: number;
  volume: number;
  opacity: number;
  /** Offset of the layer centre from the canvas centre, as a fraction of canvas width/height. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  fadeIn: number;
  fadeOut: number;
  filter: { lutId: string | null; intensity: number };
  adjust: Adjust;
  text?: TextStyle;
}

export interface Track {
  id: string;
  kind: TrackKind;
  muted: boolean;
  hidden: boolean;
}

export interface Project {
  version: 1;
  name: string;
  aspect: Aspect;
  background: string;
  magnetic: boolean;
  tracks: Track[];
  clips: Clip[];
}

export interface LutPreset {
  id: string;
  name: string;
  size: number;
  /** RGBA8 texels, red varying fastest, then green, then blue. */
  data: Uint8Array;
  builtIn: boolean;
}
