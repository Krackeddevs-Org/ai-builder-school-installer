//! Library root — shared by the Tauri binary and (potentially) a headless CLI.

pub mod api;
pub mod kilo;
pub mod platform;
pub mod steps;

/// Tauri entry point builder, kept in the lib so tests can link against the modules
/// without booting a window.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Required for external links: a Tauri webview refuses to navigate away from the
        // app, so plain <a href> clicks are silently swallowed. The frontend routes them
        // through this plugin instead.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            steps::detect,
            steps::install_tool,
            steps::install_extension,
            steps::verify_key,
            steps::apply_config,
            steps::open_vscode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the AI Builder School setup wizard");
}
