//! ZirZirCord desktop shell (Tauri). Mirrors the old Electron shell: tray, close-to-tray,
//! single instance, `zirzircord://join/<code>` deep links, unread badge and global push-to-talk.
//! Screen sharing is intentionally not handled here yet (see docs in the plan).

use std::str::FromStr;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

const MAIN: &str = "main";
const SCHEME: &str = "zirzircord";
/// Release builds serve the UI from http://localhost:PORT: WKWebView/WebView2 only expose
/// `navigator.mediaDevices` (mic/camera) in a secure context, and custom schemes
/// (`tauri://`) don't count. Must match the CORS origin and the capability's remote URL.
#[cfg(not(dev))]
const UI_PORT: u16 = 14320;

/// The currently registered push-to-talk key (so we can unregister it on change).
#[derive(Default)]
struct Ptt(Mutex<Option<Shortcut>>);

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// `zirzircord://join/<code>` → emit `deep-link` with the code.
fn handle_deep_link(app: &AppHandle, url: &str) {
    let rest = match url.strip_prefix(&format!("{SCHEME}://join/")) {
        Some(r) => r,
        None => return,
    };
    let code: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if code.is_empty() {
        return;
    }
    let _ = app.emit_to(MAIN, "deep-link", code);
    show_main(app);
}

fn only_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == MAIN {
        Ok(())
    } else {
        Err("forbidden".into())
    }
}

#[tauri::command]
fn set_badge(window: WebviewWindow, count: u32) -> Result<(), String> {
    only_main(&window)?;
    let n = if count == 0 { None } else { Some(count as i64) };
    // Supported on macOS/Linux; a no-op error on Windows is fine.
    let _ = window.set_badge_count(n);
    Ok(())
}

#[tauri::command]
fn set_ptt_key(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<Ptt>,
    code: Option<String>,
) -> Result<(), String> {
    only_main(&window)?;
    let gs = app.global_shortcut();
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(old) = slot.take() {
        let _ = gs.unregister(old);
    }
    let Some(code) = code else { return Ok(()) };
    // DOM KeyboardEvent.code names ("KeyV", "Backquote", "F8"…) match keyboard_types::Code.
    let Ok(key) = Code::from_str(&code) else { return Ok(()) };
    let shortcut = Shortcut::new(None, key);
    // May fail (e.g. key already taken); push-to-talk then just keeps working in-window.
    if gs.register(shortcut).is_ok() {
        *slot = Some(shortcut);
    }
    Ok(())
}

fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    #[cfg(dev)]
    let url = WebviewUrl::App("index.html".into()); // dev server (devUrl)
    #[cfg(not(dev))]
    let url = WebviewUrl::External(format!("http://localhost:{UI_PORT}").parse().unwrap());

    WebviewWindowBuilder::new(app, MAIN, url)
        .title("ZirZirCord")
        .inner_size(1280.0, 820.0)
        .min_inner_size(420.0, 500.0)
        .background_color(tauri::window::Color(0x11, 0x12, 0x14, 0xff))
        .build()?;
    Ok(())
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open ZirZirCord", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &sep, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("ZirZirCord")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(not(dev))]
    let builder = builder.plugin(tauri_plugin_localhost::Builder::new(UI_PORT).build());
    builder
        // Must be first: a second launch (e.g. a deep link on Windows/Linux) focuses the first.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for a in argv.iter().filter(|a| a.starts_with(&format!("{SCHEME}://"))) {
                handle_deep_link(app, a);
            }
            show_main(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    let pressed = event.state() == ShortcutState::Pressed;
                    let _ = app.emit_to(MAIN, "ptt", pressed);
                })
                .build(),
        )
        .manage(Ptt::default())
        .invoke_handler(tauri::generate_handler![set_badge, set_ptt_key])
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(any(windows, target_os = "linux"))]
            let _ = app.deep_link().register_all();

            // Cold start via a deep link (macOS delivers it here too).
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for u in urls {
                    handle_deep_link(&handle, u.as_str());
                }
            }
            let h = handle.clone();
            app.deep_link().on_open_url(move |e| {
                for u in e.urls() {
                    handle_deep_link(&h, u.as_str());
                }
            });

            create_main_window(&handle)?;
            setup_tray(&handle)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep running in the tray so calls continue (not on Linux, like the Electron shell).
            #[cfg(not(target_os = "linux"))]
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(target_os = "linux")]
            let _ = (window, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building ZirZirCord")
        .run(|app, event| {
            // macOS: clicking the dock icon re-opens the hidden window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
