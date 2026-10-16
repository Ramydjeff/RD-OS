//! Small structured file logger with secret redaction.
//!
//! Logs live in the app's local log directory and never contain terminal
//! contents or full command lines. Anything that might carry a credential is
//! passed through [`redact`] before it is written.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MESSAGE_CHARS: usize = 2000;

static LOGGER: OnceLock<Mutex<File>> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn label(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }

    pub fn parse(s: &str) -> Level {
        match s.to_ascii_lowercase().as_str() {
            "error" => Level::Error,
            "warn" | "warning" => Level::Warn,
            _ => Level::Info,
        }
    }
}

pub fn init(dir: &Path) -> Option<PathBuf> {
    fs::create_dir_all(dir).ok()?;
    let path = dir.join("rycos.log");
    if fs::metadata(&path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = fs::rename(&path, dir.join("rycos.log.1"));
    }
    let file = OpenOptions::new().create(true).append(true).open(&path).ok()?;
    let _ = LOGGER.set(Mutex::new(file));
    Some(path)
}

pub fn log(level: Level, source: &str, message: &str) {
    let mut msg = redact(message);
    if msg.chars().count() > MAX_MESSAGE_CHARS {
        msg = msg.chars().take(MAX_MESSAGE_CHARS).collect::<String>() + "...";
    }
    // Keep one event per line.
    let msg = msg.replace(['\r', '\n'], " ");
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let line = format!("{ts} {} [{source}] {msg}\n", level.label());
    if let Some(lock) = LOGGER.get() {
        if let Ok(mut f) = lock.lock() {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

pub fn info(source: &str, message: &str) {
    log(Level::Info, source, message);
}
pub fn warn(source: &str, message: &str) {
    log(Level::Warn, source, message);
}
pub fn error(source: &str, message: &str) {
    log(Level::Error, source, message);
}

const SECRET_KEYS: &[&str] = &[
    "password",
    "passwd",
    "pwd",
    "passphrase",
    "secret",
    "token",
    "api_key",
    "apikey",
    "api-key",
    "access_key",
    "private_key",
    "authorization",
    "auth",
    "credential",
    "cookie",
    "session_key",
];

const MASK: &str = "[REDACTED]";

/// Masks values that follow secret-looking keys (`password=...`, `--token abc`,
/// `Authorization: Bearer ...`) and credentials embedded in URLs.
pub fn redact(input: &str) -> String {
    let mut out = redact_url_credentials(input);
    out = redact_bearer(&out);
    redact_key_values(&out)
}

fn redact_url_credentials(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(idx) = rest.find("://") {
        let (head, tail) = rest.split_at(idx + 3);
        out.push_str(head);
        // authority ends at '/', whitespace, '?' or '#'
        let end = tail
            .find(|c: char| c == '/' || c.is_whitespace() || c == '?' || c == '#')
            .unwrap_or(tail.len());
        let authority = &tail[..end];
        if let Some(at) = authority.rfind('@') {
            if authority[..at].contains(':') || !authority[..at].is_empty() {
                out.push_str(MASK);
                out.push('@');
                out.push_str(&authority[at + 1..]);
            } else {
                out.push_str(authority);
            }
        } else {
            out.push_str(authority);
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

fn redact_bearer(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut pos = 0;
    while let Some(rel) = lower[pos..].find("bearer ") {
        let start = pos + rel + "bearer ".len();
        out.push_str(&s[pos..start]);
        let end = s[start..]
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ',' || c == ';')
            .map(|i| start + i)
            .unwrap_or(s.len());
        if end > start {
            out.push_str(MASK);
        }
        pos = end;
    }
    out.push_str(&s[pos..]);
    out
}

fn redact_key_values(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let mut matched: Option<usize> = None;
        // Only start a match at a word boundary so "keyword" inside words is ignored.
        let boundary = i == 0 || !(bytes[i - 1].is_ascii_alphanumeric());
        if boundary {
            for key in SECRET_KEYS {
                if lower[i..].starts_with(key) {
                    matched = Some(key.len());
                    break;
                }
            }
        }
        if let Some(klen) = matched {
            let mut j = i + klen;
            // allow trailing identifier chars (PASSWORD_FILE, token_value, ...)
            while j < s.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'-') {
                j += 1;
            }
            // closing quote of a JSON-style key ("password": "x")
            let mut k = j;
            if k < s.len() && (bytes[k] == b'"' || bytes[k] == b'\'') {
                k += 1;
            }
            let mut sep = k;
            while sep < s.len() && bytes[sep] == b' ' {
                sep += 1;
            }
            let has_sep = sep < s.len() && (bytes[sep] == b'=' || bytes[sep] == b':');
            let cli_flag = i >= 2 && &s[i - 2..i] == "--";
            if has_sep || (cli_flag && sep > j) {
                let mut v = if has_sep { sep + 1 } else { sep };
                while v < s.len() && bytes[v] == b' ' {
                    v += 1;
                }
                let quote = if v < s.len() && (bytes[v] == b'"' || bytes[v] == b'\'') {
                    let q = bytes[v];
                    v += 1;
                    Some(q)
                } else {
                    None
                };
                let mut vstart = v;
                let scan = |mut v: usize| {
                    while v < s.len() {
                        let b = bytes[v];
                        match quote {
                            Some(q) if b == q => break,
                            None if b.is_ascii_whitespace() || b == b',' || b == b';' || b == b'&' => break,
                            _ => v += 1,
                        }
                    }
                    v
                };
                v = scan(v);
                // "Authorization: Bearer <token>" / "Basic <credentials>": keep the
                // scheme word and mask only what follows it.
                let first = &lower[vstart..v];
                if quote.is_none() && (first == "bearer" || first == "basic") && v < s.len() && bytes[v] == b' ' {
                    let mut t = v;
                    while t < s.len() && bytes[t] == b' ' {
                        t += 1;
                    }
                    vstart = t;
                    v = scan(t);
                    out.push_str(&s[i..vstart]);
                    if &s[vstart..v] != MASK && v > vstart {
                        out.push_str(MASK);
                    } else {
                        out.push_str(&s[vstart..v]);
                    }
                    i = v;
                    continue;
                }
                if v > vstart {
                    out.push_str(&s[i..vstart]);
                    out.push_str(MASK);
                    i = v;
                    continue;
                }
            }
            out.push_str(&s[i..j]);
            i = j;
            continue;
        }
        let ch = s[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_key_value_pairs() {
        assert_eq!(redact("password=hunter2 user=bob"), "password=[REDACTED] user=bob");
        assert_eq!(redact("PASSWORD: s3cret"), "PASSWORD: [REDACTED]");
        assert_eq!(redact("API_KEY=abc123;next"), "API_KEY=[REDACTED];next");
    }

    #[test]
    fn masks_cli_flags() {
        assert_eq!(redact("curl --token abcdef https://x.y"), "curl --token [REDACTED] https://x.y");
        assert_eq!(redact("--password=pw"), "--password=[REDACTED]");
    }

    #[test]
    fn masks_bearer_and_url_credentials() {
        assert_eq!(redact("Authorization: Bearer abc.def.ghi"), "Authorization: Bearer [REDACTED]");
        assert_eq!(
            redact("git clone https://bob:pw@github.com/a/b.git"),
            "git clone https://[REDACTED]@github.com/a/b.git"
        );
    }

    #[test]
    fn masks_json_style() {
        assert_eq!(redact(r#"{"token": "xyz", "name": "a"}"#), r#"{"token": "[REDACTED]", "name": "a"}"#);
    }

    #[test]
    fn leaves_ordinary_text_alone() {
        let s = "Opened terminal in Ubuntu-26.04 at /home/raimy/projects";
        assert_eq!(redact(s), s);
        // a word merely containing a keyword is not a key
        assert_eq!(redact("keyauthority is fine"), "keyauthority is fine");
    }
}
