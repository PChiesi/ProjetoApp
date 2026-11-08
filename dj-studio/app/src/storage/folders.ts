// Pastas de música: importar uma pasta inteira e "vigiar" uma pasta — toda música nova que
// aparecer nela entra sozinha na biblioteca.
// - App instalado (Tauri): escolhe a pasta pelo Windows e lê os arquivos direto do disco.
// - Navegador (Pista.html): usa o acesso a pastas do Chrome/Edge (File System Access).

import { isDesktopApp } from '../platform';
import { getOne, put, del } from './db';

export const AUDIO_EXT = /\.(mp3|wav|flac|ogg|m4a|aac)$/i;

export interface FolderFile {
  /** Identificador estável do arquivo (caminho). */
  key: string;
  name: string;
  getFile: () => Promise<File>;
}

export type WatchedFolder =
  | { kind: 'disk'; path: string; name: string }
  | { kind: 'browser'; handle: FileSystemDirectoryHandle; name: string };

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>;
};

export const canWatchFolders = () => isDesktopApp || (typeof window !== 'undefined' && 'showDirectoryPicker' in window);

const MAX_DEPTH = 4;

export async function pickFolder(): Promise<WatchedFolder | null> {
  if (isDesktopApp) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ directory: true, title: 'Escolha a pasta das suas músicas' });
    if (!path || Array.isArray(path)) return null;
    return { kind: 'disk', path, name: path.split(/[\\/]/).filter(Boolean).pop() ?? path };
  }
  try {
    const handle = await (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'read' });
    return { kind: 'browser', handle, name: handle.name || 'Pasta escolhida' };
  } catch {
    return null; // cancelou
  }
}

/** Lista as músicas da pasta (e subpastas). */
export async function listAudio(f: WatchedFolder): Promise<FolderFile[]> {
  const out: FolderFile[] = [];
  if (f.kind === 'disk') {
    const { readDir, readFile } = await import('@tauri-apps/plugin-fs');
    const sep = f.path.includes('\\') ? '\\' : '/';
    const walk = async (dir: string, depth: number) => {
      let entries: { name: string; isDirectory: boolean; isFile: boolean }[] = [];
      try {
        entries = await readDir(dir);
      } catch {
        return;
      }
      for (const e of entries) {
        const full = `${dir}${dir.endsWith(sep) ? '' : sep}${e.name}`;
        if (e.isDirectory && depth < MAX_DEPTH && !e.name.startsWith('.')) await walk(full, depth + 1);
        else if (e.isFile && AUDIO_EXT.test(e.name))
          out.push({ key: `disk:${full}`, name: e.name, getFile: async () => new File([await readFile(full)], e.name) });
      }
    };
    await walk(f.path, 0);
  } else {
    const walk = async (dir: DirHandle, prefix: string, depth: number) => {
      for await (const h of dir.values()) {
        if (h.kind === 'directory' && depth < MAX_DEPTH && !h.name.startsWith('.')) await walk(h as DirHandle, `${prefix}${h.name}/`, depth + 1);
        else if (h.kind === 'file' && AUDIO_EXT.test(h.name))
          out.push({ key: `browser:${f.name}/${prefix}${h.name}`, name: h.name, getFile: () => (h as FileSystemFileHandle).getFile() });
      }
    };
    await walk(f.handle as DirHandle, '', 0);
  }
  return out;
}

/** Chave de arquivos importados soltos (para não importar duas vezes a mesma música). */
export const fileKey = (f: File) => `file:${f.name}:${f.size}`;

// ---- pasta vigiada salva ----
const ID = '__watched_folder';

export async function saveWatched(f: WatchedFolder | null) {
  if (!f) return del('state', ID);
  if (f.kind === 'disk') return put('state', { id: ID, kind: 'disk', path: f.path, name: f.name });
  return put('state', { id: ID, kind: 'browser', handle: f.handle, name: f.name });
}

export async function loadWatched(): Promise<WatchedFolder | null> {
  const r = await getOne<{ kind: 'disk' | 'browser'; path?: string; handle?: FileSystemDirectoryHandle; name: string }>('state', ID);
  if (!r) return null;
  if (r.kind === 'disk' && r.path) return { kind: 'disk', path: r.path, name: r.name };
  if (r.kind === 'browser' && r.handle) return { kind: 'browser', handle: r.handle, name: r.name };
  return null;
}

/** No navegador, a permissão precisa ser renovada com um clique depois de reabrir. */
export async function hasPermission(f: WatchedFolder, ask = false): Promise<boolean> {
  if (f.kind === 'disk') return true;
  const h = f.handle as DirHandle;
  try {
    if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true;
    return ask && (await h.requestPermission({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}
