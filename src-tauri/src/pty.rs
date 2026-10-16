//! Interactive terminal sessions.
//!
//! Each session is one `wsl.exe` child attached to a Windows ConPTY (through
//! `portable-pty`). See docs/ARCHITECTURE.md for the lifecycle diagram.
//!
//! Threads per session:
//! * **reader**  - reads PTY output, applies flow control, hands bytes to the sink.
//! * **writer**  - drains a queue of input chunks into the PTY (so a stalled
//!                 child can never block a Tauri command).
//! * **waiter**  - waits for the child, lets trailing output drain, then closes
//!                 the pseudo console so the reader reaches EOF.
//!
//! Output flow control: the backend counts bytes it has delivered and the UI
//! acknowledges bytes xterm.js has actually processed. When more than
//! [`HIGH_WATERMARK`] bytes are unacknowledged the reader stops reading, the
//! ConPTY pipe fills, and the Linux process is back-pressured by the kernel.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::logging;
use crate::wsl;

/// Unacknowledged output bytes allowed in flight before the reader pauses.
pub const HIGH_WATERMARK: usize = 1024 * 1024;
/// Largest single paste/input chunk accepted.
pub const MAX_INPUT_CHUNK: usize = 1024 * 1024;
/// Largest amount of input waiting to be written to the PTY.
pub const MAX_QUEUED_INPUT: usize = 8 * 1024 * 1024;
const READ_BUF: usize = 32 * 1024;
const EXIT_GRACE: Duration = Duration::from_millis(120);
const EXIT_DRAIN_MAX: Duration = Duration::from_millis(1500);
const CLOSE_GRACE: Duration = Duration::from_secs(2);

#[derive(Debug)]
pub enum TerminalMsg {
    Output(Vec<u8>),
    Exit { code: Option<u32> },
}

/// Delivery callback; returns `false` when the receiver is gone.
pub type Sink = Arc<dyn Fn(TerminalMsg) -> bool + Send + Sync>;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

struct FlowState {
    pending: usize,
    released: bool,
}

struct Flow {
    state: Mutex<FlowState>,
    cv: Condvar,
}

impl Flow {
    fn new() -> Self {
        Self {
            state: Mutex::new(FlowState { pending: 0, released: false }),
            cv: Condvar::new(),
        }
    }
    fn add(&self, n: usize) {
        if let Ok(mut s) = self.state.lock() {
            s.pending += n;
        }
    }
    fn ack(&self, n: usize) {
        if let Ok(mut s) = self.state.lock() {
            s.pending = s.pending.saturating_sub(n);
            self.cv.notify_all();
        }
    }
    fn release(&self) {
        if let Ok(mut s) = self.state.lock() {
            s.released = true;
            self.cv.notify_all();
        }
    }
    fn pending(&self) -> usize {
        self.state.lock().map(|s| s.pending).unwrap_or(0)
    }
    fn wait_below(&self, high: usize) {
        if let Ok(mut s) = self.state.lock() {
            while s.pending > high && !s.released {
                match self.cv.wait(s) {
                    Ok(g) => s = g,
                    Err(_) => return,
                }
            }
        }
    }
}

pub struct Session {
    pub id: String,
    pub distro: String,
    pub cwd: String,
    pub pid: Option<u32>,
    pub started_ms: u64,
    flow: Flow,
    writer_tx: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    queued: AtomicUsize,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    process_exited: AtomicBool,
    exit_code: Mutex<Option<u32>>,
    closing: AtomicBool,
    last_output: AtomicU64,
    epoch: Instant,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub distro: String,
    pub cwd: String,
    pub pid: Option<u32>,
    pub started_ms: u64,
    pub exited: bool,
    pub exit_code: Option<u32>,
    pub unacked_bytes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusyInfo {
    /// True when at least one job (foreground or background) runs besides the shell.
    pub busy: bool,
    /// True when the check could not be completed; callers should treat this as "maybe busy".
    pub unknown: bool,
    pub jobs: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct OpenParams {
    pub id: String,
    pub distro: String,
    /// Value for `wsl.exe --cd`: `~`, a Linux absolute path or a Windows path.
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    starting: Mutex<HashSet<String>>,
}

fn clamp_size(cols: u16, rows: u16) -> AppResult<PtySize> {
    if cols == 0 || rows == 0 || cols > 1000 || rows > 1000 {
        return Err(AppError::InvalidInput("terminal size must be between 1x1 and 1000x1000".into()));
    }
    Ok(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
}

fn validate_cwd(cwd: &str) -> AppResult<()> {
    if cwd.is_empty() || cwd.len() > 4096 || cwd.chars().any(|c| c.is_control()) || cwd.starts_with('-') {
        return Err(AppError::InvalidInput("invalid working directory".into()));
    }
    Ok(())
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open(&self, p: OpenParams, sink: Sink) -> AppResult<SessionSummary> {
        wsl::validate_session_id(&p.id)?;
        wsl::validate_distro_name(&p.distro)?;
        validate_cwd(&p.cwd)?;
        let size = clamp_size(p.cols, p.rows)?;

        // Reserve the id first so repeated clicks cannot start two sessions.
        {
            let sessions = self.sessions.lock().map_err(|_| AppError::Pty("session table poisoned".into()))?;
            let mut starting = self.starting.lock().map_err(|_| AppError::Pty("session table poisoned".into()))?;
            if sessions.contains_key(&p.id) || !starting.insert(p.id.clone()) {
                return Err(AppError::SessionExists);
            }
        }
        let result = self.spawn(&p, size, sink);
        if let Ok(mut starting) = self.starting.lock() {
            starting.remove(&p.id);
        }
        let session = result?;
        let summary = summarize(&session);
        self.sessions
            .lock()
            .map_err(|_| AppError::Pty("session table poisoned".into()))?
            .insert(p.id.clone(), session);
        Ok(summary)
    }

    fn spawn(&self, p: &OpenParams, size: PtySize, sink: Sink) -> AppResult<Arc<Session>> {
        let pty = native_pty_system();
        let pair = pty
            .openpty(size)
            .map_err(|e| AppError::Pty(format!("could not create a pseudo console: {e:#}")))?;

        let mut cmd = CommandBuilder::new(wsl::wsl_exe());
        cmd.args(["-d", p.distro.as_str(), "--cd", p.cwd.as_str()]);
        // A private marker lets us find (and only find) this session's Linux processes.
        cmd.env(wsl::SESSION_ENV, &p.id);
        cmd.env("COLORTERM", "truecolor");
        let existing = std::env::var("WSLENV").unwrap_or_default();
        let forwarded = format!("{}:COLORTERM", wsl::SESSION_ENV);
        cmd.env("WSLENV", if existing.is_empty() { forwarded } else { format!("{existing}:{forwarded}") });

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Pty(format!("could not start wsl.exe: {e:#}")))?;
        drop(pair.slave);

        let killer = child.clone_killer();
        let pid = child.process_id();
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Pty(format!("could not attach to terminal output: {e:#}")))?;
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Pty(format!("could not attach to terminal input: {e:#}")))?;

        let (writer_tx, writer_rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();

        let session = Arc::new(Session {
            id: p.id.clone(),
            distro: p.distro.clone(),
            cwd: p.cwd.clone(),
            pid,
            started_ms: now_ms(),
            flow: Flow::new(),
            writer_tx: Mutex::new(Some(writer_tx)),
            queued: AtomicUsize::new(0),
            master: Mutex::new(Some(pair.master)),
            killer: Mutex::new(killer),
            process_exited: AtomicBool::new(false),
            exit_code: Mutex::new(None),
            closing: AtomicBool::new(false),
            last_output: AtomicU64::new(0),
            epoch: Instant::now(),
        });

        let short = &p.id[..8];

        // writer
        {
            let s = session.clone();
            thread::Builder::new()
                .name(format!("pty-writer-{short}"))
                .spawn(move || {
                    while let Ok(chunk) = writer_rx.recv() {
                        let n = chunk.len();
                        let res = writer.write_all(&chunk).and_then(|_| writer.flush());
                        s.queued.fetch_sub(n, Ordering::Relaxed);
                        if res.is_err() {
                            break;
                        }
                    }
                })
                .map_err(|e| AppError::Pty(format!("could not start writer thread: {e}")))?;
        }

        // reader
        {
            let s = session.clone();
            let sink = sink.clone();
            thread::Builder::new()
                .name(format!("pty-reader-{short}"))
                .spawn(move || {
                    let mut buf = vec![0u8; READ_BUF];
                    loop {
                        s.flow.wait_below(HIGH_WATERMARK);
                        match reader.read(&mut buf) {
                            Ok(0) => break,
                            Ok(n) => {
                                s.last_output.store(s.epoch.elapsed().as_millis() as u64, Ordering::Relaxed);
                                s.flow.add(n);
                                if !sink(TerminalMsg::Output(buf[..n].to_vec())) {
                                    // The UI is gone; stop the child instead of buffering forever.
                                    if let Ok(mut k) = s.killer.lock() {
                                        let _ = k.kill();
                                    }
                                    break;
                                }
                            }
                            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                            Err(_) => break,
                        }
                    }
                    let code = exit_rx.recv_timeout(Duration::from_secs(5)).ok().flatten();
                    let _ = sink(TerminalMsg::Exit { code });
                })
                .map_err(|e| AppError::Pty(format!("could not start reader thread: {e}")))?;
        }

        // waiter
        {
            let s = session.clone();
            thread::Builder::new()
                .name(format!("pty-waiter-{short}"))
                .spawn(move || {
                    let code = child.wait().ok().map(|st| st.exit_code());
                    if let Ok(mut c) = s.exit_code.lock() {
                        *c = code;
                    }
                    s.process_exited.store(true, Ordering::SeqCst);
                    // Let the reader drain whatever the child printed last, without
                    // waiting for UI acknowledgements.
                    s.flow.release();
                    let waited = Instant::now();
                    thread::sleep(EXIT_GRACE);
                    loop {
                        let idle_ms = (s.epoch.elapsed().as_millis() as u64).saturating_sub(s.last_output.load(Ordering::Relaxed));
                        if idle_ms >= EXIT_GRACE.as_millis() as u64 || waited.elapsed() >= EXIT_DRAIN_MAX {
                            break;
                        }
                        thread::sleep(Duration::from_millis(20));
                    }
                    let _ = exit_tx.send(code);
                    if let Ok(mut tx) = s.writer_tx.lock() {
                        tx.take();
                    }
                    // Dropping the master closes the pseudo console, which ends the reader.
                    if let Ok(mut m) = s.master.lock() {
                        m.take();
                    }
                })
                .map_err(|e| AppError::Pty(format!("could not start waiter thread: {e}")))?;
        }

        logging::info("pty", &format!("opened session {short} in {} (wsl.exe pid {:?})", p.distro, pid));
        Ok(session)
    }

    fn get(&self, id: &str) -> AppResult<Arc<Session>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::Pty("session table poisoned".into()))?
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::SessionNotFound(id.to_string()))
    }

    pub fn write(&self, id: &str, data: Vec<u8>) -> AppResult<()> {
        if data.len() > MAX_INPUT_CHUNK {
            return Err(AppError::InvalidInput("input chunk is too large".into()));
        }
        let s = self.get(id)?;
        if s.queued.load(Ordering::Relaxed) + data.len() > MAX_QUEUED_INPUT {
            return Err(AppError::Pty("the terminal is not accepting input fast enough; try again in a moment".into()));
        }
        let tx = s.writer_tx.lock().map_err(|_| AppError::Pty("input lock poisoned".into()))?;
        let Some(tx) = tx.as_ref() else {
            return Err(AppError::Pty("the terminal session has ended".into()));
        };
        s.queued.fetch_add(data.len(), Ordering::Relaxed);
        tx.send(data).map_err(|_| AppError::Pty("the terminal session has ended".into()))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let size = clamp_size(cols, rows)?;
        let s = self.get(id)?;
        let master = s.master.lock().map_err(|_| AppError::Pty("master lock poisoned".into()))?;
        match master.as_ref() {
            Some(m) => m.resize(size).map_err(|e| AppError::Pty(format!("resize failed: {e:#}"))),
            None => Ok(()), // already exited
        }
    }

    pub fn ack(&self, id: &str, bytes: usize) -> AppResult<()> {
        self.get(id)?.flow.ack(bytes);
        Ok(())
    }

    pub fn list(&self) -> Vec<SessionSummary> {
        let mut v: Vec<SessionSummary> = self
            .sessions
            .lock()
            .map(|m| m.values().map(|s| summarize(s)).collect())
            .unwrap_or_default();
        v.sort_by_key(|s| s.started_ms);
        v
    }

    pub fn count(&self) -> usize {
        self.sessions.lock().map(|m| m.len()).unwrap_or(0)
    }

    pub fn active_count(&self) -> usize {
        self.sessions
            .lock()
            .map(|m| m.values().filter(|s| !s.process_exited.load(Ordering::SeqCst)).count())
            .unwrap_or(0)
    }

    /// Reports whether the session has jobs other than the login shell.
    /// This is an inspection only; it never signals anything.
    pub fn busy_check(&self, id: &str) -> AppResult<BusyInfo> {
        let s = self.get(id)?;
        if s.process_exited.load(Ordering::SeqCst) {
            return Ok(BusyInfo { busy: false, unknown: false, jobs: vec![] });
        }
        match wsl::session_processes(&s.distro, &s.id) {
            Ok(procs) => {
                let jobs = wsl::jobs_in_session(&procs);
                Ok(BusyInfo {
                    busy: !jobs.is_empty(),
                    unknown: false,
                    jobs: jobs.into_iter().map(|j| j.name).collect(),
                })
            }
            Err(e) => {
                logging::warn("pty", &format!("busy check failed for {}: {e}", &s.id[..8]));
                Ok(BusyInfo { busy: false, unknown: true, jobs: vec![] })
            }
        }
    }

    /// Ends one session and releases everything it owns. Other sessions and
    /// unrelated WSL processes are never touched.
    pub fn close(&self, id: &str) -> AppResult<()> {
        let s = self
            .sessions
            .lock()
            .map_err(|_| AppError::Pty("session table poisoned".into()))?
            .remove(id)
            .ok_or_else(|| AppError::SessionNotFound(id.to_string()))?;
        close_session(&s);
        Ok(())
    }

    /// Closes every session (application exit). Runs in parallel with an overall bound.
    pub fn shutdown_all(&self) {
        let all: Vec<Arc<Session>> = match self.sessions.lock() {
            Ok(mut m) => m.drain().map(|(_, s)| s).collect(),
            Err(_) => return,
        };
        if all.is_empty() {
            return;
        }
        let handles: Vec<_> = all
            .into_iter()
            .map(|s| thread::spawn(move || close_session(&s)))
            .collect();
        let deadline = Instant::now() + Duration::from_secs(5);
        for h in handles {
            while !h.is_finished() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

fn summarize(s: &Session) -> SessionSummary {
    SessionSummary {
        id: s.id.clone(),
        distro: s.distro.clone(),
        cwd: s.cwd.clone(),
        pid: s.pid,
        started_ms: s.started_ms,
        exited: s.process_exited.load(Ordering::SeqCst),
        exit_code: s.exit_code.lock().ok().and_then(|c| *c),
        unacked_bytes: s.flow.pending(),
    }
}

fn close_session(s: &Arc<Session>) {
    s.closing.store(true, Ordering::SeqCst);
    s.flow.release();
    if let Ok(mut tx) = s.writer_tx.lock() {
        tx.take();
    }
    // Closing the pseudo console makes conhost end wsl.exe the same way closing a
    // Windows Terminal tab does, which in turn hangs up the Linux shell.
    if let Ok(mut m) = s.master.lock() {
        m.take();
    }
    let deadline = Instant::now() + CLOSE_GRACE;
    while !s.process_exited.load(Ordering::SeqCst) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    if !s.process_exited.load(Ordering::SeqCst) {
        if let Ok(mut k) = s.killer.lock() {
            let _ = k.kill(); // only our own wsl.exe child
        }
    }
    logging::info("pty", &format!("closed session {}", &s.id[..8]));

    // Safety net for stragglers: hang up any Linux process still carrying this
    // session's private marker. Skipped when the distribution already stopped, so
    // closing a terminal can never wake WSL up.
    let distro = s.distro.clone();
    let id = s.id.clone();
    thread::spawn(move || {
        let running = wsl::running_distros().unwrap_or_default();
        if running.iter().any(|n| n.eq_ignore_ascii_case(&distro)) {
            match wsl::hangup_session(&distro, &id) {
                Ok(0) => {}
                Ok(n) => logging::warn("pty", &format!("hung up {n} leftover process(es) of session {}", &id[..8])),
                Err(e) => logging::warn("pty", &format!("cleanup scan failed for {}: {e}", &id[..8])),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flow_blocks_until_acked() {
        let flow = Arc::new(Flow::new());
        flow.add(100);
        let f2 = flow.clone();
        let t = thread::spawn(move || {
            f2.wait_below(10);
            true
        });
        thread::sleep(Duration::from_millis(50));
        assert!(!t.is_finished());
        flow.ack(95);
        assert!(t.join().unwrap());
    }

    #[test]
    fn flow_release_unblocks() {
        let flow = Arc::new(Flow::new());
        flow.add(1_000_000);
        let f2 = flow.clone();
        let t = thread::spawn(move || f2.wait_below(1));
        thread::sleep(Duration::from_millis(30));
        flow.release();
        t.join().unwrap();
    }

    #[test]
    fn ack_never_underflows() {
        let flow = Flow::new();
        flow.add(5);
        flow.ack(50);
        assert_eq!(flow.pending(), 0);
    }

    #[test]
    fn size_validation() {
        assert!(clamp_size(80, 24).is_ok());
        assert!(clamp_size(0, 24).is_err());
        assert!(clamp_size(80, 0).is_err());
        assert!(clamp_size(5000, 24).is_err());
    }

    #[test]
    fn cwd_validation() {
        assert!(validate_cwd("~").is_ok());
        assert!(validate_cwd("/home/a b/c").is_ok());
        assert!(validate_cwd("C:\\Users\\x").is_ok());
        assert!(validate_cwd("").is_err());
        assert!(validate_cwd("-x").is_err());
        assert!(validate_cwd("a\nb").is_err());
    }

    #[test]
    fn rejects_bad_open_params_before_spawning() {
        let m = SessionManager::new();
        let sink: Sink = Arc::new(|_| true);
        let bad = |id: &str, distro: &str, cwd: &str| OpenParams {
            id: id.into(),
            distro: distro.into(),
            cwd: cwd.into(),
            cols: 80,
            rows: 24,
        };
        let good_id = "123e4567-e89b-12d3-a456-426614174000";
        assert!(m.open(bad("nope", "Ubuntu", "~"), sink.clone()).is_err());
        assert!(m.open(bad(good_id, "--unregister", "~"), sink.clone()).is_err());
        assert!(m.open(bad(good_id, "Ubuntu", "-x"), sink.clone()).is_err());
        assert_eq!(m.count(), 0);
    }

    #[test]
    fn unknown_sessions_error_cleanly() {
        let m = SessionManager::new();
        assert!(matches!(m.write("x", vec![1]), Err(AppError::SessionNotFound(_))));
        assert!(matches!(m.close("x"), Err(AppError::SessionNotFound(_))));
        assert!(matches!(m.resize("x", 80, 24), Err(AppError::SessionNotFound(_))));
    }
}
