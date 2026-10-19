// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Work around a WebKitGTK crash on Linux before the webview is created.
///
/// Symptom on NVIDIA + Wayland (Hyprland, Sway, GNOME/Wayland): the window dies at startup
/// with a wall of
///   `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display.`
///   `ERROR: WebKit encountered an internal error.`
///   `WebLoaderStrategy.cpp(777) ... networkProcessCrashed()`
///
/// WebKit tries to share frames with the compositor over DMABUF; the NVIDIA proprietary
/// driver rejects those buffers, the network process crashes, and the app dies before
/// showing anything. That reads as "your installer is broken" to a student.
///
/// We only widen the fix to NVIDIA, and only on Wayland, so machines with working GPU
/// acceleration keep it instead of being needlessly pushed to software rendering.
///
/// These must be set before the webview initialises. Values already set by the user are
/// respected — `set_var` is only called when the variable is absent.
#[cfg(target_os = "linux")]
fn apply_webkit_workarounds() {
    // Only touch anything if we're actually on Wayland.
    let on_wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some();
    if !on_wayland {
        return;
    }

    if !is_nvidia_gpu() {
        return;
    }

    // DMABUF + compositing are the two that actually break on the NVIDIA driver.
    for key in [
        "WEBKIT_DISABLE_DMABUF_RENDERER",
        "WEBKIT_DISABLE_COMPOSITING_MODE",
    ] {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, "1");
        }
    }
}

/// Best-effort NVIDIA detection. Any failure returns false, so an unknown GPU keeps
/// hardware acceleration rather than being degraded on a guess.
#[cfg(target_os = "linux")]
fn is_nvidia_gpu() -> bool {
    // /sys is cheap and present everywhere; check the DRM driver name first.
    if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
        for e in entries.flatten() {
            let name = e.file_name();
            if name.to_string_lossy().starts_with("card") {
                let driver = e.path().join("device/driver");
                if let Ok(target) = std::fs::read_link(&driver) {
                    if target.to_string_lossy().contains("nvidia") {
                        return true;
                    }
                }
            }
        }
    }
    // Fall back to querying the driver for the device name.
    std::process::Command::new("lspci")
        .output()
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains("nvidia")
        })
        .unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
fn apply_webkit_workarounds() {}

fn main() {
    apply_webkit_workarounds();
    aibs_setup_lib::run()
}
