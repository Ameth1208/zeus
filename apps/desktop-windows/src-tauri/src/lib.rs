// Zeus desktop host.
//
// The webview is UI. This file is the process. Two halves:
//
//   1. Island window control — pin the panel, hit-test the cursor, tray icon.
//   2. Engine wiring — ZeusEngine lives here, so hiding the island or reloading
//      the page cannot touch a running agent.
//
// Nothing in the webview holds a process handle, a socket or the store. It calls
// a command, the engine decides, and data comes back.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow,
};
use zeus_engine as engine;
use zeus_engine::event::ZeusEvent;
use zeus_engine::permission::DecisionError;
use zeus_engine::registry::RuntimeEntry;
use zeus_engine::runtime::observed::HookEvent;
use zeus_engine::session::SessionView;

const SERVICE: &str = "ai.zeus.agent.desktop";
const ACCOUNT: &str = "gateway";

/// Panel size. Matches `PANEL_W` / `PANEL_H` in src/island/layout.ts.
const PANEL_W: f64 = 720.0;
const PANEL_H: f64 = 380.0;

/// Extra pixels around the island that still count as "over the island", so a
/// click just past the edge does not fall through to the desktop.
const HIT_MARGIN: f64 = 16.0;

/// How often the cursor is re-tested. The webview cannot do this itself: while
/// the panel is click-through it receives no pointer events at all, so there
/// would be nothing to trigger the test. This is the same reason the reference
/// app toggles `ignoresMouseEvents` at 60 Hz on macOS.
const HIT_POLL: Duration = Duration::from_millis(40);

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Credentials {
    gateway: String,
    token: String,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct WinPoint {
    x: i32,
    y: i32,
}

#[link(name = "user32")]
extern "system" {
    fn GetCursorPos(lpPoint: *mut WinPoint) -> i32;
    fn GetAsyncKeyState(vKey: i32) -> i16;
    fn SetForegroundWindow(hWnd: isize) -> i32;
}

fn cursor_physical() -> Option<(f64, f64)> {
    let mut pt = WinPoint::default();
    unsafe {
        if GetCursorPos(&mut pt) != 0 {
            Some((pt.x as f64, pt.y as f64))
        } else {
            None
        }
    }
}

fn is_left_button_down() -> bool {
    unsafe { (GetAsyncKeyState(0x01) as u16 & 0x8000) != 0 }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct IslandRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Default for IslandRect {
    fn default() -> Self {
        Self {
            x: (PANEL_W - 288.0) / 2.0,
            y: 0.0,
            w: 288.0,
            h: 32.0,
        }
    }
}

// ── credentials ───────────────────────────────────────────────────────────────

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

// ── engine commands ───────────────────────────────────────────────────────────

/// Everything the island renders, in one call. The UI used to poll a remote
/// gateway for this; it now reads the local store, which is why the island keeps
/// working with no network at all.
#[tauri::command]
fn engine_sessions(engine: tauri::State<'_, Arc<engine::ZeusEngine>>) -> Vec<SessionView> {
    engine.views()
}

#[tauri::command]
fn engine_runtimes(engine: tauri::State<'_, Arc<engine::ZeusEngine>>) -> Vec<RuntimeEntry> {
    engine.registry.all()
}

/// Only decidable requests reach the UI, so the island cannot show a button the
/// engine would refuse to honour.
#[tauri::command]
fn engine_pending(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
) -> Vec<engine::store::PendingRequest> {
    engine.permissions.open_requests()
}

#[tauri::command]
fn engine_events(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    session_id: String,
    limit: Option<usize>,
) -> Vec<ZeusEvent> {
    engine.store.events(&session_id, limit.unwrap_or(50))
}

#[tauri::command]
fn engine_digest(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    session_id: String,
) -> engine::SessionDigest {
    engine.maintain_digest(&session_id)
}

#[tauri::command]
fn engine_launch(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    runtime: String,
    cwd: String,
    prompt: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let handle = engine.launch(&runtime, std::path::PathBuf::from(cwd), prompt, model)?;
    Ok(handle.session_id)
}

#[tauri::command]
fn engine_send(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    engine.send(&session_id, &text)
}

/// A control the runtime does not have returns an error the UI reports as
/// "unsupported". The UI is not supposed to render such a control at all.
#[tauri::command]
fn engine_interrupt(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    session_id: String,
) -> Result<(), String> {
    engine.interrupt(&session_id)
}

#[tauri::command]
fn engine_stop(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    session_id: String,
) -> Result<(), String> {
    engine.stop(&session_id)
}

#[tauri::command]
fn engine_resume(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    session_id: String,
) -> Result<String, String> {
    let handle = engine.resume(&session_id)?;
    Ok(handle.session_id)
}

/// A decision made on this machine. The workstation id is taken from the engine
/// rather than the caller, so the webview cannot claim to be someone else.
#[tauri::command]
fn engine_decide(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    request_id: String,
    session_id: String,
    allow: bool,
) -> Result<(), String> {
    let workstation = engine.workstation_id().to_string();
    engine
        .decide(&request_id, &session_id, &workstation, allow)
        .map_err(|e| describe(e))
}

/// A decision relayed from the gateway on behalf of a phone. Identical
/// validation, including the workstation id echoed back, so a replayed or
/// misrouted reply is refused rather than approved.
#[tauri::command]
fn engine_remote_decide(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    request_id: String,
    session_id: String,
    workstation_id: String,
    allow: bool,
) -> Result<(), String> {
    engine
        .decide(&request_id, &session_id, &workstation_id, allow)
        .map_err(|e| describe(e))
}

#[tauri::command]
fn engine_context_search(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    pattern: String,
) -> serde_json::Value {
    engine::ContextManager::to_envelope(&engine.context.search(&pattern))
}

#[tauri::command]
fn engine_context_read(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    path: String,
    offset: Option<usize>,
    whole: Option<bool>,
) -> serde_json::Value {
    let result = engine
        .context
        .read(&path, offset.unwrap_or(0), whole.unwrap_or(false));
    engine::ContextManager::to_envelope(&result)
}

#[tauri::command]
fn engine_context_changed(engine: tauri::State<'_, Arc<engine::ZeusEngine>>) -> serde_json::Value {
    engine::ContextManager::to_envelope(&engine.context.git_changes())
}

/// Tracks whether the relay thread is running. The endpoint is reconfigurable;
/// the thread is not re-startable.
struct RelayState;

impl RelayState {
    fn start(engine: Arc<engine::ZeusEngine>) -> bool {
        static STARTED: AtomicBool = AtomicBool::new(false);
        if STARTED.swap(true, Ordering::SeqCst) {
            // Already live: a new endpoint is enough, the thread picks it up.
            return false;
        }
        engine::relay::Relay::spawn(engine)
    }
}

/// Gateway link state for the settings view. "offline" means the relay is not
/// reaching the VPS, never that agents stopped: they keep running either way.
#[tauri::command]
fn engine_gateway_status(engine: tauri::State<'_, Arc<engine::ZeusEngine>>) -> serde_json::Value {
    serde_json::json!({
        "configured": engine.gateway.is_configured(),
        "state": engine.gateway.state(),
        "queued": engine.gateway.queued(),
    })
}

/// Configures the outbound link. `None` disconnects; the webview persists the
/// token through `save_credentials` first, so this never touches the keyring.
#[tauri::command]
fn engine_gateway_configure(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    credentials: Option<Credentials>,
) -> Result<(), String> {
    if let Some(value) = &credentials {
        if value.gateway.trim().is_empty() {
            return Err("gateway URL is empty".into());
        }
        // Reject a URL the relay cannot dial before overwriting a working one:
        // the relay speaks http(s) to the anon endpoints, so it must parse as
        // one of those.
        if !value.gateway.starts_with("http://") && !value.gateway.starts_with("https://") {
            return Err("gateway URL must start with http:// or https://".into());
        }
    }
    let configure = credentials.is_some();
    engine
        .gateway
        .configure(credentials.map(|value| engine::gateway::Endpoint {
            url: value.gateway,
            token: value.token,
        }));
    if configure {
        if RelayState::start(engine.inner().clone()) {
            log_line("gateway relay started");
        } else {
            log_line("gateway endpoint updated");
        }
    } else {
        log_line("gateway disconnected");
    }
    Ok(())
}

#[tauri::command]
fn engine_context_serena(
    engine: tauri::State<'_, Arc<engine::ZeusEngine>>,
    runtime: String,
) -> Option<serde_json::Value> {
    engine.context.serena_config(&runtime)
}

/// Structured so the UI can tell "expired" from "wrong session" without parsing
/// prose, and so a refusal is never mistaken for a transient failure.
fn describe(err: DecisionError) -> String {
    serde_json::to_string(&err).unwrap_or_else(|_| format!("{err:?}"))
}

// ── island window control ─────────────────────────────────────────────────────

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
fn set_island_rect(state: tauri::State<'_, Arc<IslandState>>, rect: IslandRect) {
    log_line(&format!(
        "set_island_rect: w={} h={} x={} y={}",
        rect.w, rect.h, rect.x, rect.y
    ));
    state.push(rect);
}

/// True when the cursor sits over the island, plus its margin.
fn cursor_over_island(window: &WebviewWindow, island: &IslandRect) -> bool {
    let Ok(origin) = window.outer_position() else {
        return true;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let Some((cx, cy)) = cursor_physical() else {
        return true;
    };
    let x = (cx - origin.x as f64) / scale;
    let y = (cy - origin.y as f64) / scale;

    let left = (PANEL_W - island.w) / 2.0;

    // Wake strip at the top-centre (240px wide, 14px high)
    let over_wake =
        x >= (PANEL_W - 240.0) / 2.0 && x <= (PANEL_W + 240.0) / 2.0 && y >= 0.0 && y <= 14.0;

    let on_island = island.w > 0.0
        && island.h > 0.0
        && x >= left - HIT_MARGIN
        && x <= left + island.w + HIT_MARGIN
        && y >= island.y - HIT_MARGIN
        && y <= island.y + island.h + HIT_MARGIN;

    let is_down = is_left_button_down();

    on_island || over_wake || is_down
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
        }
    });
}

#[tauri::command]
fn hide_island(window: WebviewWindow) {
    // Hiding is explicitly not a stop: agents keep running and the hotkey brings
    // the island back.
    let _ = window.hide();
    log_line("hide_island");
}

#[tauri::command]
fn show_island(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    log_line("show_island");
}

#[tauri::command]
fn focus_window(window: WebviewWindow) {
    let _ = window.set_focus();
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let _ = SetForegroundWindow(hwnd.0 as isize);
        }
    }
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
    format!(
        "pos=({}) size=({}) visible={} focused={}",
        pos, size, vis, focused
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

// ── global hotkey ─────────────────────────────────────────────────────────────

/// Hotkey configuration, read once at startup. The plugin registers shortcuts
/// while the builder is constructed and exposes no runtime manager, so the
/// combination is fixed for the life of the process and is changed by editing
/// `ZEUS_HOTKEY` (or the desktop shortcut that launches Zeus).
///
/// `CmdOrCtrl` resolves to Cmd on macOS and Ctrl elsewhere, which is the same
/// default the reference app uses.
const DEFAULT_HOTKEY: &str = "CmdOrCtrl+Shift+Space";

/// The island listens for this and decides what a press means: compact mode does
/// not take focus, expanded and the launcher do.
const TOGGLE_EVENT: &str = "zeus://hotkey";

fn hotkey_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let shortcut = std::env::var("ZEUS_HOTKEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string());

    let mut builder = tauri_plugin_global_shortcut::Builder::<tauri::Wry>::new();
    match shortcut.parse::<tauri_plugin_global_shortcut::Shortcut>() {
        Ok(parsed) => {
            log_line(&format!("hotkey {shortcut} registered"));
            builder = builder.with_shortcut(parsed).expect("shortcut");
        }
        Err(err) => log_line(&format!("hotkey {shortcut} rejected: {err}")),
    }
    builder
        .with_handler(|app, _sc, event| {
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let _ = app.emit(TOGGLE_EVENT, ());
            }
        })
        .build()
}

// ── entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let island_state = Arc::new(IslandState::default());
    let builder = tauri::Builder::default()
        .plugin(hotkey_plugin())
        .manage(island_state.clone());

    let app = match builder
        .invoke_handler(tauri::generate_handler![
            load_credentials,
            save_credentials,
            clear_credentials,
            set_island_rect,
            hide_island,
            show_island,
            focus_window,
            log_diag,
            window_geometry,
            quit,
            engine_sessions,
            engine_runtimes,
            engine_pending,
            engine_events,
            engine_digest,
            engine_launch,
            engine_send,
            engine_interrupt,
            engine_stop,
            engine_resume,
            engine_decide,
            engine_remote_decide,
            engine_context_search,
            engine_context_read,
            engine_context_changed,
            engine_context_serena,
            engine_gateway_configure,
            engine_gateway_status,
        ])
        .setup(setup)
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(err) => {
            // A missing icon or a bad capability manifest is a build-time
            // mistake; report it instead of panicking inside run().
            log_line(&format!("builder failed: {err}"));
            return;
        }
    };

    // `run` consumes the app and reports failure through its return value.
    let _ = app.run(|_handle, _event| {});
}

/// Boot. The engine is created here, before the webview has said anything, which
/// is the whole point: sessions are the host's business, not the UI's.
fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("zeus"));
    let project_root = std::env::current_dir().unwrap_or_else(|_| data_dir.clone());
    let zeus = engine::ZeusEngine::new(data_dir, project_root);
    let replayed = zeus.store.load();
    zeus.spawn_supervisor();
    log_line(&format!(
        "engine booted replayed={} sessions={}",
        replayed,
        zeus.store.sessions().len()
    ));
    app.manage(zeus);

    // Gateway credentials come from two places, in this order with this rule:
    // the OS keyring is the source of truth, and `ZEUS_GATEWAY_URL` +
    // `ZEUS_AGENT_TOKEN` are only read when the keyring is empty — and the
    // values found there are moved into the keyring right away, so an env var
    // never becomes a persistent credential store.
    if let Some((url, token)) = load_credentials()
        .map(|c| (c.gateway, c.token))
        .or_else(|| {
            let url = std::env::var("ZEUS_GATEWAY_URL")
                .ok()
                .filter(|s| !s.trim().is_empty())?;
            let token = std::env::var("ZEUS_AGENT_TOKEN")
                .ok()
                .filter(|s| !s.trim().is_empty())?;
            log_line("gateway credentials migrated from environment");
            Some((url, token))
        })
    {
        let shared = Credentials {
            gateway: url.clone(),
            token: token.clone(),
        };
        if let Err(e) = save_credentials(shared) {
            log_line(&format!("keyring write failed: {e}"));
        }
        let engine_handle = app.state::<Arc<engine::ZeusEngine>>().inner().clone();
        engine_handle
            .gateway
            .configure(Some(engine::gateway::Endpoint { url, token }));
        if RelayState::start(engine_handle) {
            log_line("gateway relay started from credentials");
        }
    }

    // Loopback ingest, so observed sessions report to the desktop and work with
    // no network. Point the adapters' ZEUS_GATEWAY_URL here.
    let engine_handle = app.state::<Arc<engine::ZeusEngine>>().inner().clone();
    match engine::ingest::IngestServer::start(engine_handle, engine::ingest::DEFAULT_PORT) {
        Some(server) => log_line(&format!("observe ingest on {}", server.url())),
        None => log_line("observe ingest unavailable: port already bound"),
    }

    let handle = app.handle().clone();
    // Read back from managed state rather than capturing, so the closure stays
    // 'static.
    let hit_test_state = app.state::<Arc<IslandState>>().inner().clone();

    if let Some(window) = app.get_webview_window("main") {
        place_top_centre(&window);
        let _ = window.set_ignore_cursor_events(false);
        log_line("setup complete");
    }

    // The hit-test loop needs its own handle; `handle` stays here for the tray
    // menu and the bus bridge below.
    spawn_hit_test_loop(handle.clone(), hit_test_state.clone());
    spawn_bus_bridge(handle.clone());

    // Tray icon. The island has no window decorations and no taskbar entry, so
    // without this the app is neither findable nor quittable.
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
}

/// Mirrors engine events into the webview.
///
/// A dedicated thread rather than a spawned future: the bus is fed from driver
/// reader threads, so there is no runtime context to hand a task here.
fn spawn_bus_bridge(app: tauri::AppHandle) {
    let Some(zeus) = app.try_state::<Arc<engine::ZeusEngine>>() else {
        return;
    };
    let mut receiver = zeus.inner().bus.subscribe();
    std::thread::spawn(move || loop {
        match receiver.blocking_recv() {
            Ok(event) => {
                let _ = app.emit("zeus://event", &event);
            }
            // A slow webview lags the channel instead of stalling a driver.
            Err(engine::tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                log_line(&format!("ui lagged, {skipped} events dropped"));
            }
            Err(engine::tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    });
}

/// Kept so the hook payload type stays part of the host's public surface: the
/// adapters post exactly this shape to the loopback ingest endpoint.
pub type ObservePayload = HookEvent;

/// Capabilities by runtime id, for diagnostics and the settings view.
pub fn capabilities_by_runtime(runtimes: &[RuntimeEntry]) -> HashMap<String, Vec<String>> {
    runtimes
        .iter()
        .map(|entry| {
            (
                entry.info.id.clone(),
                entry
                    .managed
                    .as_ref()
                    .map(|c| c.list().iter().map(|s| s.to_string()).collect())
                    .unwrap_or_default(),
            )
        })
        .collect()
}
