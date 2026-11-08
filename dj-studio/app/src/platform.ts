// Diferenças entre rodar como app instalado (Tauri) e como Pista.html no navegador.

export const isDesktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Salva um arquivo: no app instalado abre "Salvar como"; no navegador vai para Downloads.
 * Retorna onde salvou (ou null se ela cancelou).
 */
export async function saveFile(blob: Blob, name: string, kind: { label: string; ext: string }): Promise<string | null> {
  if (isDesktopApp) {
    const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
    const path = await save({ defaultPath: name, filters: [{ name: kind.label, extensions: [kind.ext] }] });
    if (!path) return null;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'Downloads';
}

/** Abre um link no navegador (no app instalado, abre o navegador padrão do Windows). */
export async function openExternal(url: string) {
  if (isDesktopApp) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      /* cai no jeito do navegador */
    }
  }
  window.open(url, '_blank', 'noopener');
}
