//! Filesystem operations for the project explorer.
//!
//! Every mutating call takes a project root plus a path relative to it. The
//! relative path is parsed into components (`..`, absolute parts and drive
//! prefixes are rejected, not "cleaned up"), and the chain from the root to the
//! target is walked so a symbolic link or junction can never be used to step
//! outside the root. Read-only directory listings may follow links.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::location::Location;

const MAX_ENTRIES: usize = 5000;
const MAX_NAME_BYTES: usize = 255;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Dir,
    File,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub hidden: bool,
    pub symlink: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub entries: Vec<FsEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLocation {
    pub location: Location,
    pub host_path: String,
    pub display: String,
    pub exists: bool,
    pub is_dir: bool,
    pub too_broad_for_writes: bool,
}

// --------------------------------------------------------------------------
// Names and relative paths
// --------------------------------------------------------------------------

const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
    "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A single file or folder name (not a path).
pub fn validate_entry_name(name: &str) -> AppResult<()> {
    let bad = |why: &str| Err(AppError::InvalidInput(format!("'{name}' is not a valid name: {why}")));
    if name.is_empty() || name.trim().is_empty() {
        return bad("it is empty");
    }
    if name.len() > MAX_NAME_BYTES {
        return bad("it is too long");
    }
    if name == "." || name == ".." {
        return bad("reserved name");
    }
    if name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*')) {
        return bad("it contains a character that is not allowed (/ \\ < > : \" | ? *)");
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return bad("it must not end with a dot or a space");
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        return bad("it is a reserved Windows device name");
    }
    Ok(())
}

/// Splits a root-relative path into validated components.
pub fn parse_rel(rel: &str) -> AppResult<Vec<String>> {
    if rel.contains('\0') || rel.chars().any(|c| c.is_control()) {
        return Err(AppError::InvalidInput("path contains control characters".into()));
    }
    let mut out = Vec::new();
    for seg in rel.split(['/', '\\']) {
        match seg {
            "" | "." => {}
            ".." => return Err(AppError::PathOutsideRoot),
            s if s.contains(':') => return Err(AppError::PathOutsideRoot),
            s => out.push(s.to_string()),
        }
    }
    Ok(out)
}

fn join(root: &Path, segs: &[String]) -> PathBuf {
    let mut p = root.to_path_buf();
    for s in segs {
        p.push(s);
    }
    p
}

/// Walks root -> target and fails if any existing intermediate component is a
/// symlink/junction. `check_last` also tests the final component (used when the
/// operation would follow it).
fn ensure_no_link_in_chain(root: &Path, segs: &[String], check_last: bool) -> AppResult<()> {
    let mut cur = root.to_path_buf();
    for (i, s) in segs.iter().enumerate() {
        cur.push(s);
        let is_last = i + 1 == segs.len();
        if is_last && !check_last {
            break;
        }
        match fs::symlink_metadata(&cur) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err(AppError::Denied(
                    "this path passes through a symbolic link or junction, so it cannot be changed from here".into(),
                ))
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

fn writable_root(root: &Location) -> AppResult<PathBuf> {
    let root = root.normalized()?;
    if root.is_too_broad_for_writes() {
        return Err(AppError::Denied(format!(
            "{} is too broad to modify from the explorer. Open a project folder inside it instead.",
            root.display()
        )));
    }
    let host = root.host_path()?;
    let meta = fs::metadata(&host).map_err(|e| AppError::NotFound(format!("project root {}: {e}", root.display())))?;
    if !meta.is_dir() {
        return Err(AppError::InvalidInput("the project root is not a directory".into()));
    }
    Ok(host)
}

// --------------------------------------------------------------------------
// Listing
// --------------------------------------------------------------------------

#[cfg(windows)]
fn is_hidden_attr(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & 0x2 != 0
}
#[cfg(not(windows))]
fn is_hidden_attr(_meta: &fs::Metadata) -> bool {
    false
}

fn entry_from(dirent: &fs::DirEntry) -> Option<FsEntry> {
    let name = dirent.file_name().to_string_lossy().into_owned();
    let lmeta = dirent.metadata().ok()?;
    let symlink = lmeta.file_type().is_symlink();
    let meta = if symlink { fs::metadata(dirent.path()).unwrap_or(lmeta.clone()) } else { lmeta.clone() };
    let kind = if symlink && fs::metadata(dirent.path()).is_err() {
        EntryKind::Other
    } else if meta.is_dir() {
        EntryKind::Dir
    } else if meta.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    };
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    Some(FsEntry {
        hidden: name.starts_with('.') || is_hidden_attr(&lmeta),
        size: if kind == EntryKind::File { meta.len() } else { 0 },
        name,
        kind,
        modified_ms,
        symlink,
    })
}

fn sort_entries(entries: &mut [FsEntry]) {
    entries.sort_by(|a, b| {
        let ad = a.kind == EntryKind::Dir;
        let bd = b.kind == EntryKind::Dir;
        bd.cmp(&ad).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

fn read_dir_entries(dir: &Path, show_hidden: bool, dirs_only: bool) -> AppResult<DirListing> {
    let rd = fs::read_dir(dir).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => AppError::NotFound(format!("{} does not exist", dir.display())),
        std::io::ErrorKind::PermissionDenied => AppError::Denied(format!("cannot read {}", dir.display())),
        _ => AppError::Io(format!("cannot list {}: {e}", dir.display())),
    })?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for dirent in rd.flatten() {
        let Some(entry) = entry_from(&dirent) else { continue };
        if (!show_hidden && entry.hidden) || (dirs_only && entry.kind != EntryKind::Dir) {
            continue;
        }
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        entries.push(entry);
    }
    sort_entries(&mut entries);
    Ok(DirListing { entries, truncated })
}

pub fn resolve_location(loc: &Location) -> AppResult<ResolvedLocation> {
    let location = loc.normalized()?;
    let host = location.host_path()?;
    let meta = fs::metadata(&host).ok();
    Ok(ResolvedLocation {
        display: location.display(),
        host_path: host.display().to_string(),
        exists: meta.is_some(),
        is_dir: meta.map(|m| m.is_dir()).unwrap_or(false),
        too_broad_for_writes: location.is_too_broad_for_writes(),
        location,
    })
}

/// Lists a directory below a project root. Read-only; may follow links.
pub fn list_dir(root: &Location, rel: &str, show_hidden: bool) -> AppResult<DirListing> {
    let root_host = root.normalized()?.host_path()?;
    let segs = parse_rel(rel)?;
    read_dir_entries(&join(&root_host, &segs), show_hidden, false)
}

/// Lists only sub-directories of an arbitrary location (for the folder picker).
pub fn browse_dirs(loc: &Location, show_hidden: bool) -> AppResult<DirListing> {
    let host = loc.normalized()?.host_path()?;
    read_dir_entries(&host, show_hidden, true)
}

// --------------------------------------------------------------------------
// Mutations
// --------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateKind {
    File,
    Dir,
}

pub fn create_entry(root: &Location, rel_parent: &str, name: &str, kind: CreateKind) -> AppResult<()> {
    validate_entry_name(name)?;
    let root_host = writable_root(root)?;
    let parent_segs = parse_rel(rel_parent)?;
    ensure_no_link_in_chain(&root_host, &parent_segs, true)?;
    let parent = join(&root_host, &parent_segs);
    if !fs::metadata(&parent).map(|m| m.is_dir()).unwrap_or(false) {
        return Err(AppError::NotFound("the destination folder does not exist".into()));
    }
    let target = parent.join(name);
    match kind {
        CreateKind::Dir => fs::create_dir(&target)?,
        CreateKind::File => {
            fs::OpenOptions::new().write(true).create_new(true).open(&target)?;
        }
    }
    Ok(())
}

pub fn rename_entry(root: &Location, rel: &str, new_name: &str) -> AppResult<()> {
    validate_entry_name(new_name)?;
    let root_host = writable_root(root)?;
    let segs = parse_rel(rel)?;
    if segs.is_empty() {
        return Err(AppError::Denied("the project root cannot be renamed from here".into()));
    }
    ensure_no_link_in_chain(&root_host, &segs, false)?;
    let src = join(&root_host, &segs);
    fs::symlink_metadata(&src).map_err(|_| AppError::NotFound(format!("{} does not exist", segs.join("/"))))?;
    let old_name = segs.last().cloned().unwrap_or_default();
    let dest = src.with_file_name(new_name);
    let case_only = old_name != new_name && old_name.eq_ignore_ascii_case(new_name);
    if !case_only && fs::symlink_metadata(&dest).is_ok() {
        return Err(AppError::AlreadyExists(new_name.to_string()));
    }
    fs::rename(&src, &dest)?;
    Ok(())
}

pub fn delete_entry(root: &Location, rel: &str) -> AppResult<()> {
    let root_host = writable_root(root)?;
    let segs = parse_rel(rel)?;
    if segs.is_empty() {
        return Err(AppError::Denied("the project root itself cannot be deleted from the explorer".into()));
    }
    ensure_no_link_in_chain(&root_host, &segs, false)?;
    let target = join(&root_host, &segs);
    let meta = fs::symlink_metadata(&target).map_err(|_| AppError::NotFound(format!("{} does not exist", segs.join("/"))))?;
    if meta.file_type().is_symlink() {
        // Remove the link itself, never what it points to.
        if fs::remove_file(&target).is_err() {
            fs::remove_dir(&target)?;
        }
    } else if meta.is_dir() {
        fs::remove_dir_all(&target)?;
    } else {
        fs::remove_file(&target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn win_root(p: &Path) -> Location {
        Location::Windows { path: p.display().to_string() }
    }

    #[test]
    fn rel_parsing_rejects_traversal() {
        assert_eq!(parse_rel("a/b\\c").unwrap(), vec!["a", "b", "c"]);
        assert_eq!(parse_rel("").unwrap(), Vec::<String>::new());
        assert!(matches!(parse_rel("../x"), Err(AppError::PathOutsideRoot)));
        assert!(matches!(parse_rel("a/../../x"), Err(AppError::PathOutsideRoot)));
        assert!(matches!(parse_rel("C:\\Windows"), Err(AppError::PathOutsideRoot)));
        assert!(matches!(parse_rel("a:stream"), Err(AppError::PathOutsideRoot)));
        assert!(parse_rel("a\0b").is_err());
        // a leading slash is just an empty segment: it stays relative to the root
        assert_eq!(parse_rel("/etc/passwd").unwrap(), vec!["etc", "passwd"]);
    }

    #[test]
    fn name_validation() {
        for ok in ["main.py", ".gitignore", "a b", "Makefile", "dir.d"] {
            assert!(validate_entry_name(ok).is_ok(), "{ok}");
        }
        for bad in ["", " ", ".", "..", "a/b", "a\\b", "a:b", "a*", "con", "NUL.txt", "name.", "name ", "a\nb"] {
            assert!(validate_entry_name(bad).is_err(), "{bad:?}");
        }
        assert!(validate_entry_name(&"x".repeat(256)).is_err());
    }

    #[test]
    fn create_rename_delete_roundtrip() {
        let dir = tempdir().unwrap();
        let root = win_root(dir.path());
        create_entry(&root, "", "src", CreateKind::Dir).unwrap();
        create_entry(&root, "src", "main.py", CreateKind::File).unwrap();
        assert!(matches!(
            create_entry(&root, "src", "main.py", CreateKind::File),
            Err(AppError::AlreadyExists(_))
        ));

        let listing = list_dir(&root, "src", true).unwrap();
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].name, "main.py");

        rename_entry(&root, "src/main.py", "app.py").unwrap();
        assert!(dir.path().join("src").join("app.py").exists());
        assert!(matches!(
            rename_entry(&root, "src/app.py", "app.py"),
            Ok(()) | Err(AppError::AlreadyExists(_))
        ));

        create_entry(&root, "src", "other.py", CreateKind::File).unwrap();
        assert!(matches!(
            rename_entry(&root, "src/other.py", "app.py"),
            Err(AppError::AlreadyExists(_))
        ));

        delete_entry(&root, "src").unwrap();
        assert!(!dir.path().join("src").exists());
    }

    #[test]
    fn case_only_rename_is_allowed() {
        let dir = tempdir().unwrap();
        let root = win_root(dir.path());
        create_entry(&root, "", "readme.md", CreateKind::File).unwrap();
        rename_entry(&root, "readme.md", "README.md").unwrap();
        let names: Vec<String> = list_dir(&root, "", true).unwrap().entries.into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["README.md"]);
    }

    #[test]
    fn traversal_is_rejected_for_every_mutation() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("victim.txt"), "x").unwrap();
        let root_path = dir.path().join("proj");
        fs::create_dir(&root_path).unwrap();
        let root = win_root(&root_path);

        let evil = format!("../{}/victim.txt", outside.path().file_name().unwrap().to_string_lossy());
        assert!(matches!(delete_entry(&root, &evil), Err(AppError::PathOutsideRoot)));
        assert!(matches!(rename_entry(&root, &evil, "z"), Err(AppError::PathOutsideRoot)));
        assert!(matches!(
            create_entry(&root, "../", "z", CreateKind::File),
            Err(AppError::PathOutsideRoot)
        ));
        assert!(matches!(list_dir(&root, "..", true), Err(AppError::PathOutsideRoot)));
        assert!(outside.path().join("victim.txt").exists());
    }

    #[test]
    fn root_cannot_be_deleted_or_renamed() {
        let dir = tempdir().unwrap();
        let root = win_root(dir.path());
        assert!(matches!(delete_entry(&root, ""), Err(AppError::Denied(_))));
        assert!(matches!(delete_entry(&root, "."), Err(AppError::Denied(_))));
        assert!(matches!(rename_entry(&root, "", "x"), Err(AppError::Denied(_))));
        assert!(dir.path().exists());
    }

    #[test]
    fn broad_roots_are_refused_for_writes() {
        let root = Location::Windows { path: "C:\\".into() };
        assert!(matches!(create_entry(&root, "", "x", CreateKind::Dir), Err(AppError::Denied(_))));
        assert!(matches!(delete_entry(&root, "Windows"), Err(AppError::Denied(_))));
    }

    #[test]
    fn hidden_files_are_filtered_on_request() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(".env"), "").unwrap();
        fs::write(dir.path().join("a.txt"), "").unwrap();
        fs::create_dir(dir.path().join("zdir")).unwrap();
        let root = win_root(dir.path());
        let shown = list_dir(&root, "", true).unwrap();
        let hidden_off = list_dir(&root, "", false).unwrap();
        assert_eq!(shown.entries.len(), 3);
        assert_eq!(hidden_off.entries.len(), 2);
        // directories sort first
        assert_eq!(hidden_off.entries[0].name, "zdir");
    }

    #[test]
    fn browse_returns_only_directories() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let out = browse_dirs(&win_root(dir.path()), true).unwrap();
        assert_eq!(out.entries.len(), 1);
        assert_eq!(out.entries[0].name, "sub");
    }

    #[cfg(windows)]
    #[test]
    fn mutation_through_a_link_is_refused() {
        use std::os::windows::fs::symlink_dir;
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("victim.txt"), "x").unwrap();
        let root_path = dir.path().join("proj");
        fs::create_dir(&root_path).unwrap();
        // Symlink creation needs Developer Mode or elevation; skip when unavailable.
        if symlink_dir(outside.path(), root_path.join("link")).is_err() {
            eprintln!("skipping: cannot create symlinks on this machine");
            return;
        }
        let root = win_root(&root_path);
        assert!(matches!(delete_entry(&root, "link/victim.txt"), Err(AppError::Denied(_))));
        assert!(outside.path().join("victim.txt").exists());
        // deleting the link itself only removes the link
        delete_entry(&root, "link").unwrap();
        assert!(!root_path.join("link").exists());
        assert!(outside.path().join("victim.txt").exists());
    }
}
