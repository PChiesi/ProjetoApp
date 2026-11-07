import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { AudioEngine } from './audio/engine';

/** Re-renderiza quando o motor avisa que algo mudou. */
export function useEngine(engine: AudioEngine) {
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  return engine;
}

/** Executa `fn` a cada quadro de animação (para medidores e ondas, sem re-render do React). */
export function useFrame(fn: (dt: number) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let id = 0;
    let last = performance.now();
    const loop = (now: number) => {
      ref.current((now - last) / 1000);
      last = now;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento: tudo bem */
  }
}

export function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}
