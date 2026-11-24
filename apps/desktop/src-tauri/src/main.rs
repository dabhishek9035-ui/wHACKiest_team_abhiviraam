// owner: M2
// purpose: frameless pet window plus avatar files in the Tauri application data directory.
// The window flags live in tauri.conf.json. These commands only read and write pengu-avatar.* .
// They do not touch Gmail, MCP, SQLite, or the agent.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const AVATAR_FILES: [&str; 3] = ["pengu-avatar.png", "pengu-avatar.jpg", "pengu-avatar.webp"];
const MAX_AVATAR_BYTES: usize = 2_000_000;

#[derive(serde::Serialize)]
struct StoredAvatar {
    mime: String,
    bytes: Vec<u8>,
}

fn avatar_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| err.to_string())
}

fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8
        && bytes[0] == 0x89
        && bytes[1] == 0x50
        && bytes[2] == 0x4e
        && bytes[3] == 0x47
        && bytes[4] == 0x0d
        && bytes[5] == 0x0a
        && bytes[6] == 0x1a
        && bytes[7] == 0x0a
    {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some("image/jpeg");
    }
    if bytes.len() >= 12
        && bytes[0] == 0x52
        && bytes[1] == 0x49
        && bytes[2] == 0x46
        && bytes[3] == 0x46
        && bytes[8] == 0x57
        && bytes[9] == 0x45
        && bytes[10] == 0x42
        && bytes[11] == 0x50
    {
        return Some("image/webp");
    }
    None
}

fn file_name_for_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("pengu-avatar.png"),
        "image/jpeg" => Some("pengu-avatar.jpg"),
        "image/webp" => Some("pengu-avatar.webp"),
        _ => None,
    }
}

fn remove_avatars(dir: &Path) -> Result<(), String> {
    for name in AVATAR_FILES {
        let path = dir.join(name);
        if path.exists() {
            fs::remove_file(path).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn save_avatar_files(dir: &Path, bytes: &[u8], mime: &str) -> Result<(), String> {
    let Some(file_name) = file_name_for_mime(mime) else {
        return Err("Choose a PNG, JPG, or WebP image.".into());
    };
    if bytes.is_empty() {
        return Err("That file is empty.".into());
    }
    if bytes.len() > MAX_AVATAR_BYTES {
        return Err("Choose an image smaller than 2 MB.".into());
    }
    let Some(detected) = sniff_mime(bytes) else {
        return Err("That file is not a PNG, JPG, or WebP image.".into());
    };
    if detected != mime {
        return Err("The file contents do not match the image type.".into());
    }
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    remove_avatars(dir)?;
    fs::write(dir.join(file_name), bytes).map_err(|err| err.to_string())?;
    Ok(())
}

fn load_avatar_files(dir: &Path) -> Result<Option<StoredAvatar>, String> {
    for name in AVATAR_FILES {
        let path = dir.join(name);
        if !path.is_file() {
            continue;
        }
        let bytes = fs::read(&path).map_err(|err| err.to_string())?;
        let Some(detected) = sniff_mime(&bytes) else {
            continue;
        };
        let Some(expected_name) = file_name_for_mime(detected) else {
            continue;
        };
        if expected_name != name {
            continue;
        }
        return Ok(Some(StoredAvatar {
            mime: detected.to_string(),
            bytes,
        }));
    }
    Ok(None)
}

fn reset_avatar_files(dir: &Path) -> Result<(), String> {
    if dir.exists() {
        remove_avatars(dir)?;
    }
    Ok(())
}

#[tauri::command]
fn load_avatar(app: AppHandle) -> Result<Option<StoredAvatar>, String> {
    load_avatar_files(&avatar_dir(&app)?)
}

#[tauri::command]
fn save_avatar(app: AppHandle, bytes: Vec<u8>, mime: String) -> Result<(), String> {
    save_avatar_files(&avatar_dir(&app)?, &bytes, &mime)
}

#[tauri::command]
fn reset_avatar(app: AppHandle) -> Result<(), String> {
    reset_avatar_files(&avatar_dir(&app)?)
}

#[tauri::command]
fn get_ws_token() -> Result<String, String> {
    std::env::var("PENGU_WS_TOKEN").map_err(|_| "The local agent token is not configured.".to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("pet") {
                window.set_always_on_top(true)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_avatar, save_avatar, reset_avatar, get_ws_token])
        .run(tauri::generate_context!())
        .expect("error while running Pengu");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pengu-avatar-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn png_survives_a_new_read_and_reset_clears_it() {
        let dir = temp_dir("png");
        let png = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        ];
        save_avatar_files(&dir, &png, "image/png").unwrap();
        let loaded = load_avatar_files(&dir).unwrap().expect("saved png");
        assert_eq!(loaded.mime, "image/png");
        assert_eq!(loaded.bytes, png);
        reset_avatar_files(&dir).unwrap();
        assert!(load_avatar_files(&dir).unwrap().is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn jpg_replaces_an_older_png() {
        let dir = temp_dir("replace");
        let png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        let jpg = [0xff, 0xd8, 0xff, 0xd9];
        save_avatar_files(&dir, &png, "image/png").unwrap();
        save_avatar_files(&dir, &jpg, "image/jpeg").unwrap();
        assert!(!dir.join("pengu-avatar.png").exists());
        let loaded = load_avatar_files(&dir).unwrap().expect("saved jpg");
        assert_eq!(loaded.mime, "image/jpeg");
        assert_eq!(loaded.bytes, jpg);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn webp_round_trip_and_rejected_types() {
        let dir = temp_dir("webp");
        let webp = *b"RIFF\x00\x00\x00\x00WEBP";
        save_avatar_files(&dir, &webp, "image/webp").unwrap();
        let loaded = load_avatar_files(&dir).unwrap().expect("saved webp");
        assert_eq!(loaded.mime, "image/webp");
        assert!(save_avatar_files(&dir, b"<html>", "image/png").is_err());
        assert!(save_avatar_files(&dir, &[0xff, 0xd8, 0xff], "image/png").is_err());
        assert!(save_avatar_files(&dir, &webp, "image/gif").is_err());
        let still = load_avatar_files(&dir).unwrap().expect("webp kept");
        assert_eq!(still.bytes, webp);
        let _ = fs::remove_dir_all(&dir);
    }
}
