//! Persistent preferences (`settings.json`) and workspace state (`state.json`).
//!
//! Both live in the per-user app config directory. Nothing secret is stored and
//! no terminal history is written. Files are written atomically (temp file +
//! rename); a corrupt file is moved aside and defaults are used.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::location::Location;

pub const SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CursorStyle {
    Block,
    Underline,
    Bar,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StartupBehavior {
    /// Show the home page and open a terminal in the default distribution.
    OpenTerminal,
    /// Show the home page only.
    Empty,
    /// Re-open the last project (and a terminal in it).
    RestoreProject,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalSettings {
    pub font_family: String,
    pub font_size: u32,
    pub line_height: f32,
    pub cursor_style: CursorStyle,
    pub cursor_blink: bool,
    pub scrollback: u32,
    pub copy_on_select: bool,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            font_family: "Cascadia Code, Cascadia Mono, Consolas, monospace".into(),
            font_size: 14,
            line_height: 1.2,
            cursor_style: CursorStyle::Block,
            cursor_blink: true,
            scrollback: 10_000,
            copy_on_select: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Confirmations {
    pub delete_entries: bool,
    pub close_busy_terminal: bool,
    pub close_app_with_sessions: bool,
    pub terminate_distro: bool,
}

impl Default for Confirmations {
    fn default() -> Self {
        Self {
            delete_entries: true,
            close_busy_terminal: true,
            close_app_with_sessions: true,
            terminate_distro: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MonitorSettings {
    pub enabled: bool,
    pub interval_secs: u32,
}

impl Default for MonitorSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_secs: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub theme: Theme,
    pub terminal: TerminalSettings,
    pub default_distro: Option<String>,
    pub default_project_dir: Option<Location>,
    pub startup: StartupBehavior,
    /// Overrides for the built-in shortcut table: action id -> "Ctrl+Shift+T".
    pub shortcuts: BTreeMap<String, String>,
    pub confirmations: Confirmations,
    pub monitor: MonitorSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            theme: Theme::Dark,
            terminal: TerminalSettings::default(),
            default_distro: None,
            default_project_dir: None,
            startup: StartupBehavior::OpenTerminal,
            shortcuts: BTreeMap::new(),
            confirmations: Confirmations::default(),
            monitor: MonitorSettings::default(),
        }
    }
}

const SHORTCUT_ACTIONS: &[&str] = &[
    "terminal.new",
    "terminal.close",
    "terminal.search",
    "terminal.clear",
    "view.toggleSidebar",
    "view.togglePanel",
    "view.maximizePanel",
    "palette.open",
    "settings.open",
];

const MODIFIERS: &[&str] = &["Ctrl", "Shift", "Alt", "Meta"];
const NAMED_KEYS: &[&str] = &[
    "Enter", "Escape", "Tab", "Space", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "ArrowUp",
    "ArrowDown", "ArrowLeft", "ArrowRight", "Backquote", "Comma", "Period", "Slash", "Backslash", "Semicolon", "Quote",
    "BracketLeft", "BracketRight", "Minus", "Equal",
];

pub fn is_valid_shortcut(s: &str) -> bool {
    let parts: Vec<&str> = s.split('+').collect();
    if parts.len() < 2 || parts.len() > 4 {
        return false;
    }
    let (key, mods) = parts.split_last().unwrap();
    let mods_ok = mods.iter().all(|m| MODIFIERS.contains(m)) && {
        let mut seen = std::collections::HashSet::new();
        mods.iter().all(|m| seen.insert(*m))
    };
    let key_ok = (key.len() == 1 && key.chars().all(|c| c.is_ascii_alphanumeric()))
        || NAMED_KEYS.contains(key)
        || (key.starts_with('F') && key[1..].parse::<u8>().map(|n| (1..=12).contains(&n)).unwrap_or(false));
    mods_ok && key_ok
}

fn valid_font_family(s: &str) -> bool {
    !s.trim().is_empty()
        && s.len() <= 200
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | ',' | '\'' | '"' | '.' | '_' | '-'))
}

impl Settings {
    /// Returns every problem found; an empty list means the settings are valid.
    pub fn validate(&self) -> Vec<String> {
        let mut errs = Vec::new();
        let t = &self.terminal;
        if !valid_font_family(&t.font_family) {
            errs.push("Terminal font family may only contain letters, digits, spaces, commas, quotes, '.', '_' and '-'.".into());
        }
        if !(8..=32).contains(&t.font_size) {
            errs.push("Terminal font size must be between 8 and 32.".into());
        }
        if !(1.0..=2.0).contains(&t.line_height) || t.line_height.is_nan() {
            errs.push("Terminal line height must be between 1.0 and 2.0.".into());
        }
        if !(500..=100_000).contains(&t.scrollback) {
            errs.push("Scrollback must be between 500 and 100000 lines.".into());
        }
        if !(2..=300).contains(&self.monitor.interval_secs) {
            errs.push("Monitor refresh interval must be between 2 and 300 seconds.".into());
        }
        if let Some(d) = &self.default_distro {
            if crate::wsl::validate_distro_name(d).is_err() {
                errs.push(format!("'{d}' is not a valid distribution name."));
            }
        }
        if let Some(loc) = &self.default_project_dir {
            if let Err(e) = loc.normalized() {
                errs.push(format!("Default project directory: {e}"));
            }
        }
        for (action, keys) in &self.shortcuts {
            if !SHORTCUT_ACTIONS.contains(&action.as_str()) {
                errs.push(format!("Unknown shortcut action '{action}'."));
            } else if !is_valid_shortcut(keys) {
                errs.push(format!("'{keys}' is not a valid shortcut for {action} (example: Ctrl+Shift+T)."));
            }
        }
        // Two actions on one chord would make one of them unreachable.
        let mut seen: BTreeMap<String, &String> = BTreeMap::new();
        for (action, keys) in &self.shortcuts {
            if let Some(prev) = seen.insert(keys.to_ascii_lowercase(), action) {
                errs.push(format!("{keys} is assigned to both {prev} and {action}."));
            }
        }
        errs
    }
}

// --------------------------------------------------------------------------
// Workspace state
// --------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutState {
    pub sidebar_visible: bool,
    pub sidebar_width: u32,
    pub panel_visible: bool,
    pub panel_height: u32,
    pub active_view: String,
}

impl Default for LayoutState {
    fn default() -> Self {
        Self {
            sidebar_visible: true,
            sidebar_width: 280,
            panel_visible: true,
            panel_height: 340,
            active_view: "explorer".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub location: Location,
    pub name: String,
    pub opened_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceState {
    pub layout: LayoutState,
    pub recent_projects: Vec<RecentProject>,
    pub last_project: Option<Location>,
    pub selected_distro: Option<String>,
    pub show_hidden_files: bool,
}

const MAX_RECENT: usize = 12;

impl WorkspaceState {
    /// Clamps values to sane ranges and drops invalid entries instead of failing.
    pub fn sanitized(mut self) -> Self {
        self.layout.sidebar_width = self.layout.sidebar_width.clamp(180, 640);
        self.layout.panel_height = self.layout.panel_height.clamp(120, 2000);
        if !["explorer", "environments", "processes", "settings", "terminal"].contains(&self.layout.active_view.as_str()) {
            self.layout.active_view = "explorer".into();
        }
        self.recent_projects.retain(|p| p.location.normalized().is_ok() && p.name.len() <= 200);
        self.recent_projects.truncate(MAX_RECENT);
        if let Some(l) = &self.last_project {
            if l.normalized().is_err() {
                self.last_project = None;
            }
        }
        if let Some(d) = &self.selected_distro {
            if crate::wsl::validate_distro_name(d).is_err() {
                self.selected_distro = None;
            }
        }
        self
    }
}

// --------------------------------------------------------------------------
// File storage
// --------------------------------------------------------------------------

pub struct Store {
    dir: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded<T> {
    pub value: T,
    /// Set when the stored file was unreadable and defaults were substituted.
    pub warning: Option<String>,
}

fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    // On Windows, rename over an existing file replaces it atomically enough for a prefs file.
    fs::rename(&tmp, path)?;
    Ok(())
}

fn load_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Loaded<T> {
    match fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<T>(&bytes) {
            Ok(value) => Loaded { value, warning: None },
            Err(e) => {
                let bad = path.with_extension("json.bad");
                let _ = fs::rename(path, &bad);
                Loaded {
                    value: T::default(),
                    warning: Some(format!(
                        "{} could not be read ({e}). It was kept as {} and defaults are in use.",
                        path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
                        bad.file_name().and_then(|n| n.to_str()).unwrap_or("backup"),
                    )),
                }
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Loaded {
            value: T::default(),
            warning: None,
        },
        Err(e) => Loaded {
            value: T::default(),
            warning: Some(format!("could not read {}: {e}", path.display())),
        },
    }
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn settings_path(&self) -> PathBuf {
        self.dir.join("settings.json")
    }

    fn state_path(&self) -> PathBuf {
        self.dir.join("state.json")
    }

    pub fn load_settings(&self) -> Loaded<Settings> {
        let mut loaded: Loaded<Settings> = load_json(&self.settings_path());
        let problems = loaded.value.validate();
        if !problems.is_empty() {
            loaded.warning = Some(format!(
                "Some saved settings were invalid and were reset to defaults: {}",
                problems.join(" ")
            ));
            loaded.value = Settings::default();
        }
        loaded
    }

    pub fn save_settings(&self, settings: &Settings) -> AppResult<()> {
        let problems = settings.validate();
        if !problems.is_empty() {
            return Err(AppError::InvalidInput(problems.join(" ")));
        }
        let mut s = settings.clone();
        s.version = SETTINGS_VERSION;
        write_atomic(&self.settings_path(), &serde_json::to_vec_pretty(&s).map_err(|e| AppError::Io(e.to_string()))?)
    }

    pub fn reset_settings(&self) -> AppResult<Settings> {
        let path = self.settings_path();
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        Ok(Settings::default())
    }

    pub fn load_state(&self) -> Loaded<WorkspaceState> {
        let mut l: Loaded<WorkspaceState> = load_json(&self.state_path());
        l.value = l.value.sanitized();
        l
    }

    pub fn save_state(&self, state: WorkspaceState) -> AppResult<()> {
        let s = state.sanitized();
        write_atomic(&self.state_path(), &serde_json::to_vec_pretty(&s).map_err(|e| AppError::Io(e.to_string()))?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn defaults_are_valid() {
        assert!(Settings::default().validate().is_empty());
    }

    #[test]
    fn rejects_out_of_range_values() {
        let mut s = Settings::default();
        s.terminal.font_size = 4;
        s.terminal.scrollback = 10;
        s.terminal.line_height = 5.0;
        s.monitor.interval_secs = 0;
        assert_eq!(s.validate().len(), 4);
    }

    #[test]
    fn rejects_css_injection_in_font_family() {
        let mut s = Settings::default();
        s.terminal.font_family = "Consolas; background:url(http://x)".into();
        assert!(!s.validate().is_empty());
        s.terminal.font_family = "Cascadia Code, 'Fira Code', monospace".into();
        assert!(s.validate().is_empty());
    }

    #[test]
    fn validates_shortcuts() {
        assert!(is_valid_shortcut("Ctrl+Shift+T"));
        assert!(is_valid_shortcut("Ctrl+,") == false);
        assert!(is_valid_shortcut("Ctrl+Comma"));
        assert!(is_valid_shortcut("Alt+F4"));
        assert!(!is_valid_shortcut("T"));
        assert!(!is_valid_shortcut("Ctrl+Ctrl+T"));
        assert!(!is_valid_shortcut("Super+T"));
        assert!(!is_valid_shortcut("Ctrl+F13"));
    }

    #[test]
    fn rejects_unknown_actions_and_duplicates() {
        let mut s = Settings::default();
        s.shortcuts.insert("evil.action".into(), "Ctrl+Shift+X".into());
        assert!(!s.validate().is_empty());
        let mut s = Settings::default();
        s.shortcuts.insert("terminal.new".into(), "Ctrl+Shift+Y".into());
        s.shortcuts.insert("terminal.close".into(), "ctrl+shift+y".into());
        assert!(!s.validate().is_empty());
    }

    #[test]
    fn settings_persist_and_reload() {
        let dir = tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        let mut s = Settings::default();
        s.theme = Theme::Light;
        s.terminal.font_size = 17;
        s.default_distro = Some("Ubuntu-26.04".into());
        store.save_settings(&s).unwrap();
        let loaded = store.load_settings();
        assert!(loaded.warning.is_none());
        assert_eq!(loaded.value, s);
    }

    #[test]
    fn invalid_settings_are_not_saved() {
        let dir = tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        let mut s = Settings::default();
        s.terminal.font_size = 999;
        assert!(store.save_settings(&s).is_err());
        assert!(!dir.path().join("settings.json").exists());
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults_and_keeps_backup() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), "{ not json").unwrap();
        let store = Store::new(dir.path().to_path_buf());
        let loaded = store.load_settings();
        assert!(loaded.warning.is_some());
        assert_eq!(loaded.value, Settings::default());
        assert!(dir.path().join("settings.json.bad").exists());
    }

    #[test]
    fn partial_files_get_defaults_for_missing_fields() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), r#"{"theme":"light"}"#).unwrap();
        let loaded = Store::new(dir.path().to_path_buf()).load_settings();
        assert_eq!(loaded.value.theme, Theme::Light);
        assert_eq!(loaded.value.terminal.font_size, 14);
        assert!(loaded.warning.is_none());
    }

    #[test]
    fn reset_removes_the_file() {
        let dir = tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.save_settings(&Settings::default()).unwrap();
        assert!(dir.path().join("settings.json").exists());
        assert_eq!(store.reset_settings().unwrap(), Settings::default());
        assert!(!dir.path().join("settings.json").exists());
        // resetting twice is fine
        store.reset_settings().unwrap();
    }

    #[test]
    fn state_is_sanitized() {
        let mut st = WorkspaceState::default();
        st.layout.sidebar_width = 5;
        st.layout.panel_height = 999_999;
        st.layout.active_view = "<script>".into();
        st.selected_distro = Some("bad;name".into());
        for i in 0..30 {
            st.recent_projects.push(RecentProject {
                location: Location::Windows { path: format!("C:\\p{i}") },
                name: format!("p{i}"),
                opened_at: i,
            });
        }
        st.recent_projects.push(RecentProject {
            location: Location::Windows { path: "relative".into() },
            name: "bad".into(),
            opened_at: 0,
        });
        let s = st.sanitized();
        assert_eq!(s.layout.sidebar_width, 180);
        assert_eq!(s.layout.panel_height, 2000);
        assert_eq!(s.layout.active_view, "explorer");
        assert_eq!(s.selected_distro, None);
        assert_eq!(s.recent_projects.len(), MAX_RECENT);
    }

    #[test]
    fn state_round_trips() {
        let dir = tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        let mut st = WorkspaceState::default();
        st.layout.sidebar_width = 333;
        st.last_project = Some(Location::Linux { distro: "Ubuntu-26.04".into(), path: "/home/raimy/x".into() });
        store.save_state(st.clone()).unwrap();
        assert_eq!(store.load_state().value, st);
    }
}
