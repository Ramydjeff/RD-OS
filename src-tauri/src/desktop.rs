//! Host integration for the rAImy OS desktop shell.
//!
//! * Lists the Windows applications a user can launch (Start Menu and Desktop
//!   shortcuts), so the desktop can offer them next to its own apps.
//! * Opens a file, folder, shortcut or program with its Windows handler.
//! * Lists drives and well-known folders for the file manager.
//! * Stores the desktop layout (icons, pins, wallpaper) as one small JSON file.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::location::Location;
use crate::settings::Loaded;

const MAX_APPS: usize = 1500;
const MAX_DEPTH: usize = 4;
const MAX_STATE_BYTES: usize = 512 * 1024;
const LAUNCHABLE: &[&str] = &["lnk", "url", "exe", "appref-ms"];
/// Shortcuts that are noise in an app launcher.
const NOISE: &[&str] = &[
    "uninstall", "désinstaller", "desinstaller", "readme", "read me", "license", "licence", "help", "aide", "release notes",
    "website", "site web", "documentation", "manual",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinApp {
    pub name: String,
    pub path: String,
    /// "startmenu" or "desktop".
    pub source: &'static str,
    /// Folder inside the Start Menu ("" at the top level).
    pub group: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownFolder {
    pub id: &'static str,
    pub label: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPlaces {
    pub user_name: Option<String>,
    pub home: Option<String>,
    pub folders: Vec<KnownFolder>,
    pub drives: Vec<String>,
}

fn env_path(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from).filter(|p| p.is_absolute())
}

fn is_noise(name: &str) -> bool {
    let lower = name.to_lowercase();
    NOISE.iter().any(|n| lower.contains(n))
}

fn scan(dir: &Path, root: &Path, source: &'static str, depth: usize, seen: &mut HashSet<String>, out: &mut Vec<WinApp>) {
    if depth > MAX_DEPTH || out.len() >= MAX_APPS {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            // Desktop folders are user data, not app groups.
            if source == "startmenu" {
                scan(&path, root, source, depth + 1, seen, out);
            }
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
        if !LAUNCHABLE.contains(&ext.as_str()) {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };
        if name.is_empty() || name.eq_ignore_ascii_case("desktop") || is_noise(&name) {
            continue;
        }
        if !seen.insert(name.to_lowercase()) {
            continue;
        }
        let group = path
            .parent()
            .and_then(|p| p.strip_prefix(root).ok())
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        out.push(WinApp { name, path: path.display().to_string(), source, group });
    }
}

/// Start Menu shortcuts (machine and user) followed by Desktop shortcuts.
pub fn list_apps() -> Vec<WinApp> {
    let mut roots: Vec<(PathBuf, &'static str)> = Vec::new();
    for var in ["APPDATA", "ProgramData"] {
        if let Some(base) = env_path(var) {
            roots.push((base.join("Microsoft").join("Windows").join("Start Menu").join("Programs"), "startmenu"));
        }
    }
    for desktop in desktop_dirs() {
        roots.push((desktop, "desktop"));
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (root, source) in roots {
        scan(&root, &root, source, 0, &mut seen, &mut out);
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

fn desktop_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for base in [env_path("OneDrive"), env_path("USERPROFILE"), env_path("PUBLIC")].into_iter().flatten() {
        let d = base.join("Desktop");
        if d.is_dir() && !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

pub fn places() -> HostPlaces {
    let home = env_path("USERPROFILE");
    let mut folders = Vec::new();
    if let Some(h) = &home {
        folders.push(KnownFolder { id: "home", label: "Dossier personnel".into(), path: h.display().to_string() });
        let candidates: [(&'static str, &str, Vec<PathBuf>); 5] = [
            ("desktop", "Bureau Windows", desktop_dirs().into_iter().take(1).collect()),
            ("documents", "Documents", vec![h.join("Documents")]),
            ("downloads", "Téléchargements", vec![h.join("Downloads")]),
            ("pictures", "Images", vec![h.join("Pictures")]),
            ("music", "Musique", vec![h.join("Music")]),
        ];
        for (id, label, paths) in candidates {
            if let Some(p) = paths.into_iter().find(|p| p.is_dir()) {
                folders.push(KnownFolder { id, label: label.into(), path: p.display().to_string() });
            }
        }
    }
    let drives = (b'A'..=b'Z')
        .map(|c| format!("{}:\\", c as char))
        .filter(|d| Path::new(d).is_dir())
        .collect();
    HostPlaces {
        user_name: std::env::var("USERNAME").ok().filter(|u| !u.is_empty()),
        home: home.map(|h| h.display().to_string()),
        folders,
        drives,
    }
}

/// Opens a location with its Windows handler (or shows it in Explorer).
pub fn open(location: &Location, reveal: bool) -> AppResult<()> {
    let host = location.normalized()?.host_path()?;
    if fs::metadata(&host).is_err() {
        return Err(AppError::NotFound(format!("{} does not exist", host.display())));
    }
    let result = if reveal {
        tauri_plugin_opener::reveal_item_in_dir(&host)
    } else {
        tauri_plugin_opener::open_path(&host, None::<&str>)
    };
    result.map_err(|e| AppError::Process(format!("could not open {}: {e}", host.display())))
}

// ---------------------------------------------------------------------------
// Desktop layout store
// ---------------------------------------------------------------------------

fn state_path(dir: &Path) -> PathBuf {
    dir.join("desktop.json")
}

pub fn load_state(dir: &Path) -> Loaded<Value> {
    match fs::read(state_path(dir)) {
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(v) if v.is_object() => Loaded { value: v, warning: None },
            _ => Loaded {
                value: Value::Object(Default::default()),
                warning: Some("The saved desktop layout was unreadable and was reset.".into()),
            },
        },
        Err(_) => Loaded { value: Value::Object(Default::default()), warning: None },
    }
}

pub fn save_state(dir: &Path, state: &Value) -> AppResult<()> {
    if !state.is_object() {
        return Err(AppError::InvalidInput("desktop state must be an object".into()));
    }
    let bytes = serde_json::to_vec(state).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    if bytes.len() > MAX_STATE_BYTES {
        return Err(AppError::InvalidInput("desktop state is too large".into()));
    }
    fs::create_dir_all(dir)?;
    let path = state_path(dir);
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &bytes)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_finds_shortcuts_and_skips_noise() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("Dev Tools")).unwrap();
        fs::write(root.join("Visual Studio Code.lnk"), b"").unwrap();
        fs::write(root.join("Dev Tools").join("Docker Desktop.lnk"), b"").unwrap();
        fs::write(root.join("Uninstall Foo.lnk"), b"").unwrap();
        fs::write(root.join("notes.txt"), b"").unwrap();
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        scan(root, root, "startmenu", 0, &mut seen, &mut out);
        let names: Vec<_> = out.iter().map(|a| a.name.as_str()).collect();
        assert!(names.contains(&"Visual Studio Code"));
        assert!(names.contains(&"Docker Desktop"));
        assert!(!names.iter().any(|n| n.contains("Uninstall")));
        assert_eq!(out.iter().find(|a| a.name == "Docker Desktop").unwrap().group, "Dev Tools");
    }

    #[test]
    fn state_round_trip_and_limits() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_state(dir.path()).value.is_object());
        let v = serde_json::json!({"wallpaper": "aurora", "pinned": ["files"]});
        save_state(dir.path(), &v).unwrap();
        assert_eq!(load_state(dir.path()).value, v);
        assert!(save_state(dir.path(), &serde_json::json!([1])).is_err());
        let big = serde_json::json!({"x": "a".repeat(MAX_STATE_BYTES)});
        assert!(save_state(dir.path(), &big).is_err());
    }
}
