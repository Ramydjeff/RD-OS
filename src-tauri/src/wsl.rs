//! WSL discovery and command execution.
//!
//! Everything here talks to `wsl.exe` using structured arguments (never a shell
//! string built from user input). Terminals themselves are created in
//! [`crate::pty`]; this module covers detection, diagnostics and the small
//! helper commands that run inside a distribution.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::proc::{run_capture, Captured};

const LIST_TIMEOUT: Duration = Duration::from_secs(15);
const CACHE_TTL: Duration = Duration::from_secs(30);

/// Distributions that are owned by another product. We list them but never
/// start them, open terminals in them, or offer controls that could alter them.
const MANAGED_DISTROS: &[&str] = &[
    "docker-desktop",
    "docker-desktop-data",
    "rancher-desktop",
    "rancher-desktop-data",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Distro {
    pub name: String,
    /// Raw state column as printed by wsl.exe (may be localized).
    pub state: String,
    pub running: bool,
    pub version: u8,
    pub is_default: bool,
    pub managed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslProblem {
    pub code: String,
    pub message: String,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WslStatus {
    pub available: bool,
    pub wsl_path: Option<String>,
    /// Raw `wsl.exe --version` output (labels may be localized).
    pub version_text: Option<String>,
    /// First value of `--version`, normally the WSL package version.
    pub wsl_version: Option<String>,
    /// Raw `wsl.exe --status` output.
    pub status_text: Option<String>,
    pub default_distro: Option<String>,
    pub distros: Vec<Distro>,
    pub problem: Option<WslProblem>,
}

// --------------------------------------------------------------------------
// Locating wsl.exe
// --------------------------------------------------------------------------

/// Absolute path of `wsl.exe` in System32 when present, so a PATH entry cannot
/// shadow it. Falls back to a PATH lookup.
pub fn wsl_exe() -> PathBuf {
    if let Some(root) = std::env::var_os("SystemRoot").or_else(|| std::env::var_os("windir")) {
        let p = PathBuf::from(root).join("System32").join("wsl.exe");
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from("wsl.exe")
}

pub fn wsl_installed() -> bool {
    wsl_exe().is_absolute() && wsl_exe().is_file()
}

fn wsl_command() -> Command {
    let mut cmd = Command::new(wsl_exe());
    // Ask modern WSL builds for UTF-8; older ones still emit UTF-16LE, which
    // `decode_output` also handles.
    cmd.env("WSL_UTF8", "1");
    cmd
}

pub fn run_wsl(args: &[&str], timeout: Duration) -> AppResult<Captured> {
    let mut cmd = wsl_command();
    cmd.args(args);
    run_capture(cmd, timeout)
}

// --------------------------------------------------------------------------
// Decoding and parsing
// --------------------------------------------------------------------------

/// Decodes process output that may be UTF-16LE (with or without BOM) or UTF-8.
pub fn decode_output(bytes: &[u8]) -> String {
    let text = if bytes.starts_with(&[0xFF, 0xFE]) {
        decode_utf16le(&bytes[2..])
    } else if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(&bytes[3..]).into_owned()
    } else if looks_like_utf16le(bytes) {
        decode_utf16le(bytes)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    text.replace('\r', "").replace('\0', "")
}

fn decode_utf16le(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    char::decode_utf16(units)
        .map(|r| r.unwrap_or('\u{FFFD}'))
        .collect()
}

fn looks_like_utf16le(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(512)];
    if sample.len() < 4 {
        return false;
    }
    let pairs = sample.len() / 2;
    let zero_high = sample.chunks_exact(2).filter(|c| c[1] == 0 && c[0] != 0).count();
    zero_high * 2 >= pairs
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedRow {
    pub name: String,
    pub state: String,
    pub version: u8,
    pub is_default: bool,
}

/// Parses `wsl.exe -l -v`. The header is localized, so rows are recognised by
/// shape (`[*] NAME STATE VERSION`) instead of by header text.
pub fn parse_distro_table(text: &str) -> Vec<ParsedRow> {
    let mut rows = Vec::new();
    for raw in text.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim_start();
        if trimmed.is_empty() {
            continue;
        }
        let (is_default, body) = match trimmed.strip_prefix('*') {
            Some(rest) => (true, rest.trim_start()),
            None => (false, trimmed),
        };
        let tokens: Vec<&str> = body.split_whitespace().collect();
        if tokens.len() < 3 {
            continue;
        }
        let Some(version) = tokens[tokens.len() - 1].parse::<u8>().ok().filter(|v| (1..=2).contains(v)) else {
            continue;
        };
        let state = tokens[tokens.len() - 2].to_string();
        let name = tokens[..tokens.len() - 2].join(" ");
        if validate_distro_name(&name).is_err() {
            continue;
        }
        rows.push(ParsedRow {
            name,
            state,
            version,
            is_default,
        });
    }
    rows
}

/// Parses name-per-line output (`wsl.exe -l -q`, `--running -q`).
pub fn parse_name_list(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim().trim_start_matches('*').trim().to_string())
        .filter(|l| validate_distro_name(l).is_ok())
        .collect()
}

pub fn is_managed(name: &str) -> bool {
    MANAGED_DISTROS.iter().any(|m| m.eq_ignore_ascii_case(name))
}

/// Distribution names are used as process arguments and inside UNC paths.
/// They must start with an alphanumeric (so they can never look like an option)
/// and may only contain a conservative character set.
pub fn validate_distro_name(name: &str) -> AppResult<()> {
    let ok_len = !name.is_empty() && name.len() <= 64;
    let mut chars = name.chars();
    let first_ok = chars.next().map(|c| c.is_ascii_alphanumeric()).unwrap_or(false);
    let rest_ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '));
    if ok_len && first_ok && rest_ok && !name.ends_with(' ') {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!("'{name}' is not a valid distribution name")))
    }
}

// --------------------------------------------------------------------------
// Detection
// --------------------------------------------------------------------------

static DISTRO_CACHE: Mutex<Option<(Instant, Vec<Distro>)>> = Mutex::new(None);

fn store_cache(distros: &[Distro]) {
    if let Ok(mut c) = DISTRO_CACHE.lock() {
        *c = Some((Instant::now(), distros.to_vec()));
    }
}

fn problem(code: &str, message: impl Into<String>, hint: impl Into<String>) -> WslProblem {
    WslProblem {
        code: code.into(),
        message: message.into(),
        hint: hint.into(),
    }
}

/// Full, fresh WSL inspection. Never starts or modifies a distribution.
pub fn detect() -> WslStatus {
    let mut status = WslStatus::default();

    if !wsl_installed() {
        status.problem = Some(problem(
            "not_installed",
            "wsl.exe was not found in the Windows System32 folder.",
            "Install WSL from an elevated PowerShell with `wsl --install`, restart Windows, then press Refresh.",
        ));
        return status;
    }
    status.wsl_path = Some(wsl_exe().display().to_string());

    // Version information is optional: very old WSL builds do not support it.
    if let Ok(out) = run_wsl(&["--version"], LIST_TIMEOUT) {
        if out.success() {
            let text = decode_output(&out.stdout);
            status.wsl_version = text
                .lines()
                .find_map(|l| l.split_once(':').map(|(_, v)| v.trim().to_string()))
                .filter(|v| !v.is_empty());
            status.version_text = Some(text.trim().to_string());
        }
    }
    if let Ok(out) = run_wsl(&["--status"], LIST_TIMEOUT) {
        let text = decode_output(&out.stdout);
        if !text.trim().is_empty() {
            status.status_text = Some(text.trim().to_string());
        }
    }

    let list = match run_wsl(&["-l", "-v"], LIST_TIMEOUT) {
        Ok(o) => o,
        Err(e) => {
            status.problem = Some(problem("command_failed", e.to_string(), "Run `wsl.exe -l -v` in a terminal to see the underlying error."));
            return status;
        }
    };
    if list.timed_out {
        status.problem = Some(problem(
            "timeout",
            "wsl.exe -l -v did not respond within 15 seconds.",
            "The WSL service may be stuck. Try `wsl.exe --shutdown` in PowerShell (this stops all running distributions), then press Refresh.",
        ));
        return status;
    }
    let list_text = decode_output(&list.stdout);
    let rows = parse_distro_table(&list_text);
    if rows.is_empty() {
        let err_text = decode_output(&list.stderr);
        let detail = if !err_text.trim().is_empty() { err_text } else { list_text };
        status.problem = Some(problem(
            "no_distributions",
            if detail.trim().is_empty() {
                "WSL reported no installed distributions.".to_string()
            } else {
                format!("WSL reported no installed distributions: {}", detail.trim())
            },
            "Install one with `wsl.exe --install -d Ubuntu` (or `wsl.exe --list --online` to see choices), then press Refresh.",
        ));
        status.available = true;
        return status;
    }

    let running_names = match run_wsl(&["-l", "--running", "-q"], LIST_TIMEOUT) {
        Ok(o) if !o.timed_out => Some(parse_name_list(&decode_output(&o.stdout))),
        _ => None,
    };

    status.distros = rows
        .into_iter()
        .map(|r| {
            let running = match &running_names {
                Some(names) => names.iter().any(|n| n.eq_ignore_ascii_case(&r.name)),
                None => r.state.eq_ignore_ascii_case("running"),
            };
            Distro {
                managed: is_managed(&r.name),
                name: r.name,
                state: r.state,
                running,
                version: r.version,
                is_default: r.is_default,
            }
        })
        .collect();
    status.default_distro = status.distros.iter().find(|d| d.is_default).map(|d| d.name.clone());
    status.available = true;
    store_cache(&status.distros);
    status
}

/// Names of currently running distributions (no side effects).
pub fn running_distros() -> AppResult<Vec<String>> {
    let out = run_wsl(&["-l", "--running", "-q"], LIST_TIMEOUT)?;
    if out.timed_out {
        return Err(AppError::WslUnavailable("wsl.exe did not respond".into()));
    }
    Ok(parse_name_list(&decode_output(&out.stdout)))
}

fn cached_or_fresh_distros() -> AppResult<Vec<Distro>> {
    if let Ok(c) = DISTRO_CACHE.lock() {
        if let Some((at, list)) = c.as_ref() {
            if at.elapsed() < CACHE_TTL {
                return Ok(list.clone());
            }
        }
    }
    let status = detect();
    if let Some(p) = status.problem.as_ref().filter(|_| status.distros.is_empty()) {
        return Err(AppError::WslUnavailable(p.message.clone()));
    }
    Ok(status.distros)
}

/// Validates `name`, confirms it exists, and rejects managed system distributions.
/// Returns the canonical spelling reported by WSL.
pub fn ensure_usable_distro(name: &str) -> AppResult<Distro> {
    validate_distro_name(name)?;
    let distros = cached_or_fresh_distros()?;
    let found = distros
        .iter()
        .find(|d| d.name == name)
        .or_else(|| distros.iter().find(|d| d.name.eq_ignore_ascii_case(name)))
        .cloned()
        .ok_or_else(|| AppError::DistroNotFound(name.to_string()))?;
    if found.managed {
        return Err(AppError::Denied(format!(
            "'{}' is a system distribution managed by another application. It is shown for information only.",
            found.name
        )));
    }
    Ok(found)
}

/// Default distribution to use when a request does not name one.
pub fn pick_default_distro(preferred: Option<&str>) -> AppResult<String> {
    let distros = cached_or_fresh_distros()?;
    let usable = |d: &&Distro| !d.managed;
    if let Some(p) = preferred {
        if let Some(d) = distros.iter().filter(usable).find(|d| d.name.eq_ignore_ascii_case(p)) {
            return Ok(d.name.clone());
        }
    }
    distros
        .iter()
        .filter(usable)
        .find(|d| d.is_default)
        .or_else(|| distros.iter().find(|d| !d.managed))
        .map(|d| d.name.clone())
        .ok_or_else(|| AppError::DistroNotFound("no usable distribution is installed".into()))
}

// --------------------------------------------------------------------------
// Running commands inside a distribution
// --------------------------------------------------------------------------

/// Runs `program args...` directly (no shell) in `distro`. Starts the
/// distribution if it is stopped.
pub fn exec(distro: &str, program_and_args: &[&str], timeout: Duration) -> AppResult<Captured> {
    validate_distro_name(distro)?;
    let mut cmd = wsl_command();
    cmd.args(["-d", distro, "--exec"]).args(program_and_args);
    run_capture(cmd, timeout)
}

/// Runs a fixed script through `sh -c`, passing user-influenced values only as
/// positional parameters (`$1`, `$2`, ...) so they can never be parsed as shell syntax.
pub fn exec_script(distro: &str, shell: &str, script: &str, params: &[&str], timeout: Duration) -> AppResult<Captured> {
    let mut args: Vec<&str> = vec![shell];
    if shell == "bash" {
        args.push("-lc");
    } else {
        args.push("-c");
    }
    args.push(script);
    args.push(shell);
    args.extend_from_slice(params);
    exec(distro, &args, timeout)
}

pub fn start_distro(name: &str) -> AppResult<()> {
    let d = ensure_usable_distro(name)?;
    let out = exec(&d.name, &["/bin/true"], Duration::from_secs(60))?;
    if out.timed_out {
        return Err(AppError::Process(format!("{} did not start within 60 seconds", d.name)));
    }
    if !out.success() {
        return Err(AppError::Process(format!(
            "{} failed to start: {}",
            d.name,
            first_line(&decode_output(&out.stderr)).unwrap_or_else(|| "unknown error".into())
        )));
    }
    if let Ok(mut c) = DISTRO_CACHE.lock() {
        *c = None;
    }
    Ok(())
}

/// Stops a single distribution (`wsl --terminate`). Never touches managed ones.
pub fn terminate_distro(name: &str) -> AppResult<()> {
    let d = ensure_usable_distro(name)?;
    let out = run_wsl(&["--terminate", &d.name], Duration::from_secs(30))?;
    if !out.success() {
        return Err(AppError::Process(format!(
            "could not terminate {}: {}",
            d.name,
            first_line(&decode_output(&out.stderr)).unwrap_or_default()
        )));
    }
    if let Ok(mut c) = DISTRO_CACHE.lock() {
        *c = None;
    }
    Ok(())
}

pub fn linux_home(distro: &str) -> AppResult<String> {
    let d = ensure_usable_distro(distro)?;
    let out = exec_script(&d.name, "sh", "printf %s \"$HOME\"", &[], Duration::from_secs(30))?;
    let home = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.success() || !home.starts_with('/') {
        return Err(AppError::Process("could not determine the Linux home directory".into()));
    }
    Ok(home)
}

/// Translates a Windows path to its Linux equivalent with the distribution's own `wslpath`.
pub fn to_linux_path(distro: &str, windows_path: &str) -> AppResult<String> {
    if windows_path.contains('\0') || windows_path.len() > 4096 || windows_path.starts_with('-') {
        return Err(AppError::InvalidInput("invalid path".into()));
    }
    let d = ensure_usable_distro(distro)?;
    let out = exec(&d.name, &["wslpath", "-a", "-u", "--", windows_path], Duration::from_secs(30))?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.success() || text.is_empty() {
        return Err(AppError::Process(format!(
            "wslpath could not translate the path: {}",
            first_line(&String::from_utf8_lossy(&out.stderr)).unwrap_or_default()
        )));
    }
    Ok(text)
}

fn first_line(s: &str) -> Option<String> {
    s.lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string)
}

// --------------------------------------------------------------------------
// Diagnostics
// --------------------------------------------------------------------------

/// The only programs the diagnostics command is allowed to probe.
const TOOLS: &[(&str, &str)] = &[
    ("python3", "Python 3"),
    ("pip3", "pip"),
    ("git", "Git"),
    ("gcc", "GCC"),
    ("g++", "G++"),
    ("make", "Make"),
    ("cmake", "CMake"),
    ("node", "Node.js"),
    ("npm", "npm"),
    ("docker", "Docker CLI"),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCheck {
    pub command: String,
    pub label: String,
    pub found: bool,
    pub version: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OsRelease {
    pub pretty_name: Option<String>,
    pub name: Option<String>,
    pub version_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub distro: String,
    pub uname: Option<String>,
    pub os_release: OsRelease,
    pub tools: Vec<ToolCheck>,
    pub errors: Vec<String>,
}

pub fn parse_os_release(text: &str) -> OsRelease {
    let mut r = OsRelease::default();
    for line in text.lines() {
        if let Some((k, v)) = line.split_once('=') {
            let v = v.trim().trim_matches('"').to_string();
            match k.trim() {
                "PRETTY_NAME" => r.pretty_name = Some(v),
                "NAME" => r.name = Some(v),
                "VERSION_ID" => r.version_id = Some(v),
                _ => {}
            }
        }
    }
    r
}

const TOOL_SCRIPT: &str = r#"if command -v "$1" >/dev/null 2>&1; then "$1" --version 2>&1 | head -n 1; else exit 127; fi"#;

fn check_tool(distro: &str, command: &str, label: &str) -> ToolCheck {
    // A login shell is used so PATH matches what an interactive terminal sees
    // (pyenv, nvm, ~/.local/bin, ...). `command` is from the fixed TOOLS table.
    let result = exec_script(distro, "bash", TOOL_SCRIPT, &[command], Duration::from_secs(30));
    match result {
        Ok(out) if out.success() => ToolCheck {
            command: command.into(),
            label: label.into(),
            found: true,
            version: first_line(&String::from_utf8_lossy(&out.stdout)),
            detail: None,
        },
        Ok(out) if out.code == Some(127) => ToolCheck {
            command: command.into(),
            label: label.into(),
            found: false,
            version: None,
            detail: Some("not found in PATH".into()),
        },
        Ok(out) => ToolCheck {
            command: command.into(),
            label: label.into(),
            found: false,
            version: None,
            detail: Some(if out.timed_out {
                "check timed out".to_string()
            } else {
                first_line(&decode_output(&out.stderr)).unwrap_or_else(|| format!("check failed (exit {:?})", out.code))
            }),
        },
        Err(e) => ToolCheck {
            command: command.into(),
            label: label.into(),
            found: false,
            version: None,
            detail: Some(e.to_string()),
        },
    }
}

pub fn diagnostics(distro: &str) -> AppResult<Diagnostics> {
    let d = ensure_usable_distro(distro)?;
    let name = d.name.clone();
    let mut errors = Vec::new();

    let (uname_res, os_res, tools) = std::thread::scope(|s| {
        let uname = s.spawn(|| exec(&name, &["uname", "-a"], Duration::from_secs(30)));
        let os = s.spawn(|| exec(&name, &["cat", "/etc/os-release"], Duration::from_secs(30)));
        let handles: Vec<_> = TOOLS
            .iter()
            .map(|(cmd, label)| {
                let n = &name;
                s.spawn(move || check_tool(n, cmd, label))
            })
            .collect();
        let tools: Vec<ToolCheck> = handles.into_iter().filter_map(|h| h.join().ok()).collect();
        (uname.join().ok(), os.join().ok(), tools)
    });

    let uname = match uname_res {
        Some(Ok(o)) if o.success() => first_line(&String::from_utf8_lossy(&o.stdout)),
        Some(Ok(o)) => {
            errors.push(format!("uname -a failed (exit {:?})", o.code));
            None
        }
        Some(Err(e)) => {
            errors.push(format!("uname -a: {e}"));
            None
        }
        None => None,
    };
    let os_release = match os_res {
        Some(Ok(o)) if o.success() => parse_os_release(&String::from_utf8_lossy(&o.stdout)),
        Some(Ok(_)) | Some(Err(_)) => {
            errors.push("could not read /etc/os-release".into());
            OsRelease::default()
        }
        None => OsRelease::default(),
    };

    Ok(Diagnostics {
        distro: name,
        uname,
        os_release,
        tools,
        errors,
    })
}

// --------------------------------------------------------------------------
// Session marker scanning (busy check + cleanup of a single terminal session)
// --------------------------------------------------------------------------

/// Variable forwarded into the Linux shell of each terminal via WSLENV.
pub const SESSION_ENV: &str = "RYCOS_SESSION";

const MARKER_SCRIPT: &str = r#"for f in $(grep -lsaF -- "RYCOS_SESSION=$1" /proc/[0-9]*/environ); do
  p=${f#/proc/}; p=${p%/environ}
  printf '%s ' "$p"
  sed -n -e 's/^Name:[[:space:]]*/N=/p' -e 's/^PPid:[[:space:]]*/P=/p' "/proc/$p/status" 2>/dev/null | tr '\n' ' '
  echo
done"#;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxProc {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
}

pub fn parse_marker_output(text: &str) -> Vec<LinuxProc> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let pid: u32 = parts.next()?.parse().ok()?;
            let mut name = None;
            let mut ppid = None;
            for p in parts {
                if let Some(n) = p.strip_prefix("N=") {
                    name = Some(n.to_string());
                } else if let Some(pp) = p.strip_prefix("P=") {
                    ppid = pp.parse().ok();
                }
            }
            Some(LinuxProc {
                pid,
                ppid: ppid?,
                name: name?,
            })
        })
        .collect()
}

fn is_relay_name(name: &str) -> bool {
    name == "init" || name.starts_with("Relay") || name == "wsl" || name == "wslhost" || name == "plan9"
}

/// Processes of one terminal session that are neither WSL relay helpers nor
/// the login shell itself, i.e. foreground or background jobs.
pub fn jobs_in_session(all: &[LinuxProc]) -> Vec<LinuxProc> {
    let real: Vec<&LinuxProc> = all.iter().filter(|p| !is_relay_name(&p.name)).collect();
    real.iter()
        .filter(|p| real.iter().any(|q| q.pid == p.ppid))
        .map(|p| (*p).clone())
        .collect()
}

pub fn session_processes(distro: &str, session_id: &str) -> AppResult<Vec<LinuxProc>> {
    validate_session_id(session_id)?;
    let out = exec_script(distro, "sh", MARKER_SCRIPT, &[session_id], Duration::from_secs(20))?;
    if out.timed_out || (!out.success() && out.stdout.is_empty()) {
        return Err(AppError::Process("could not inspect the distribution's processes".into()));
    }
    Ok(parse_marker_output(&String::from_utf8_lossy(&out.stdout)))
}

/// Sends SIGHUP to the processes that belong to exactly this terminal session
/// (identified by its private environment marker). Nothing else is touched.
pub fn hangup_session(distro: &str, session_id: &str) -> AppResult<usize> {
    let procs = session_processes(distro, session_id)?;
    let targets: Vec<String> = procs
        .iter()
        .filter(|p| !is_relay_name(&p.name))
        .map(|p| p.pid.to_string())
        .collect();
    if targets.is_empty() {
        return Ok(0);
    }
    let mut args: Vec<&str> = vec!["kill", "-HUP"];
    args.extend(targets.iter().map(String::as_str));
    let _ = exec(distro, &args, Duration::from_secs(10))?;
    Ok(targets.len())
}

pub fn validate_session_id(id: &str) -> AppResult<()> {
    let ok = id.len() == 36
        && id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
        && id.matches('-').count() == 4;
    if ok {
        Ok(())
    } else {
        Err(AppError::InvalidInput("invalid session id".into()))
    }
}

// --------------------------------------------------------------------------
// WSL-side metrics (used by the resource monitor)
// --------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WslMetrics {
    pub distro: String,
    pub load1: Option<f64>,
    pub load5: Option<f64>,
    pub load15: Option<f64>,
    pub mem_total_kb: Option<u64>,
    pub mem_available_kb: Option<u64>,
    pub uptime_secs: Option<f64>,
}

pub fn parse_metrics(distro: &str, text: &str) -> WslMetrics {
    let mut m = WslMetrics {
        distro: distro.to_string(),
        ..Default::default()
    };
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            m.mem_total_kb = rest.split_whitespace().next().and_then(|v| v.parse().ok());
        } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
            m.mem_available_kb = rest.split_whitespace().next().and_then(|v| v.parse().ok());
        } else if let Some(rest) = line.strip_prefix("LOAD ") {
            let v: Vec<f64> = rest.split_whitespace().filter_map(|x| x.parse().ok()).collect();
            m.load1 = v.first().copied();
            m.load5 = v.get(1).copied();
            m.load15 = v.get(2).copied();
        } else if let Some(rest) = line.strip_prefix("UP ") {
            m.uptime_secs = rest.split_whitespace().next().and_then(|v| v.parse().ok());
        }
    }
    m
}

const METRICS_SCRIPT: &str = r#"printf 'LOAD '; cat /proc/loadavg; printf 'UP '; cat /proc/uptime; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo"#;

/// Samples a distribution that is already running. Refuses to start a stopped
/// one, so monitoring can never wake a distribution up.
pub fn sample_metrics(distro: &str) -> AppResult<WslMetrics> {
    let d = ensure_usable_distro(distro)?;
    let running = running_distros()?;
    if !running.iter().any(|n| n.eq_ignore_ascii_case(&d.name)) {
        return Err(AppError::NotFound(format!("{} is not running", d.name)));
    }
    let out = exec_script(&d.name, "sh", METRICS_SCRIPT, &[], Duration::from_secs(15))?;
    if !out.success() {
        return Err(AppError::Process("could not read /proc metrics".into()));
    }
    Ok(parse_metrics(&d.name, &String::from_utf8_lossy(&out.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(s: &str, bom: bool) -> Vec<u8> {
        let mut v = Vec::new();
        if bom {
            v.extend_from_slice(&[0xFF, 0xFE]);
        }
        for u in s.encode_utf16() {
            v.extend_from_slice(&u.to_le_bytes());
        }
        v
    }

    const TABLE: &str = "  NAME              STATE           VERSION\r\n* Ubuntu-26.04      Running         2\r\n  docker-desktop    Stopped         2\r\n";

    #[test]
    fn decodes_utf16_with_and_without_bom() {
        assert_eq!(decode_output(&utf16(TABLE, true)), TABLE.replace('\r', ""));
        assert_eq!(decode_output(&utf16(TABLE, false)), TABLE.replace('\r', ""));
    }

    #[test]
    fn decodes_utf8_and_strips_bom() {
        assert_eq!(decode_output(TABLE.as_bytes()), TABLE.replace('\r', ""));
        let mut with_bom = vec![0xEF, 0xBB, 0xBF];
        with_bom.extend_from_slice(b"hello");
        assert_eq!(decode_output(&with_bom), "hello");
    }

    #[test]
    fn plain_ascii_is_not_mistaken_for_utf16() {
        assert_eq!(decode_output(b"ab"), "ab");
        assert_eq!(decode_output("héllo wörld".as_bytes()), "héllo wörld");
    }

    #[test]
    fn parses_distro_table() {
        let rows = parse_distro_table(&decode_output(TABLE.as_bytes()));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "Ubuntu-26.04");
        assert!(rows[0].is_default);
        assert_eq!(rows[0].state, "Running");
        assert_eq!(rows[0].version, 2);
        assert_eq!(rows[1].name, "docker-desktop");
        assert!(!rows[1].is_default);
    }

    #[test]
    fn parses_localized_header_and_state() {
        let fr = "  NOM               ÉTAT            VERSION\n* Debian            En cours d’exécution 2\n";
        // Multi-word localized state: the final token is the version; the name is
        // everything before the last two tokens, so it is rejected rather than misread.
        let rows = parse_distro_table(fr);
        assert!(rows.iter().all(|r| validate_distro_name(&r.name).is_ok()));
        let fr2 = "  NOM               ÉTAT            VERSION\n* Debian            Arrêté          2\n";
        let rows = parse_distro_table(fr2);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Debian");
        assert_eq!(rows[0].state, "Arrêté");
    }

    #[test]
    fn ignores_message_text() {
        let msg = "Windows Subsystem for Linux has no installed distributions.\nUse 'wsl.exe --list --online' to list.\n";
        assert!(parse_distro_table(msg).is_empty());
        assert!(parse_distro_table("").is_empty());
    }

    #[test]
    fn parses_name_list() {
        let names = parse_name_list("Ubuntu-26.04\nDebian\n");
        assert_eq!(names, vec!["Ubuntu-26.04", "Debian"]);
        // a localized sentence must not be mistaken for names
        assert!(parse_name_list("There are no running distributions.\n").iter().all(|n| validate_distro_name(n).is_ok()));
    }

    #[test]
    fn validates_distro_names() {
        assert!(validate_distro_name("Ubuntu-26.04").is_ok());
        assert!(validate_distro_name("my_distro 2").is_ok());
        assert!(validate_distro_name("").is_err());
        assert!(validate_distro_name("-d").is_err());
        assert!(validate_distro_name("--unregister").is_err());
        assert!(validate_distro_name("a;rm -rf /").is_err());
        assert!(validate_distro_name("a&b").is_err());
        assert!(validate_distro_name(&"a".repeat(65)).is_err());
        assert!(validate_distro_name("trailing ").is_err());
    }

    #[test]
    fn identifies_managed_distros() {
        assert!(is_managed("docker-desktop"));
        assert!(is_managed("Docker-Desktop-Data"));
        assert!(!is_managed("Ubuntu-26.04"));
    }

    #[test]
    fn parses_os_release() {
        let r = parse_os_release("PRETTY_NAME=\"Ubuntu 26.04 LTS\"\nNAME=\"Ubuntu\"\nVERSION_ID=\"26.04\"\n");
        assert_eq!(r.pretty_name.as_deref(), Some("Ubuntu 26.04 LTS"));
        assert_eq!(r.version_id.as_deref(), Some("26.04"));
    }

    #[test]
    fn parses_marker_output_and_finds_jobs() {
        let text = "10 N=init P=1 \n11 N=init P=10 \n12 N=bash P=11 \n40 N=python3 P=12 \n";
        let procs = parse_marker_output(text);
        assert_eq!(procs.len(), 4);
        let jobs = jobs_in_session(&procs);
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].name, "python3");
    }

    #[test]
    fn idle_shell_has_no_jobs() {
        let procs = parse_marker_output("10 N=init P=1 \n12 N=bash P=11 \n");
        assert!(jobs_in_session(&procs).is_empty());
    }

    #[test]
    fn validates_session_ids() {
        assert!(validate_session_id("123e4567-e89b-12d3-a456-426614174000").is_ok());
        assert!(validate_session_id("../etc/passwd").is_err());
        assert!(validate_session_id("123e4567-e89b-12d3-a456-42661417400;").is_err());
    }

    #[test]
    fn parses_metrics() {
        let m = parse_metrics(
            "U",
            "LOAD 0.10 0.20 0.30 1/200 999\nUP 123.45 400.0\nMemTotal:       8000000 kB\nMemAvailable:   4000000 kB\n",
        );
        assert_eq!(m.load5, Some(0.20));
        assert_eq!(m.uptime_secs, Some(123.45));
        assert_eq!(m.mem_total_kb, Some(8_000_000));
        assert_eq!(m.mem_available_kb, Some(4_000_000));
    }
}
