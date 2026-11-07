// Sem janela de console no Windows (release).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pista_lib::run()
}
