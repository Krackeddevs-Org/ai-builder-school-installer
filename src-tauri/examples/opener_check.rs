//! Integration check: does the opener plugin actually reach the OS?
//!
//! Run: cargo run --example opener_check
//!
//! Uses the plugin's Rust API directly (the same code path the webview invokes), so this
//! proves the opener works on this machine without needing a synthetic UI click.

use tauri_plugin_opener::OpenerExt;

fn main() {
    // A headless Tauri app is enough for the plugin to be initialised and usable.
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .build(tauri::generate_context!())
        .expect("failed to build the Tauri app");

    let url = "https://ar-raqmi.net/";
    println!("asking the opener to open {url}");

    match app.opener().open_url(url, None::<&str>) {
        Ok(()) => {
            println!("OK — open_url returned success.");
            println!("A browser tab for {url} should have opened (or been focused).");
        }
        Err(e) => {
            println!("FAILED — open_url returned: {e}");
            std::process::exit(1);
        }
    }
}
