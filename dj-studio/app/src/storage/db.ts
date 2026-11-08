// Biblioteca salva no próprio navegador (IndexedDB): nada vai para a internet.
// - tracks: músicas importadas e edições do Estúdio (com o áudio original)
// - state:  hot cues e ajustes de grid das músicas demo
// - sounds: vinhetas e sons importados

import type { Waveform } from '../audio/analysis';
import type { Track } from '../audio/engine';
import type { Section } from '../studio/edit';

export interface TrackRecord {
  id: string;
  title: string;
  artist: string;
  genre?: string;
  bpm: number;
  firstBeat: number;
  key: string | null;
  duration: number;
  confidence: number;
  hotCues: (number | null)[];
  autoGainDb: number;
  sections: Section[];
  waveform: Waveform;
  audio: Blob;
  addedAt: number;
  sourceKey?: string;
}

export interface StateRecord {
  id: string;
  hotCues: (number | null)[];
  bpm: number;
  firstBeat: number;
}

export interface SoundRecord {
  id: string;
  name: string;
  icon: string;
  wav: Blob;
}

let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open('pista', 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of ['tracks', 'state', 'sounds', 'stems', 'models']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null); // navegação privada / armazenamento bloqueado: segue sem salvar
      }
    });
  }
  return dbp;
}

type Store = 'tracks' | 'state' | 'sounds' | 'stems' | 'models';

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(store, mode);
          const req = fn(tx.objectStore(store));
          tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const getOne = <T>(store: Store, id: string) => run<T>(store, 'readonly', (s) => s.get(id));

export const storageAvailable = () => open().then((db) => !!db);

export const getAll = <T>(store: Store) => run<T[]>(store, 'readonly', (s) => s.getAll()).then((r) => r ?? []);
export const put = (store: Store, value: unknown) => run(store, 'readwrite', (s) => s.put(value));
export const del = (store: Store, id: string) => run(store, 'readwrite', (s) => s.delete(id));

export function trackToRecord(t: Track, audio: Blob): TrackRecord {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    genre: t.genre,
    bpm: t.bpm,
    firstBeat: t.firstBeat,
    key: t.key,
    duration: t.duration,
    confidence: t.confidence,
    hotCues: t.hotCues,
    autoGainDb: t.autoGainDb,
    sections: t.sections,
    waveform: t.waveform,
    audio,
    addedAt: Date.now(),
    sourceKey: t.sourceKey,
  };
}

export function recordToTrack(r: TrackRecord): Track {
  const { audio, addedAt: _addedAt, ...rest } = r;
  void _addedAt;
  return { ...rest, buffer: null, source: audio, demo: false };
}

/** Atualiza só os dados que mudam durante o uso (hot cues e grid). */
export async function saveTrackState(t: Track) {
  if (t.demo) {
    await put('state', { id: t.id, hotCues: t.hotCues, bpm: t.bpm, firstBeat: t.firstBeat } satisfies StateRecord);
    return;
  }
  const rec = await run<TrackRecord>('tracks', 'readonly', (s) => s.get(t.id));
  if (rec) await put('tracks', { ...rec, hotCues: t.hotCues, bpm: t.bpm, firstBeat: t.firstBeat });
}
