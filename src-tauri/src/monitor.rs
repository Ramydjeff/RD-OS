//! Lightweight host metrics. Only this process and system memory are sampled
//! (no per-process scans, no disks or network), and sampling only happens when
//! the UI asks for it.

use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSample {
    pub app_pid: u32,
    /// CPU use of this application, normalized to 0-100 across all logical cores.
    /// The first sample after startup is always 0 (a CPU delta needs two samples).
    pub app_cpu_percent: f32,
    pub app_memory_bytes: u64,
    pub system_memory_total: u64,
    pub system_memory_used: u64,
    pub logical_cpus: usize,
}

pub struct HostMonitor {
    sys: Mutex<System>,
}

impl HostMonitor {
    pub fn new() -> Self {
        Self { sys: Mutex::new(System::new()) }
    }

    pub fn sample(&self) -> Result<HostSample, String> {
        let mut sys = self.sys.lock().map_err(|_| "monitor state poisoned".to_string())?;
        let pid = Pid::from_u32(std::process::id());
        sys.refresh_memory();
        sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
        let proc = sys.process(pid).ok_or_else(|| "could not read this process's statistics".to_string())?;
        let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
        Ok(HostSample {
            app_pid: pid.as_u32(),
            app_cpu_percent: (proc.cpu_usage() / cpus as f32).clamp(0.0, 100.0),
            app_memory_bytes: proc.memory(),
            system_memory_total: sys.total_memory(),
            system_memory_used: sys.used_memory(),
            logical_cpus: cpus,
        })
    }
}

impl Default for HostMonitor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_this_process() {
        let m = HostMonitor::new();
        let a = m.sample().unwrap();
        assert_eq!(a.app_pid, std::process::id());
        assert!(a.app_memory_bytes > 0);
        assert!(a.system_memory_total >= a.system_memory_used);
        assert!(a.logical_cpus >= 1);
        let b = m.sample().unwrap();
        assert!((0.0..=100.0).contains(&b.app_cpu_percent));
    }
}
