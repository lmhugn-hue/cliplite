import type { MediaRecord, Project } from './types';

const DB_NAME = 'cliplite';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('media');
      db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export interface StoredMedia {
  record: MediaRecord;
  blob: Blob;
}

export interface StoredLut {
  id: string;
  name: string;
  text: string;
}

export const db = {
  putMedia: (m: StoredMedia) => run('media', 'readwrite', (s) => s.put(m, m.record.id)),
  deleteMedia: (id: string) => run('media', 'readwrite', (s) => s.delete(id)),
  allMedia: () => run<StoredMedia[]>('media', 'readonly', (s) => s.getAll() as IDBRequest<StoredMedia[]>),
  clearMedia: () => run('media', 'readwrite', (s) => s.clear()),
  saveProject: (p: Project) => run('kv', 'readwrite', (s) => s.put(p, 'project')),
  loadProject: () => run<Project | undefined>('kv', 'readonly', (s) => s.get('project')),
  saveLuts: (luts: StoredLut[]) => run('kv', 'readwrite', (s) => s.put(luts, 'luts')),
  loadLuts: () => run<StoredLut[] | undefined>('kv', 'readonly', (s) => s.get('luts')),
};
