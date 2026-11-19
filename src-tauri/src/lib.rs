use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct NodeCoreChild(Mutex<Option<Child>>);

#[tauri::command]
fn get_llamrei_local_url() -> String {
    "http://127.0.0.1:4321".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let child = Command::new("node")
                .arg("server/index.ts")
                .spawn()
                .ok();
            app.manage(NodeCoreChild(Mutex::new(child)));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<NodeCoreChild>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_llamrei_local_url])
        .run(tauri::generate_context!())
        .expect("error while running Llamrei Tauri shell");
}
