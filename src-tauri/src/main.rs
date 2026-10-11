// Manokshmi ClothBill - Tauri desktop shell.
//
// Same architecture as Manokshmi RestroBill: the HTML/JS app runs in a native
// Windows shell with a real SQLite database (tauri-plugin-sql owns the
// connection + migration history). Every schema change from now on is a NEW
// file in src-tauri/migrations/, never an edit to an old one.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg(windows)]
mod rawprint;

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "init_schema",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }]
    // Next schema change: append Migration { version: 2, ... }. Never edit version 1.
}

/// Windows MachineGuid -- stable per Windows install; used as the licence device id.
#[tauri::command]
fn get_device_fingerprint() -> Result<String, String> {
    machine_uid::get().map_err(|e| format!("could not read machine id: {e}"))
}

/// Opens a link (WhatsApp / mailto) in the user's default handler. The WebView
/// blocks window.open(), so the app calls this instead. Only http(s) and mailto
/// are allowed so a crafted string can never launch a program.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let lower = url.to_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) {
        return Err("blocked: only http, https and mailto links can be opened".into());
    }
    if url.len() > 8000 || url.contains('\0') || url.contains('\n') || url.contains('\r') {
        return Err("blocked: invalid link".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("could not open link: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("open_external is only implemented for Windows".into())
    }
}

#[derive(serde::Serialize)]
struct PrinterList {
    printers: Vec<String>,
    default: String,
}

/// Printers installed in Windows (for the direct label-printing choice).
#[tauri::command]
fn list_printers() -> Result<PrinterList, String> {
    #[cfg(windows)]
    {
        let (printers, default) = rawprint::list_printers()?;
        Ok(PrinterList { printers, default })
    }
    #[cfg(not(windows))]
    {
        Err("printer list is only implemented for Windows".into())
    }
}

/// Sends label commands (TSPL / ZPL) straight to a printer, bypassing the Windows driver layout.
/// Runs on a worker thread so a printer that is out of paper can never freeze the app window.
#[tauri::command]
async fn print_raw(printer: String, data: Vec<u8>, label: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            rawprint::print_raw_named(&printer, &data, label.as_deref().unwrap_or("labels"))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (printer, data, label);
        Err("direct printing is only implemented for Windows".into())
    }
}

/// Removes this app's label jobs from the Windows print queue (old prints left behind when a roll ran out).
/// only_stuck = true removes only jobs that are in error / paper-out / offline / paused state.
/// Returns how many jobs were removed. Never touches other programs' print jobs.
#[tauri::command]
async fn cancel_print_jobs(printer: String, only_stuck: bool) -> Result<u32, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || rawprint::cancel_jobs(&printer, only_stuck))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (printer, only_stuck);
        Err("direct printing is only implemented for Windows".into())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:clothbill.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![get_device_fingerprint, open_external, list_printers, print_raw, cancel_print_jobs])
        .run(tauri::generate_context!())
        .expect("error while running Manokshmi ClothBill");
}
