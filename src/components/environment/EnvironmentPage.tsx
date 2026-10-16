import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  ClipboardPaste,
  Copy,
  Info,
  LoaderCircle,
  Play,
  Power,
  RefreshCw,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Fields";
import { insertIntoActive, openTerminal, reportError } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { useSettings } from "@/store/settings";
import { confirmDialog, toast } from "@/store/ui";
import { chooseDistro, useWsl } from "@/store/wsl";
import { useWorkspace } from "@/store/workspace";
import type { Diagnostics, Distro, ToolCheck } from "@/types/ipc";

/** Why each tool matters and the apt package that provides it (Debian/Ubuntu family). */
const TOOL_INFO: Record<string, { why: string; apt: string[]; optional?: boolean }> = {
  python3: { why: "Python interpreter for scripts, AI and computer-vision work.", apt: ["python3"] },
  pip3: { why: "Installs Python packages.", apt: ["python3-pip", "python3-venv"] },
  git: { why: "Version control.", apt: ["git"] },
  gcc: { why: "C compiler.", apt: ["build-essential"] },
  "g++": { why: "C++ compiler.", apt: ["build-essential"] },
  make: { why: "Runs Makefiles and many build scripts.", apt: ["build-essential"] },
  cmake: { why: "Build system generator for C and C++ projects.", apt: ["cmake"] },
  node: { why: "JavaScript runtime for web tooling.", apt: ["nodejs"], optional: true },
  npm: { why: "Node.js package manager.", apt: ["npm"], optional: true },
  docker: { why: "Docker CLI. Usually comes from Docker Desktop's WSL integration.", apt: [], optional: true },
};

export function aptCommand(missing: ToolCheck[]): string | null {
  const pkgs = [...new Set(missing.flatMap((t) => TOOL_INFO[t.command]?.apt ?? []))];
  return pkgs.length ? `sudo apt update && sudo apt install -y ${pkgs.join(" ")}` : null;
}

function StateDot({ d }: { d: Distro }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-2 w-2 rounded-full", d.running ? "bg-accent" : "bg-muted/60")}
    />
  );
}

export function EnvironmentPage() {
  const status = useWsl((s) => s.status);
  const loading = useWsl((s) => s.loading);
  const error = useWsl((s) => s.error);
  const refresh = useWsl((s) => s.refresh);
  const selectedName = useWorkspace((s) => s.selectedDistro);
  const confirmTerminate = useSettings((s) => s.settings.confirmations.terminateDistro);

  const distro = status?.distros.find((d) => d.name === (selectedName ?? chooseDistro(status))) ?? status?.distros[0] ?? null;
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const runDiagnostics = useCallback(async (name: string) => {
    setDiagLoading(true);
    setDiagError(null);
    try {
      setDiag(await ipc.envDiagnostics(name));
    } catch (e) {
      setDiag(null);
      setDiagError(errorMessage(e));
    } finally {
      setDiagLoading(false);
    }
  }, []);

  // Diagnostics run automatically only for a distribution that is already running
  // (so merely viewing this page never wakes one up).
  const running = distro?.running ?? false;
  const name = distro?.name ?? null;
  const managed = distro?.managed ?? false;
  useEffect(() => {
    setDiag(null);
    setDiagError(null);
    if (name && running && !managed) void runDiagnostics(name);
  }, [name, running, managed, runDiagnostics]);

  async function start() {
    if (!distro) return;
    setBusyAction("start");
    try {
      await ipc.wslStartDistro(distro.name);
      toast("success", `${distro.name} is running.`);
      await refresh();
    } catch (e) {
      void reportError(`Could not start ${distro.name}`, e);
    } finally {
      setBusyAction(null);
    }
  }

  async function terminate() {
    if (!distro) return;
    if (confirmTerminate) {
      const ok = await confirmDialog({
        title: `Stop ${distro.name}?`,
        message: `This runs "wsl.exe --terminate ${distro.name}". Every terminal and process running in this distribution ends, including ones started outside this app. Files are not deleted.`,
        confirmLabel: "Stop distribution",
        danger: true,
      });
      if (!ok) return;
    }
    setBusyAction("terminate");
    try {
      await ipc.wslTerminateDistro(distro.name);
      toast("info", `${distro.name} was stopped.`);
      await refresh();
    } catch (e) {
      void reportError(`Could not stop ${distro.name}`, e);
    } finally {
      setBusyAction(null);
    }
  }

  const missing = diag?.tools.filter((t) => !t.found) ?? [];
  const missingRequired = missing.filter((t) => !TOOL_INFO[t.command]?.optional);
  const isApt = /ubuntu|debian/i.test(`${diag?.osRelease.name ?? ""} ${diag?.osRelease.prettyName ?? ""}`);
  const install = isApt ? aptCommand(missingRequired.length ? missingRequired : missing) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Environments</h1>
          <p className="text-xs text-muted">WSL distributions detected on this machine.</p>
        </div>
        <Button onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={13} className={cn(loading && "animate-spin")} /> Refresh
        </Button>
      </header>

      {(status?.problem || error) && (
        <section className="rounded-md border border-warn/50 bg-surface p-4">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-warn">
            <CircleAlert size={15} /> {status?.problem ? "WSL needs attention" : "Detection failed"}
          </h2>
          <p className="selectable mt-1 text-[13px]">{status?.problem?.message ?? error}</p>
          {status?.problem && <p className="selectable mt-2 text-xs text-muted">{status.problem.hint}</p>}
        </section>
      )}

      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="mb-2 text-[13px] font-semibold">Windows Subsystem for Linux</h2>
        {status?.available ? (
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-[13px]">
            <dt className="text-muted">wsl.exe</dt>
            <dd className="selectable truncate font-mono text-xs">{status.wslPath}</dd>
            <dt className="text-muted">Version</dt>
            <dd className="selectable">{status.wslVersion ?? "unknown (older WSL build)"}</dd>
            <dt className="text-muted">Default distribution</dt>
            <dd>{status.defaultDistro ?? "none"}</dd>
          </dl>
        ) : (
          <p className="text-[13px] text-muted">{loading ? "Checking..." : "WSL was not detected."}</p>
        )}
        {status?.versionText && (
          <details className="mt-2 text-xs text-muted">
            <summary className="cursor-pointer">Full version output</summary>
            <pre className="selectable mt-1 whitespace-pre-wrap font-mono">{status.versionText}</pre>
            {status.statusText && <pre className="selectable mt-2 whitespace-pre-wrap font-mono">{status.statusText}</pre>}
          </details>
        )}
      </section>

      {distro && (
        <section className="rounded-md border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold">
              <StateDot d={distro} /> {distro.name}
              {distro.isDefault && <Badge tone="good">WSL default</Badge>}
              {distro.managed && <Badge tone="warn">Managed by another app</Badge>}
              <Badge>WSL {distro.version}</Badge>
            </h2>
            <div className="flex items-center gap-1.5">
              <Button
                variant="primary"
                disabled={distro.managed}
                onClick={() => void openTerminal({ distro: distro.name, cwd: null })}
              >
                <TerminalSquare size={13} /> Open terminal
              </Button>
              {!distro.running && !distro.managed && (
                <Button onClick={() => void start()} disabled={busyAction !== null}>
                  {busyAction === "start" ? <LoaderCircle size={13} className="animate-spin" /> : <Play size={13} />} Start
                </Button>
              )}
              {distro.running && !distro.managed && (
                <Button onClick={() => void terminate()} disabled={busyAction !== null}>
                  <Power size={13} /> Stop
                </Button>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted">
            State: {distro.running ? "running" : "stopped"}
            {distro.state && ` (WSL reports "${distro.state}")`}
          </p>

          {distro.managed ? (
            <p className="mt-3 flex gap-2 rounded-[var(--radius-sm)] border border-line p-2.5 text-xs text-muted">
              <Info size={14} className="mt-px shrink-0" />
              This distribution belongs to Docker Desktop (or a similar tool). rAImy Solutions shows it for information only and never starts,
              stops, enters or modifies it. Manage it from its own application.
            </p>
          ) : !distro.running && !diag ? (
            <p className="mt-3 text-xs text-muted">
              This distribution is stopped. Start it (or open a terminal, which starts it on demand) to run the system checks.
            </p>
          ) : (
            <Diagnostics
              diag={diag}
              loading={diagLoading}
              error={diagError}
              install={install}
              isApt={isApt}
              onRerun={() => name && void runDiagnostics(name)}
            />
          )}
        </section>
      )}

      {status?.available && status.distros.length > 1 && (
        <p className="text-xs text-muted">Select another distribution from the sidebar to inspect it.</p>
      )}
    </div>
  );
}

function ToolRow({ t }: { t: ToolCheck }) {
  const info = TOOL_INFO[t.command];
  return (
    <li className="flex items-start gap-2 py-1.5">
      {t.found ? (
        <CheckCircle2 size={15} className="mt-px shrink-0 text-accent" aria-label="installed" />
      ) : info?.optional ? (
        <Info size={15} className="mt-px shrink-0 text-muted" aria-label="optional, not installed" />
      ) : (
        <XCircle size={15} className="mt-px shrink-0 text-danger" aria-label="missing" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">
          <span className="font-medium">{t.label}</span> <span className="font-mono text-xs text-muted">{t.command}</span>
          {info?.optional && <span className="ml-2 text-xs text-muted">optional</span>}
        </p>
        <p className="selectable truncate font-mono text-xs text-muted">
          {t.found ? (t.version ?? "installed") : (t.detail ?? "not found")}
        </p>
        {!t.found && info && <p className="text-xs text-muted">{info.why}</p>}
      </div>
    </li>
  );
}

function Diagnostics(props: {
  diag: Diagnostics | null;
  loading: boolean;
  error: string | null;
  install: string | null;
  isApt: boolean;
  onRerun: () => void;
}) {
  const { diag, loading, error, install, isApt, onRerun } = props;
  return (
    <div className="mt-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">System checks</h3>
        <Button size="sm" onClick={onRerun} disabled={loading}>
          <RefreshCw size={12} className={cn(loading && "animate-spin")} /> {diag ? "Re-run" : "Run checks"}
        </Button>
      </div>
      {loading && !diag && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <LoaderCircle size={13} className="animate-spin" /> Running checks inside the distribution...
        </p>
      )}
      {error && (
        <p role="alert" className="selectable text-xs text-danger">
          {error}
        </p>
      )}
      {diag && (
        <>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-[13px]">
            <dt className="text-muted">System</dt>
            <dd className="selectable">{diag.osRelease.prettyName ?? diag.osRelease.name ?? "unknown"}</dd>
            <dt className="text-muted">Kernel</dt>
            <dd className="selectable truncate font-mono text-xs">{diag.uname ?? "unknown"}</dd>
          </dl>
          {diag.errors.length > 0 && <p className="text-xs text-warn">{diag.errors.join(" ")}</p>}
          <ul className="divide-y divide-line">
            {diag.tools.map((t) => (
              <ToolRow key={t.command} t={t} />
            ))}
          </ul>

          <div className="rounded-[var(--radius-sm)] border border-line p-3">
            <h3 className="mb-1 text-[13px] font-semibold">Developer bootstrap checklist</h3>
            {install ? (
              <>
                <p className="mb-2 text-xs text-muted">
                  Some tools are missing. Review this command, then run it in a terminal (it needs your sudo password). Nothing is run
                  for you.
                </p>
                <div className="flex items-center gap-2">
                  <code className="selectable min-w-0 flex-1 break-all rounded-[3px] bg-bg px-2 py-1.5 font-mono text-xs">{install}</code>
                  <Button size="sm" onClick={() => insertIntoActive(install)}>
                    <ClipboardPaste size={12} /> Insert
                  </Button>
                  <Button size="sm" onClick={() => void navigator.clipboard.writeText(install).then(() => toast("info", "Copied."))}>
                    <Copy size={12} /> Copy
                  </Button>
                </div>
              </>
            ) : diag.tools.every((t) => t.found || TOOL_INFO[t.command]?.optional) ? (
              <p className="text-xs text-accent">All required development tools were found.</p>
            ) : (
              <p className="text-xs text-muted">
                {isApt
                  ? "Optional tools are missing; install them only if you need them."
                  : "Install the missing tools with this distribution's package manager."}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
