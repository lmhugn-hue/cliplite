import { useSyncExternalStore } from 'react';
import type { LutPreset, MediaRecord, Project } from './types';
import { newProject } from './model';
import { BUILTIN_LUTS } from './lut';

export interface MediaEntry {
  record: MediaRecord;
  blob: Blob;
  url: string;
}

export interface AppState {
  project: Project;
  selectedId: string | null;
  media: Record<string, MediaEntry>;
  luts: LutPreset[];
  toast: string | null;
}

type Listener = () => void;

class Store {
  state: AppState = { project: newProject(), selectedId: null, media: {}, luts: BUILTIN_LUTS, toast: null };
  private past: Project[] = [];
  private future: Project[] = [];
  private listeners = new Set<Listener>();
  private lastKey: string | null = null;
  private lastKeyAt = 0;
  private gestureBase: Project | null = null;
  private toastTimer = 0;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  get = () => this.state;

  set(partial: Partial<AppState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  }

  /** Applies an undoable change. Changes sharing a coalesce key within 600 ms merge into one undo step. */
  commit(fn: (p: Project) => Project, coalesceKey?: string) {
    const before = this.state.project;
    const after = fn(before);
    if (after === before) return;
    const now = performance.now();
    const merge = coalesceKey && coalesceKey === this.lastKey && now - this.lastKeyAt < 600;
    if (!merge && !this.gestureBase) {
      this.past.push(before);
      if (this.past.length > 200) this.past.shift();
    }
    this.future = [];
    this.lastKey = coalesceKey ?? null;
    this.lastKeyAt = now;
    this.set({ project: after });
  }

  beginGesture() {
    this.gestureBase = this.state.project;
  }

  /** Updates the project during a drag without recording history. */
  live(fn: (p: Project) => Project) {
    this.set({ project: fn(this.state.project) });
  }

  endGesture(revert = false) {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (!base) return;
    if (revert) this.set({ project: base });
    else if (base !== this.state.project) {
      this.past.push(base);
      this.future = [];
    }
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state.project);
    this.lastKey = null;
    this.set({ project: prev });
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.project);
    this.lastKey = null;
    this.set({ project: next });
  }

  resetHistory() {
    this.past = [];
    this.future = [];
  }

  canUndo = () => this.past.length > 0;
  canRedo = () => this.future.length > 0;

  select(id: string | null) {
    if (id !== this.state.selectedId) this.set({ selectedId: id });
  }

  toast(message: string) {
    clearTimeout(this.toastTimer);
    this.set({ toast: message });
    this.toastTimer = window.setTimeout(() => this.set({ toast: null }), 3000);
  }
}

export const store = new Store();

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.state));
}

/** Playhead time lives outside React state so playback doesn't re-render the whole tree. */
class Clock {
  time = 0;
  playing = false;
  private listeners = new Set<Listener>();
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  set(time: number, playing = this.playing) {
    if (time === this.time && playing === this.playing) return;
    this.time = time;
    this.playing = playing;
    this.listeners.forEach((l) => l());
  }
}

export const clock = new Clock();

export function useClock<T>(selector: (c: Clock) => T): T {
  return useSyncExternalStore(clock.subscribe, () => selector(clock));
}
