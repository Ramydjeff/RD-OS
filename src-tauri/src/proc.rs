//! Bounded, non-interactive process execution used for short diagnostic
//! commands (`wsl.exe -l -v`, tool version checks, ...). Interactive terminals
//! go through the PTY layer instead; this module is never used for them.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};

/// Win32 flag: do not flash a console window for child processes.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Hard cap on captured bytes per stream so a runaway command cannot exhaust memory.
const MAX_CAPTURE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Default)]
pub struct Captured {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub timed_out: bool,
}

impl Captured {
    pub fn success(&self) -> bool {
        self.code == Some(0) && !self.timed_out
    }
}

pub fn configure(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// Runs `cmd` to completion or until `timeout` elapses (then kills it).
pub fn run_capture(mut cmd: Command, timeout: Duration) -> AppResult<Captured> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    configure(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Process(format!("could not start process: {e}")))?;

    let mut out = child.stdout.take().expect("stdout piped");
    let mut err = child.stderr.take().expect("stderr piped");
    // Readers report through channels so we never block on a pipe that a
    // surviving grandchild process keeps open after the child itself is gone.
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
    let (err_tx, err_rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut v = Vec::new();
        let _ = (&mut out).take(MAX_CAPTURE_BYTES).read_to_end(&mut v);
        let _ = out_tx.send(v);
    });
    thread::spawn(move || {
        let mut v = Vec::new();
        let _ = (&mut err).take(MAX_CAPTURE_BYTES).read_to_end(&mut v);
        let _ = err_tx.send(v);
    });

    let started = Instant::now();
    let mut timed_out = false;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break None;
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(AppError::Process(format!("failed waiting for process: {e}"))),
        }
    };

    let grace = if timed_out { Duration::from_millis(250) } else { Duration::from_secs(2) };
    Ok(Captured {
        code,
        stdout: out_rx.recv_timeout(grace).unwrap_or_default(),
        stderr: err_rx.recv_timeout(grace).unwrap_or_default(),
        timed_out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn captures_output_and_exit_code() {
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/C", "echo hello && exit 3"]);
        let out = run_capture(cmd, Duration::from_secs(10)).unwrap();
        assert_eq!(out.code, Some(3));
        assert!(String::from_utf8_lossy(&out.stdout).contains("hello"));
        assert!(!out.timed_out);
    }

    #[cfg(windows)]
    #[test]
    fn kills_on_timeout() {
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/C", "ping -n 30 127.0.0.1 >nul"]);
        let started = Instant::now();
        let out = run_capture(cmd, Duration::from_millis(300)).unwrap();
        assert!(out.timed_out);
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
