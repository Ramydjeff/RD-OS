//! Integration tests that drive the real PTY layer against a real WSL
//! distribution. Nothing is simulated: bytes go through ConPTY and wsl.exe into
//! a Linux shell, and the assertions read what that shell actually printed.
//!
//! The tests skip themselves (and say so) when WSL or a usable distribution is
//! not available, or when RYCOS_SKIP_WSL_TESTS=1. Set RYCOS_TEST_DISTRO to pick
//! a specific distribution. They only create and close their own sessions; they
//! never start, stop or modify a distribution.

use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::{Duration, Instant};

use rycos_lib::pty::{OpenParams, SessionManager, Sink, TerminalMsg};
use rycos_lib::wsl;

fn distro() -> Option<String> {
    if std::env::var("RYCOS_SKIP_WSL_TESTS").map(|v| v == "1").unwrap_or(false) {
        eprintln!("skipping: RYCOS_SKIP_WSL_TESTS=1");
        return None;
    }
    if let Ok(d) = std::env::var("RYCOS_TEST_DISTRO") {
        return Some(d);
    }
    let status = wsl::detect();
    if !status.available {
        eprintln!("skipping: WSL is not available");
        return None;
    }
    let usable: Vec<_> = status.distros.iter().filter(|d| !d.managed).collect();
    usable
        .iter()
        .find(|d| d.running)
        .or_else(|| usable.iter().find(|d| d.is_default))
        .or_else(|| usable.first())
        .map(|d| d.name.clone())
        .or_else(|| {
            eprintln!("skipping: no usable distribution");
            None
        })
}

struct Term {
    m: Arc<SessionManager>,
    id: String,
    buf: Arc<Mutex<Vec<u8>>>,
    exit: Arc<Mutex<Option<Option<u32>>>>,
    acked: usize,
}

fn new_id() -> String {
    // Version-4 shaped id; the backend only checks the shape.
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let c = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let h = format!("{:016x}{:016x}", n as u64, c ^ (n >> 64) as u64);
    format!("{}-{}-4{}-a{}-{}", &h[0..8], &h[8..12], &h[13..16], &h[17..20], &h[20..32])
}

impl Term {
    fn open_with(m: &Arc<SessionManager>, distro: &str, cwd: &str, cols: u16, rows: u16) -> Result<Term, String> {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let exit = Arc::new(Mutex::new(None));
        let (b, e) = (buf.clone(), exit.clone());
        let sink: Sink = Arc::new(move |msg| {
            match msg {
                TerminalMsg::Output(bytes) => b.lock().unwrap().extend_from_slice(&bytes),
                TerminalMsg::Exit { code } => *e.lock().unwrap() = Some(code),
            }
            true
        });
        let id = new_id();
        m.open(
            OpenParams { id: id.clone(), distro: distro.into(), cwd: cwd.into(), cols, rows },
            sink,
        )
        .map_err(|e| e.to_string())?;
        Ok(Term { m: m.clone(), id, buf, exit, acked: 0 })
    }

    fn open(m: &Arc<SessionManager>, distro: &str) -> Term {
        let mut t = Term::open_with(m, distro, "~", 100, 30).expect("open terminal");
        // Wait for the first prompt so later input is not swallowed by startup.
        t.send("echo READY_$((20+22))\n");
        assert!(t.wait_for("READY_42", Duration::from_secs(30)), "shell never became ready:\n{}", t.text());
        t
    }

    fn send(&self, s: &str) {
        self.m.write(&self.id, s.as_bytes().to_vec()).expect("write to terminal");
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.buf.lock().unwrap()).into_owned()
    }

    fn ack_all(&mut self) {
        let total = self.buf.lock().unwrap().len();
        if total > self.acked {
            let _ = self.m.ack(&self.id, total - self.acked);
            self.acked = total;
        }
    }

    fn wait_for(&mut self, needle: &str, timeout: Duration) -> bool {
        let end = Instant::now() + timeout;
        while Instant::now() < end {
            self.ack_all();
            if self.text().contains(needle) {
                return true;
            }
            sleep(Duration::from_millis(25));
        }
        false
    }

    fn wait_exit(&mut self, timeout: Duration) -> Option<Option<u32>> {
        let end = Instant::now() + timeout;
        while Instant::now() < end {
            self.ack_all();
            if let Some(c) = *self.exit.lock().unwrap() {
                return Some(c);
            }
            sleep(Duration::from_millis(25));
        }
        None
    }

    fn lines(&self) -> Vec<String> {
        self.text().replace('\r', "").lines().map(|l| l.trim().to_string()).collect()
    }
}

fn manager() -> Arc<SessionManager> {
    Arc::new(SessionManager::new())
}

#[test]
fn at001_detection_sees_all_distributions_and_changes_nothing() {
    if distro().is_none() {
        return;
    }
    let before = wsl::detect();
    let after = wsl::detect();
    assert!(before.available, "{:?}", before.problem);
    assert!(!before.distros.is_empty());
    for (a, b) in before.distros.iter().zip(after.distros.iter()) {
        assert_eq!(a.name, b.name);
        assert_eq!(a.running, b.running, "detecting must not start or stop {}", a.name);
    }
    if let Some(docker) = before.distros.iter().find(|d| d.name == "docker-desktop") {
        assert!(docker.managed, "docker-desktop must be flagged as managed");
        assert!(wsl::ensure_usable_distro("docker-desktop").is_err(), "managed distros must not be usable");
    }
}

#[test]
fn at003_python_version_comes_from_the_real_distribution() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut t = Term::open(&m, &d);
    t.send("python3 --version\n");
    assert!(t.wait_for("Python 3.", Duration::from_secs(20)), "no python output:\n{}", t.text());

    // Independent ground truth straight from wsl.exe.
    let direct = wsl::exec(&d, &["python3", "--version"], Duration::from_secs(30)).unwrap();
    let expected = String::from_utf8_lossy(&direct.stdout).trim().to_string();
    assert!(expected.starts_with("Python 3."), "{expected}");
    assert!(t.text().contains(&expected), "terminal output should contain '{expected}':\n{}", t.text());
    m.close(&t.id).unwrap();
}

#[test]
fn at004_script_output_streams_while_running() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut t = Term::open(&m, &d);
    t.send("python3 -c \"import time\nfor i in range(5):\n    print('TICK', i, flush=True)\n    time.sleep(0.4)\nprint('SCRIPT_DONE_' + str(6*7))\"\n");
    let start = Instant::now();
    assert!(t.wait_for("TICK 0", Duration::from_secs(20)), "{}", t.text());
    let first = start.elapsed();
    assert!(t.wait_for("SCRIPT_DONE_42", Duration::from_secs(30)), "{}", t.text());
    let last = start.elapsed();
    assert!(
        last > first + Duration::from_millis(1200),
        "output arrived in one batch (first {first:?}, last {last:?}) instead of streaming"
    );
    m.close(&t.id).unwrap();
}

#[test]
fn at005_ctrl_c_interrupts_only_the_foreground_process() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut t = Term::open(&m, &d);
    t.send("sleep 90\n");
    sleep(Duration::from_millis(800));
    let started = Instant::now();
    t.send("\x03");
    t.send("echo INTERRUPTED_$((6*7))\n");
    assert!(t.wait_for("INTERRUPTED_42", Duration::from_secs(15)), "Ctrl+C did not interrupt sleep:\n{}", t.text());
    assert!(started.elapsed() < Duration::from_secs(15));
    // The shell survived and the session is still alive.
    assert!(t.exit.lock().unwrap().is_none(), "session ended after Ctrl+C");
    m.close(&t.id).unwrap();
}

#[test]
fn at005_ctrl_d_ends_the_shell_with_status_zero() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut t = Term::open(&m, &d);
    t.send("\x04");
    assert_eq!(t.wait_exit(Duration::from_secs(15)), Some(Some(0)));
    m.close(&t.id).unwrap();
}

#[test]
fn exit_status_is_reported() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut t = Term::open(&m, &d);
    t.send("exit 3\n");
    assert_eq!(t.wait_exit(Duration::from_secs(15)), Some(Some(3)), "{}", t.text());
    m.close(&t.id).unwrap();
}

#[test]
fn at006_resize_reaches_the_pty() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut t = Term::open(&m, &d);
    t.send("stty size\n");
    assert!(t.wait_for("30 100", Duration::from_secs(10)), "{}", t.text());
    m.resize(&t.id, 132, 41).unwrap();
    sleep(Duration::from_millis(300));
    t.send("stty size\n");
    assert!(t.wait_for("41 132", Duration::from_secs(10)), "{}", t.text());
    m.close(&t.id).unwrap();
}

#[test]
fn at006_unicode_ansi_tab_completion_and_history() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut t = Term::open(&m, &d);

    // UTF-8 in both directions.
    t.send("echo 'h\u{e9}llo \u{2713} \u{65e5}\u{672c}\u{8a9e} \u{1f600}'\n");
    assert!(t.wait_for("h\u{e9}llo \u{2713} \u{65e5}\u{672c}\u{8a9e} \u{1f600}", Duration::from_secs(10)), "{}", t.text());

    // ANSI escape sequences pass through untouched for xterm.js to render.
    t.send("printf '\\033[31mRED\\033[0m_%s\\n' $((6*7))\n");
    assert!(t.wait_for("\u{1b}[31mRED", Duration::from_secs(10)), "{}", t.text());
    assert!(t.wait_for("_42", Duration::from_secs(10)));

    // Tab completion: a unique prefix completes to the full file name.
    t.send("touch /tmp/rycos_tab_unique_file_xyz\n");
    sleep(Duration::from_millis(400));
    t.send("echo /tmp/rycos_tab_uni\t");
    sleep(Duration::from_millis(700));
    t.send("\n");
    assert!(
        { t.wait_for("rycos_tab_unique_file_xyz", Duration::from_secs(10)); true }
    );
    sleep(Duration::from_millis(500));
    t.ack_all();
    assert!(
        t.lines().iter().any(|l| l == "/tmp/rycos_tab_unique_file_xyz"),
        "tab completion did not complete the path:\n{}",
        t.text()
    );
    t.send("rm -f /tmp/rycos_tab_unique_file_xyz\n");

    // Up-arrow recalls the previous command.
    t.send("echo HIST_$((3*3))\n");
    assert!(t.wait_for("HIST_9", Duration::from_secs(10)));
    t.send("\u{1b}[A\n");
    sleep(Duration::from_millis(800));
    t.ack_all();
    assert!(t.lines().iter().filter(|l| *l == "HIST_9").count() >= 2, "history recall failed:\n{}", t.text());
    m.close(&t.id).unwrap();
}

#[test]
fn at007_sessions_are_independent() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut a = Term::open(&m, &d);
    let mut b = Term::open(&m, &d);
    a.send("export RYCOS_T=alpha; cd /tmp\n");
    sleep(Duration::from_millis(300));
    b.send("echo VAL_[${RYCOS_T:-unset}]_$PWD\n");
    assert!(b.wait_for("VAL_[unset]_", Duration::from_secs(10)), "{}", b.text());
    assert!(!b.text().contains("VAL_[alpha]"));
    a.send("echo VAL_[$RYCOS_T]_$PWD\n");
    assert!(a.wait_for("VAL_[alpha]_/tmp", Duration::from_secs(10)), "{}", a.text());
    // Closing one leaves the other fully usable.
    m.close(&a.id).unwrap();
    b.send("echo STILL_$((40+2))\n");
    assert!(b.wait_for("STILL_42", Duration::from_secs(10)), "{}", b.text());
    m.close(&b.id).unwrap();
}

#[test]
fn at009_close_releases_owned_resources_without_touching_other_sessions() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut a = Term::open(&m, &d);
    let mut b = Term::open(&m, &d);
    a.send("sleep 300 &\n");
    b.send("sleep 301 &\n");
    sleep(Duration::from_millis(800));

    let a_before = wsl::session_processes(&d, &a.id).unwrap();
    let b_before = wsl::session_processes(&d, &b.id).unwrap();
    assert!(a_before.iter().any(|p| p.name == "sleep"), "A's background job not found: {a_before:?}");
    assert!(b_before.iter().any(|p| p.name == "sleep"), "B's background job not found: {b_before:?}");

    let pid_a = m.list().into_iter().find(|s| s.id == a.id).and_then(|s| s.pid);
    m.close(&a.id).unwrap();

    // A's Linux processes disappear (hung up with the shell or reaped by the marker sweep).
    let end = Instant::now() + Duration::from_secs(20);
    let mut a_after = wsl::session_processes(&d, &a.id).unwrap();
    while !a_after.is_empty() && Instant::now() < end {
        sleep(Duration::from_millis(500));
        a_after = wsl::session_processes(&d, &a.id).unwrap();
    }
    assert!(a_after.is_empty(), "session A left processes behind: {a_after:?}");

    // A's Windows-side wsl.exe is gone.
    if let Some(pid) = pid_a {
        let out = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(!text.contains("wsl.exe"), "wsl.exe pid {pid} still alive: {text}");
    }

    // B is untouched: its job still runs and its shell still answers.
    let b_after = wsl::session_processes(&d, &b.id).unwrap();
    assert!(b_after.iter().any(|p| p.name == "sleep"), "B's job was affected: {b_after:?}");
    b.send("echo B_ALIVE_$((40+2))\n");
    assert!(b.wait_for("B_ALIVE_42", Duration::from_secs(10)), "{}", b.text());
    assert_eq!(m.count(), 1);

    m.close(&b.id).unwrap();
    let end = Instant::now() + Duration::from_secs(20);
    let mut b_final = wsl::session_processes(&d, &b.id).unwrap();
    while !b_final.is_empty() && Instant::now() < end {
        sleep(Duration::from_millis(500));
        b_final = wsl::session_processes(&d, &b.id).unwrap();
    }
    assert!(b_final.is_empty(), "session B left processes behind: {b_final:?}");
}

#[test]
fn busy_check_reports_running_jobs() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut t = Term::open(&m, &d);
    let idle = m.busy_check(&t.id).unwrap();
    assert!(!idle.busy && !idle.unknown, "idle shell reported busy: {idle:?}");

    t.send("sleep 120\n");
    sleep(Duration::from_millis(800));
    let busy = m.busy_check(&t.id).unwrap();
    assert!(busy.busy, "running sleep not detected: {busy:?}");
    assert!(busy.jobs.iter().any(|j| j == "sleep"), "{busy:?}");

    t.send("\x03");
    sleep(Duration::from_millis(800));
    let again = m.busy_check(&t.id).unwrap();
    assert!(!again.busy, "still busy after Ctrl+C: {again:?}");
    m.close(&t.id).unwrap();
}

#[test]
fn backpressure_pauses_output_until_the_ui_acknowledges() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut t = Term::open(&m, &d);
    t.ack_all();
    let baseline = t.buf.lock().unwrap().len();
    // ~19 MB of output that nobody acknowledges.
    t.send("yes 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' | head -n 250000; echo FLOOD_END_$((6*7))\n");
    sleep(Duration::from_secs(3));
    let first = t.buf.lock().unwrap().len();
    sleep(Duration::from_millis(700));
    let second = t.buf.lock().unwrap().len();
    let delivered = first - baseline;
    assert!(delivered > 100_000, "flood never started ({delivered} bytes)");
    assert!(
        delivered < 4 * 1024 * 1024,
        "reader ignored the watermark: {delivered} bytes delivered without any acknowledgement"
    );
    assert_eq!(first, second, "output kept flowing while unacknowledged");

    // Acknowledge as a UI would and the flood completes.
    assert!(t.wait_for("FLOOD_END_42", Duration::from_secs(90)), "flood did not finish after acks");
    m.close(&t.id).unwrap();
}

#[test]
fn duplicate_session_ids_are_rejected() {
    let Some(d) = distro() else { return };
    let m = manager();
    let t = Term::open(&m, &d);
    let sink: Sink = Arc::new(|_| true);
    let err = m
        .open(OpenParams { id: t.id.clone(), distro: d.clone(), cwd: "~".into(), cols: 80, rows: 24 }, sink)
        .unwrap_err();
    assert_eq!(err.kind(), "session_exists");
    m.close(&t.id).unwrap();
}

#[test]
fn bad_working_directory_ends_with_a_visible_error() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut t = Term::open_with(&m, &d, "/definitely/not/a/real/dir", 100, 30).unwrap();
    let code = t.wait_exit(Duration::from_secs(30));
    assert!(matches!(code, Some(Some(c)) if c != 0), "expected a non-zero exit, got {code:?}\n{}", t.text());
    assert!(!t.text().trim().is_empty(), "the user would see nothing at all");
    m.close(&t.id).unwrap();
}

#[test]
fn working_directory_is_honoured_for_linux_and_windows_paths() {
    let Some(d) = distro() else { return };
    let m = manager();
    let mut linux = Term::open_with(&m, &d, "/tmp", 100, 30).unwrap();
    linux.send("echo CWD_[$PWD]\n");
    assert!(linux.wait_for("CWD_[/tmp]", Duration::from_secs(30)), "{}", linux.text());

    let mut windows = Term::open_with(&m, &d, "C:\\Windows", 100, 30).unwrap();
    windows.send("echo CWD_[$PWD]\n");
    assert!(windows.wait_for("CWD_[/mnt/c/Windows]", Duration::from_secs(30)), "{}", windows.text());
    m.close(&linux.id).unwrap();
    m.close(&windows.id).unwrap();
}

#[test]
fn shutdown_all_closes_every_session() {
    let Some(d) = distro() else { return };
    let m = manager();
    let a = Term::open(&m, &d);
    let b = Term::open(&m, &d);
    assert_eq!(m.count(), 2);
    m.shutdown_all();
    assert_eq!(m.count(), 0);
    let end = Instant::now() + Duration::from_secs(20);
    loop {
        let left = wsl::session_processes(&d, &a.id).unwrap().len() + wsl::session_processes(&d, &b.id).unwrap().len();
        if left == 0 {
            break;
        }
        assert!(Instant::now() < end, "processes survived shutdown_all");
        sleep(Duration::from_millis(500));
    }
}

#[test]
fn wslpath_translates_windows_paths_with_spaces() {
    let Some(d) = distro() else { return };
    let p = wsl::to_linux_path(&d, "C:\\Program Files\\Common Files").unwrap();
    assert_eq!(p, "/mnt/c/Program Files/Common Files");
    assert!(wsl::to_linux_path(&d, "-evil").is_err());
}

#[test]
fn explorer_reads_linux_and_windows_mounted_paths() {
    use rycos_lib::fsops;
    use rycos_lib::location::Location;
    let Some(d) = distro() else { return };
    let home = wsl::linux_home(&d).unwrap();
    let linux = Location::Linux { distro: d.clone(), path: home.clone() };
    let listing = fsops::list_dir(&linux, "", true).expect("list the Linux home through \\\\wsl.localhost");
    assert!(listing.entries.iter().any(|e| e.name == ".bashrc") || !listing.entries.is_empty());

    // Linux-native project: create, rename, delete inside a scratch folder only.
    let scratch = format!("rycos_scratch_{}", std::process::id());
    fsops::create_entry(&linux, "", &scratch, fsops::CreateKind::Dir).unwrap();
    let root = Location::Linux { distro: d.clone(), path: format!("{home}/{scratch}") };
    fsops::create_entry(&root, "", "a.txt", fsops::CreateKind::File).unwrap();
    fsops::rename_entry(&root, "a.txt", "b.txt").unwrap();
    let names: Vec<_> = fsops::list_dir(&root, "", true).unwrap().entries.into_iter().map(|e| e.name).collect();
    assert_eq!(names, vec!["b.txt"]);
    // The file is real: the distribution sees it.
    let out = wsl::exec(&d, &["ls", &format!("{home}/{scratch}")], Duration::from_secs(30)).unwrap();
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "b.txt");
    assert!(fsops::delete_entry(&root, "../escape").is_err());
    fsops::delete_entry(&linux, &scratch).unwrap();
    assert!(!fsops::list_dir(&linux, "", true).unwrap().entries.iter().any(|e| e.name == scratch));

    // Windows-mounted path viewed through WSL.
    let mounted = Location::Linux { distro: d.clone(), path: "/mnt/c/Windows".into() };
    let win = fsops::list_dir(&mounted, "", true).expect("list /mnt/c/Windows");
    assert!(win.entries.iter().any(|e| e.name.eq_ignore_ascii_case("System32")));
}
