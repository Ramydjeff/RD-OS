//! Typed project locations.
//!
//! A project lives either inside a WSL distribution (`Linux`) or on a Windows
//! drive/share (`Windows`). Paths are parsed into normalized components; they
//! are never trusted as raw strings and `..` is rejected instead of resolved.
//! Linux paths are reached from Windows through the `\\wsl.localhost\<distro>`
//! share, so all filesystem work uses ordinary Windows file APIs.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::wsl::validate_distro_name;

const MAX_PATH_CHARS: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Location {
    Linux { distro: String, path: String },
    Windows { path: String },
}

fn reject_control_chars(s: &str) -> AppResult<()> {
    if s.chars().any(|c| c.is_control()) {
        return Err(AppError::InvalidInput("path contains control characters".into()));
    }
    if s.chars().count() > MAX_PATH_CHARS {
        return Err(AppError::InvalidInput("path is too long".into()));
    }
    Ok(())
}

/// Normalizes an absolute Linux path: collapses `//` and `.`, rejects `..`.
pub fn normalize_linux_path(input: &str) -> AppResult<String> {
    reject_control_chars(input)?;
    if !input.starts_with('/') {
        return Err(AppError::InvalidInput("a Linux path must start with '/'".into()));
    }
    let mut segs: Vec<&str> = Vec::new();
    for seg in input.split('/') {
        match seg {
            "" | "." => {}
            ".." => return Err(AppError::InvalidInput("'..' is not allowed in paths".into())),
            s if s.contains('\\') => {
                return Err(AppError::InvalidInput("backslashes are not allowed in Linux paths".into()))
            }
            s => segs.push(s),
        }
    }
    Ok(format!("/{}", segs.join("/")))
}

const WIN_ILLEGAL: &[char] = &['<', '>', ':', '"', '|', '?', '*'];

/// Normalizes an absolute Windows path (`C:\dir` or `\\server\share\dir`).
pub fn normalize_windows_path(input: &str) -> AppResult<String> {
    reject_control_chars(input)?;
    let s = input.replace('/', "\\");
    if s.starts_with("\\\\?\\") || s.starts_with("\\\\.\\") {
        return Err(AppError::InvalidInput("device and extended-length paths are not supported".into()));
    }

    let (prefix, rest): (String, &str) = if let Some(unc) = s.strip_prefix("\\\\") {
        let mut it = unc.splitn(3, '\\');
        let server = it.next().unwrap_or("");
        let share = it.next().unwrap_or("");
        if server.is_empty() || share.is_empty() {
            return Err(AppError::InvalidInput("a UNC path needs a server and a share".into()));
        }
        if server.contains(WIN_ILLEGAL) || share.contains(WIN_ILLEGAL) {
            return Err(AppError::InvalidInput("invalid characters in UNC path".into()));
        }
        (format!("\\\\{server}\\{share}"), it.next().unwrap_or(""))
    } else {
        let bytes = s.as_bytes();
        if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\' {
            (format!("{}:", (bytes[0] as char).to_ascii_uppercase()), &s[3..])
        } else if bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            (format!("{}:", (bytes[0] as char).to_ascii_uppercase()), "")
        } else {
            return Err(AppError::InvalidInput(
                "a Windows path must be absolute, e.g. C:\\Users\\you\\project".into(),
            ));
        }
    };

    let mut out = prefix;
    let mut any = false;
    for seg in rest.split('\\') {
        match seg {
            "" | "." => {}
            ".." => return Err(AppError::InvalidInput("'..' is not allowed in paths".into())),
            s if s.contains(WIN_ILLEGAL) => {
                return Err(AppError::InvalidInput(format!("'{s}' contains characters Windows does not allow")))
            }
            s => {
                out.push('\\');
                out.push_str(s);
                any = true;
            }
        }
    }
    if !any && out.len() == 2 {
        out.push('\\'); // drive root keeps its trailing separator
    }
    Ok(out)
}

impl Location {
    pub fn normalized(&self) -> AppResult<Location> {
        match self {
            Location::Linux { distro, path } => {
                validate_distro_name(distro)?;
                Ok(Location::Linux {
                    distro: distro.clone(),
                    path: normalize_linux_path(path)?,
                })
            }
            Location::Windows { path } => Ok(Location::Windows {
                path: normalize_windows_path(path)?,
            }),
        }
    }

    /// Interprets a path typed or pasted by the user. Accepts Linux absolute
    /// paths, drive paths, and `\\wsl.localhost\<distro>\...` / `\\wsl$\<distro>\...`.
    pub fn parse_user_input(input: &str, default_distro: Option<&str>) -> AppResult<Location> {
        let t = input.trim().trim_matches('"');
        if t.is_empty() {
            return Err(AppError::InvalidInput("path is empty".into()));
        }
        let lower = t.to_ascii_lowercase().replace('/', "\\");
        for prefix in ["\\\\wsl.localhost\\", "\\\\wsl$\\"] {
            if lower.starts_with(prefix) {
                let rest = &t.replace('/', "\\")[prefix.len()..];
                let mut it = rest.splitn(2, '\\');
                let distro = it.next().unwrap_or("");
                let tail = it.next().unwrap_or("");
                return Location::Linux {
                    distro: distro.to_string(),
                    path: format!("/{}", tail.replace('\\', "/")),
                }
                .normalized();
            }
        }
        if t.starts_with('/') {
            let distro = default_distro
                .ok_or_else(|| AppError::InvalidInput("choose a distribution before opening a Linux path".into()))?;
            return Location::Linux {
                distro: distro.to_string(),
                path: t.to_string(),
            }
            .normalized();
        }
        Location::Windows { path: t.to_string() }.normalized()
    }

    /// The path as the Windows host sees it.
    pub fn host_path(&self) -> AppResult<PathBuf> {
        match self.normalized()? {
            Location::Linux { distro, path } => {
                let mut p = format!("\\\\wsl.localhost\\{distro}");
                for seg in path.split('/').filter(|s| !s.is_empty()) {
                    p.push('\\');
                    p.push_str(seg);
                }
                if path == "/" {
                    p.push('\\');
                }
                Ok(PathBuf::from(p))
            }
            Location::Windows { path } => Ok(PathBuf::from(path)),
        }
    }

    /// Argument for `wsl.exe --cd`.
    pub fn terminal_cwd(&self) -> AppResult<String> {
        Ok(match self.normalized()? {
            Location::Linux { path, .. } => path,
            Location::Windows { path } => path,
        })
    }

    pub fn is_linux(&self) -> bool {
        matches!(self, Location::Linux { .. })
    }

    pub fn display(&self) -> String {
        match self {
            Location::Linux { distro, path } => format!("{distro}:{path}"),
            Location::Windows { path } => path.clone(),
        }
    }

    /// True for locations that are too broad to be a project root for write
    /// operations (filesystem roots, drive roots, UNC share roots, home-of-everything).
    pub fn is_too_broad_for_writes(&self) -> bool {
        match self {
            Location::Linux { path, .. } => matches!(
                path.as_str(),
                "/" | "/bin" | "/boot" | "/dev" | "/etc" | "/home" | "/lib" | "/lib64" | "/proc" | "/run" | "/sbin" | "/sys" | "/usr" | "/var" | "/mnt"
            ),
            Location::Windows { path } => {
                let p = path.trim_end_matches('\\');
                let drive_root = p.len() == 2 && p.as_bytes()[1] == b':';
                let unc_root = p.starts_with("\\\\") && p[2..].matches('\\').count() <= 1;
                let lower = p.to_ascii_lowercase();
                let system_dir = lower == "c:\\windows"
                    || lower == "c:\\program files"
                    || lower == "c:\\program files (x86)"
                    || lower == "c:\\users";
                drive_root || unc_root || system_dir
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_linux_paths() {
        assert_eq!(normalize_linux_path("/home//raimy/./proj/").unwrap(), "/home/raimy/proj");
        assert_eq!(normalize_linux_path("/").unwrap(), "/");
        assert!(normalize_linux_path("home/x").is_err());
        assert!(normalize_linux_path("/home/../etc").is_err());
        assert!(normalize_linux_path("/a\\b").is_err());
        assert!(normalize_linux_path("/a\0b").is_err());
        assert!(normalize_linux_path("/a\nb").is_err());
    }

    #[test]
    fn normalizes_windows_paths() {
        assert_eq!(normalize_windows_path("c:/Users/Lenovo//proj/").unwrap(), "C:\\Users\\Lenovo\\proj");
        assert_eq!(normalize_windows_path("C:\\").unwrap(), "C:\\");
        assert_eq!(normalize_windows_path("d:").unwrap(), "D:\\");
        assert_eq!(normalize_windows_path("\\\\srv\\share\\a").unwrap(), "\\\\srv\\share\\a");
        assert!(normalize_windows_path("relative\\path").is_err());
        assert!(normalize_windows_path("C:\\a\\..\\b").is_err());
        assert!(normalize_windows_path("\\\\?\\C:\\x").is_err());
        assert!(normalize_windows_path("C:\\a:stream").is_err());
        assert!(normalize_windows_path("C:\\a|b").is_err());
        assert!(normalize_windows_path("\\\\srv").is_err());
    }

    #[test]
    fn parses_user_input() {
        assert_eq!(
            Location::parse_user_input("/home/raimy", Some("Ubuntu-26.04")).unwrap(),
            Location::Linux { distro: "Ubuntu-26.04".into(), path: "/home/raimy".into() }
        );
        assert_eq!(
            Location::parse_user_input("\\\\wsl.localhost\\Ubuntu-26.04\\home\\raimy\\p", None).unwrap(),
            Location::Linux { distro: "Ubuntu-26.04".into(), path: "/home/raimy/p".into() }
        );
        assert_eq!(
            Location::parse_user_input("\\\\wsl$\\Debian", None).unwrap(),
            Location::Linux { distro: "Debian".into(), path: "/".into() }
        );
        assert_eq!(
            Location::parse_user_input("\"C:\\Users\\Lenovo\\x\"", None).unwrap(),
            Location::Windows { path: "C:\\Users\\Lenovo\\x".into() }
        );
        assert!(Location::parse_user_input("/home/x", None).is_err());
        assert!(Location::parse_user_input("   ", None).is_err());
    }

    #[test]
    fn maps_to_host_paths() {
        let l = Location::Linux { distro: "Ubuntu-26.04".into(), path: "/home/raimy".into() };
        assert_eq!(l.host_path().unwrap(), PathBuf::from("\\\\wsl.localhost\\Ubuntu-26.04\\home\\raimy"));
        let root = Location::Linux { distro: "Ubuntu-26.04".into(), path: "/".into() };
        assert_eq!(root.host_path().unwrap(), PathBuf::from("\\\\wsl.localhost\\Ubuntu-26.04\\"));
        let w = Location::Windows { path: "C:\\dev".into() };
        assert_eq!(w.host_path().unwrap(), PathBuf::from("C:\\dev"));
    }

    #[test]
    fn rejects_bad_distro_in_location() {
        let l = Location::Linux { distro: "..\\evil".into(), path: "/".into() };
        assert!(l.host_path().is_err());
    }

    #[test]
    fn flags_broad_roots() {
        assert!(Location::Windows { path: "C:\\".into() }.is_too_broad_for_writes());
        assert!(Location::Windows { path: "C:\\Windows".into() }.is_too_broad_for_writes());
        assert!(Location::Windows { path: "\\\\srv\\share".into() }.is_too_broad_for_writes());
        assert!(!Location::Windows { path: "C:\\Users\\Lenovo\\proj".into() }.is_too_broad_for_writes());
        assert!(Location::Linux { distro: "U".into(), path: "/".into() }.is_too_broad_for_writes());
        assert!(Location::Linux { distro: "U".into(), path: "/etc".into() }.is_too_broad_for_writes());
        assert!(!Location::Linux { distro: "U".into(), path: "/home/a/p".into() }.is_too_broad_for_writes());
    }
}
