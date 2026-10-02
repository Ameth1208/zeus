// Island window control.
//
// The webview panel is a fixed transparent overlay pinned to the top-centre of
// the monitor. Only the island inside it changes size. Four jobs live here:
//
//   1. pin the panel to the top edge, and keep it there
//   2. hit-test the cursor against the island rect so the panel only eats
//      clicks over the island — everything else falls through to the desktop
//   3. keep a tray icon so the app is always findable and always quittable
//   4. position + size during startup, which Windows otherwise ignores

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    LogicalSize, Manager, PhysicalPosition, WebviewWindow,
};

const SERVICE: &str = "ai.zeus.agent.desktop";
const ACCOUNT: &str = "gateway";

/// Panel size. Matches `PANEL_W` / `PANEL_H` in src/island/layout.ts.
const PANEL_W: f64 = 720.0;
const PANEL_H: f64 = 360.0;

/// Extra pixels around the island that still count as "over the island", so a
/// click just past the edge does not fall through to the desktop.
const HIT_MARGIN: f64 = 16.0;

/// How often the cursor is re-tested. The webview cannot do this itself: while
/// the panel is click-through it receives no pointer events at all, so there
/// would be nothing to trigger the test. This is the same reason the reference
/// app toggles `ignoresMouseEvents` at 60 Hz on macOS.
const HIT_POLL: Duration = Duration::from_millis(40);

#[derive(Debug, Serialize, Deserialize)]
struct Credentials {
    gateway: String,
    token: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
struct IslandRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[tauri::command]
fn load_credentials() -> Option<Credentials> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).ok()?;
    let raw = entry.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

#[tauri::command]
fn save_credentials(credentials: Credentials) -> Result<(), String> {
    let raw = serde_json::to_string(&credentials).map_err(|e| e.to_string())?;
    keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| e.to_string())?
        .set_password(&raw)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_credentials() -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    let _ = entry.delete_credential();
    Ok(())
}

/// Last pushed island rect, plus the current click-through state so the
/// expensive `set_ignore_cursor_events` call only happens on a real change.
#[derive(Default)]
struct IslandState {
    rect: Mutex<IslandRect>,
    over: AtomicBool,
}

impl IslandState {
    fn current(&self) -> IslandRect {
        *self.rect.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn push(&self, r: IslandRect) {
        if let Ok(mut g) = self.rect.lock() {
            *g = r;
        }
    }

    fn take_transition(&self, over: bool) -> bool {
        self.over.swap(over, Ordering::Relaxed) != over
    }
}

#[tauri::command]
fn set_island_rect(state: tauri::State<'_, IslandState>, rect: IslandRect) {
    state.push(rect);
}

/// True when the cursor sits over the island, plus its margin.
fn cursor_over_island(window: &WebviewWindow, island: &IslandRect) -> bool {
    if island.h <= 0.0 || island.w <= 0.0 {
        return false;
    }
    let (Ok(cursor), Ok(Some(monitor))) = (window.cursor_position(), window.current_monitor())
    else {
        // No cursor or no monitor: stay interactive rather than trapping the
        // user behind an invisible click-through panel.
        return true;
    };
    let scale = monitor.scale_factor();
    let cx = cursor.x / scale;
    let cy = cursor.y / scale;
    // The island is centred horizontally inside the panel.
    let left = (PANEL_W - island.w) / 2.0;
    cx >= left - HIT_MARGIN
        && cx <= left + island.w + HIT_MARGIN
        && cy >= island.y - HIT_MARGIN
        && cy <= island.y + island.h + HIT_MARGIN
}

/// Pins the panel to the top-centre of its monitor.
///
/// Done here as well as in `setup`, because a position change issued during
/// startup is frequently ignored on Windows — which is how the panel ended up
/// stranded mid-screen instead of flush against the top edge.
fn place_top_centre(window: &WebviewWindow) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_size(LogicalSize::new(PANEL_W, PANEL_H));
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size();
        let pos = monitor.position();
        let logical_w = size.width as f64 / scale;
        let x = ((logical_w - PANEL_W) / 2.0).max(0.0);
        let _ = window.set_position(PhysicalPosition::new(pos.x + (x * scale) as i32, pos.y));
        log_line(&format!(
            "place monitor={}x{} scale={} -> panel at ({},{}) size={}x{}",
            size.width,
            size.height,
            scale,
            pos.x + (x * scale) as i32,
            pos.y,
            (PANEL_W * scale) as i32,
            (PANEL_H * scale) as i32,
        ));
    }
}

/// Background hit-test loop. Runs for the life of the app.
fn spawn_hit_test_loop(app: tauri::AppHandle, state: Arc<IslandState>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(HIT_POLL);
        let Some(window) = app.get_webview_window("main") else {
            continue;
        };
        let island = state.current();
        let over = cursor_over_island(&window, &island);
        if state.take_transition(over) {
            let _ = window.set_ignore_cursor_events(!over);
            log_line(&format!("hit-test {} -> click-through {}", over, !over));
        }
    });
}

#[tauri::command]
fn hide_island(window: WebviewWindow) {
    let _ = window.hide();
    log_line("hide_island");
}

#[tauri::command]
fn show_island(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    log_line("show_island");
}

/// Appends a diagnostic line so the webview's state can be inspected from
/// outside. The release build does not forward console output on Windows, so
/// this is the only way to see what the island actually did.
#[tauri::command]
fn log_diag(msg: String) {
    log_line(&msg);
}

/// Reports the real window geometry, so a mispositioned or unsized panel is
/// visible in the log instead of only on screen.
#[tauri::command]
fn window_geometry(window: WebviewWindow) -> String {
    let pos = window
        .outer_position()
        .map(|p| format!("{},{}", p.x, p.y))
        .unwrap_or_else(|e| format!("err:{}", e));
    let size = window
        .outer_size()
        .map(|s| format!("{}x{}", s.width, s.height))
        .unwrap_or_else(|e| format!("err:{}", e));
    let vis = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    let scale = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    format!(
        "pos=({}) size=({}) visible={} focused={} scale={}",
        pos, size, vis, focused, scale
    )
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    log_line("quit");
    app.exit(0);
}

fn log_line(msg: &str) {
    let path = std::env::temp_dir().join("zeus-diag.log");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let _ = writeln!(f, "[{}] {}", now, msg);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let island_state = Arc::new(IslandState::default());

    tauri::Builder::default()
        .manage(island_state.clone())
        .invoke_handler(tauri::generate_handler![
            load_credentials,
            save_credentials,
            clear_credentials,
            set_island_rect,
            hide_island,
            show_island,
            log_diag,
            window_geometry,
            quit,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // Read back from managed state rather than capturing, so the
            // closure stays 'static.
            let hit_test_state = app.state::<Arc<IslandState>>().inner().clone();

            if let Some(window) = app.get_webview_window("main") {
                // Start click-through: the island has no geometry yet.
                let _ = window.set_ignore_cursor_events(true);
                place_top_centre(&window);
                log_line("setup complete");
            }

            // The hit-test loop needs its own handle; `handle` stays here for
            // the tray menu below.
            spawn_hit_test_loop(handle.clone(), hit_test_state.clone());

            // Tray icon. The island has no window decorations and no taskbar
            // entry, so without this the app is neither findable nor quittable.
            let show = MenuItem::with_id(&handle, "show", "Show island", true, None::<&str>)?;
            let hide = MenuItem::with_id(&handle, "hide", "Hide island", true, None::<&str>)?;
            let quit = MenuItem::with_id(&handle, "quit", "Quit Zeus", true, None::<&str>)?;
            let menu = Menu::with_items(&handle, &[&show, &hide, &quit])?;

            TrayIconBuilder::with_id("zeus-tray")
                .icon(Image::from_bytes(include_bytes!("../icons/icon.png"))?)
                .tooltip("Zeus")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Zeus desktop");
}
