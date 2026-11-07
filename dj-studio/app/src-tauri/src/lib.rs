// Pista — casca nativa do app (Tauri). A interface e o áudio rodam no WebView2 (Chromium) do Windows.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Diálogo "Salvar como" e gravação de arquivos (sets gravados, WAV do Estúdio)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Pista");
}
