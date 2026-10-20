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
  SquareTerminal,
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
  python3: { why: "Interpréteur Python : scripts, IA et vision par ordinateur.", apt: ["python3"] },
  pip3: { why: "Installe les paquets Python.", apt: ["python3-pip", "python3-venv"] },
  git: { why: "Gestion de versions.", apt: ["git"] },
  gcc: { why: "Compilateur C (utilisé pour comparer avec le simulateur).", apt: ["build-essential"] },
  "g++": { why: "Compilateur C++.", apt: ["build-essential"] },
  make: { why: "Exécute les Makefile et beaucoup de scripts de compilation.", apt: ["build-essential"] },
  cmake: { why: "Générateur de projets C et C++.", apt: ["cmake"] },
  node: { why: "Environnement JavaScript pour l'outillage web.", apt: ["nodejs"], optional: true },
  npm: { why: "Gestionnaire de paquets de Node.js.", apt: ["npm"], optional: true },
  docker: { why: "Client Docker, en général fourni par l'intégration WSL de Docker Desktop.", apt: [], optional: true },
};

export function aptCommand(missing: ToolCheck[]): string | null {
  const pkgs = [...new Set(missing.flatMap((t) => TOOL_INFO[t.command]?.apt ?? []))];
  return pkgs.length ? `sudo apt update && sudo apt install -y ${pkgs.join(" ")}` : null;
}

export function EnvironmentPage() {
  const status = useWsl((s) => s.status);
  const loading = useWsl((s) => s.loading);
  const error = useWsl((s) => s.error);
  const refresh = useWsl((s) => s.refresh);
  const selectedName = useWorkspace((s) => s.selectedDistro);
  const setSelectedDistro = useWorkspace((s) => s.setSelectedDistro);
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
      toast("success", `${distro.name} est démarrée.`);
      await refresh();
    } catch (e) {
      void reportError(`Impossible de démarrer ${distro.name}`, e);
    } finally {
      setBusyAction(null);
    }
  }

  async function terminate() {
    if (!distro) return;
    if (confirmTerminate) {
      const ok = await confirmDialog({
        title: `Arrêter ${distro.name} ?`,
        message: `Exécute « wsl.exe --terminate ${distro.name} ». Tous les terminaux et processus de cette distribution s'arrêtent, y compris ceux lancés hors de l'application. Aucun fichier n'est supprimé.`,
        confirmLabel: "Arrêter la distribution",
        danger: true,
      });
      if (!ok) return;
    }
    setBusyAction("terminate");
    try {
      await ipc.wslTerminateDistro(distro.name);
      toast("info", `${distro.name} a été arrêtée.`);
      await refresh();
    } catch (e) {
      void reportError(`Impossible d'arrêter ${distro.name}`, e);
    } finally {
      setBusyAction(null);
    }
  }

  const missing = diag?.tools.filter((t) => !t.found) ?? [];
  const missingRequired = missing.filter((t) => !TOOL_INFO[t.command]?.optional);
  const isApt = /ubuntu|debian/i.test(`${diag?.osRelease.name ?? ""} ${diag?.osRelease.prettyName ?? ""}`);
  const install = isApt ? aptCommand(missingRequired.length ? missingRequired : missing) : null;

  return (
    <div className="mx-auto max-w-[860px] space-y-10 px-8 pb-16 pt-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-fg">Environnements</h1>
          <p className="mt-1 text-[13px] text-muted">Les distributions Linux (WSL 2) installées sur cette machine.</p>
        </div>
        <Button variant="ghost" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={13} className={cn(loading && "animate-spin")} /> Actualiser
        </Button>
      </header>

      {(status?.problem || error) && (
        <section className="rounded-[var(--radius-md)] border border-warn/40 bg-warn/10 px-4 py-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-warn">
            <CircleAlert size={15} /> {status?.problem ? "WSL demande votre attention" : "La détection a échoué"}
          </h2>
          <p className="selectable mt-1 text-[13px] text-fg">{status?.problem?.message ?? error}</p>
          {status?.problem && <p className="selectable mt-1.5 text-[12px] text-muted">{status.problem.hint}</p>}
        </section>
      )}

      <section>
        <h2 className="eyebrow mb-1">Sous-système Windows pour Linux</h2>
        {status?.available ? (
          <dl className="text-[13px]">
            {(
              [
                ["wsl.exe", <span className="selectable font-mono text-[12px]">{status.wslPath}</span>],
                ["Version", status.wslVersion ?? "inconnue (ancienne version de WSL)"],
                ["Distribution par défaut", status.defaultDistro ?? "aucune"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
                <dt className="text-muted">{k}</dt>
                <dd className="min-w-0 truncate text-right text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="py-2 text-[13px] text-muted">{loading ? "Vérification…" : "WSL n'a pas été détecté."}</p>
        )}
        {status?.versionText && (
          <details className="mt-2 text-[12px] text-muted">
            <summary className="cursor-pointer hover:text-fg">Sortie complète de wsl --version</summary>
            <pre className="selectable mt-2 whitespace-pre-wrap rounded-[var(--radius-sm)] bg-code p-3 font-mono text-[11.5px]">{status.versionText}</pre>
            {status.statusText && <pre className="selectable mt-2 whitespace-pre-wrap rounded-[var(--radius-sm)] bg-code p-3 font-mono text-[11.5px]">{status.statusText}</pre>}
          </details>
        )}
      </section>

      {status && status.distros.length > 1 && (
        <section>
          <h2 className="eyebrow mb-2">Distributions</h2>
          <div className="flex flex-wrap gap-2">
            {status.distros.map((d) => (
              <button
                key={d.name}
                type="button"
                onClick={() => !d.managed && setSelectedDistro(d.name)}
                disabled={d.managed}
                title={d.managed ? "Gérée par une autre application" : `Utiliser ${d.name}`}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-full px-3.5 text-[12.5px] transition-colors disabled:opacity-50",
                  d.name === distro?.name ? "bg-active text-fg shadow-[inset_0_0_0_1px_var(--accent)]" : "bg-glass text-fg2 shadow-[inset_0_0_0_1px_var(--glass-line)] hover:bg-glass-hover",
                )}
              >
                <StateDot d={d} /> {d.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {distro && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 font-display text-[19px] font-semibold tracking-[-0.01em] text-fg">
                {distro.name}
                {distro.isDefault && <Badge tone="good">par défaut</Badge>}
                {distro.managed && <Badge tone="warn">gérée par une autre application</Badge>}
                <Badge>WSL {distro.version}</Badge>
              </h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
                <StateDot d={distro} /> {distro.running ? "Démarrée" : "Arrêtée"}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {!distro.running && !distro.managed && (
                <Button onClick={() => void start()} disabled={busyAction !== null}>
                  {busyAction === "start" ? <LoaderCircle size={13} className="animate-spin" /> : <Play size={13} />} Démarrer
                </Button>
              )}
              {distro.running && !distro.managed && (
                <Button variant="ghost" onClick={() => void terminate()} disabled={busyAction !== null}>
                  <Power size={13} /> Arrêter
                </Button>
              )}
              <Button variant="primary" disabled={distro.managed} onClick={() => void openTerminal({ distro: distro.name, cwd: null })}>
                <SquareTerminal size={13} /> Ouvrir un terminal
              </Button>
            </div>
          </div>

          {distro.managed ? (
            <p className="mt-4 flex gap-2 border-l-2 border-line pl-3 text-[12.5px] text-muted">
              <Info size={14} className="mt-px shrink-0" />
              Cette distribution appartient à Docker Desktop (ou à un outil semblable). rAImy Solutions l'affiche seulement : elle n'est jamais
              démarrée, arrêtée ni modifiée ici.
            </p>
          ) : !distro.running && !diag ? (
            <p className="mt-4 text-[12.5px] text-muted">
              Cette distribution est arrêtée. Démarrez-la (ou ouvrez un terminal, qui la démarre) pour lancer les vérifications.
            </p>
          ) : (
            <DiagnosticsView diag={diag} loading={diagLoading} error={diagError} install={install} isApt={isApt} onRerun={() => name && void runDiagnostics(name)} />
          )}
        </section>
      )}
    </div>
  );
}

function StateDot({ d }: { d: Distro }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", d.running ? "bg-ok" : "bg-faint")} />;
}

function ToolRow({ t }: { t: ToolCheck }) {
  const info = TOOL_INFO[t.command];
  return (
    <li className="flex items-start gap-3 py-2.5">
      {t.found ? (
        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" aria-label="installé" />
      ) : info?.optional ? (
        <Info size={15} className="mt-0.5 shrink-0 text-muted" aria-label="facultatif, non installé" />
      ) : (
        <XCircle size={15} className="mt-0.5 shrink-0 text-danger" aria-label="manquant" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-fg">
          <span className="font-medium">{t.label}</span> <span className="font-mono text-[11.5px] text-muted">{t.command}</span>
          {info?.optional && <span className="ml-2 text-[11.5px] text-faint">facultatif</span>}
        </p>
        {!t.found && info && <p className="text-[12px] text-muted">{info.why}</p>}
      </div>
      <p className="selectable max-w-[45%] shrink-0 truncate text-right font-mono text-[11.5px] text-faint">
        {t.found ? (t.version ?? "installé") : (t.detail ?? "introuvable")}
      </p>
    </li>
  );
}

function DiagnosticsView(props: {
  diag: Diagnostics | null;
  loading: boolean;
  error: string | null;
  install: string | null;
  isApt: boolean;
  onRerun: () => void;
}) {
  const { diag, loading, error, install, isApt, onRerun } = props;
  return (
    <div className="mt-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="eyebrow">Vérifications du système</h3>
        <Button size="sm" variant="ghost" onClick={onRerun} disabled={loading}>
          <RefreshCw size={12} className={cn(loading && "animate-spin")} /> {diag ? "Relancer" : "Lancer"}
        </Button>
      </div>
      {loading && !diag && (
        <p className="flex items-center gap-2 text-[12.5px] text-muted">
          <LoaderCircle size={13} className="animate-spin" /> Vérifications en cours dans la distribution…
        </p>
      )}
      {error && (
        <p role="alert" className="selectable text-[12.5px] text-danger">
          {error}
        </p>
      )}
      {diag && (
        <>
          <dl className="text-[13px]">
            <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
              <dt className="text-muted">Système</dt>
              <dd className="selectable text-fg">{diag.osRelease.prettyName ?? diag.osRelease.name ?? "inconnu"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
              <dt className="text-muted">Noyau</dt>
              <dd className="selectable min-w-0 truncate font-mono text-[11.5px] text-fg">{diag.uname ?? "inconnu"}</dd>
            </div>
          </dl>
          {diag.errors.length > 0 && <p className="text-[12.5px] text-warn">{diag.errors.join(" ")}</p>}
          <ul className="divide-y divide-line">
            {diag.tools.map((t) => (
              <ToolRow key={t.command} t={t} />
            ))}
          </ul>

          <div className="rounded-[var(--radius-md)] bg-glass p-4 shadow-[inset_0_0_0_1px_var(--glass-line)]">
            <h3 className="mb-1 text-[13px] font-semibold text-fg">Outils de développement</h3>
            {install ? (
              <>
                <p className="mb-3 text-[12.5px] text-muted">
                  Des outils manquent. Relisez cette commande puis lancez-la dans un terminal (elle demande votre mot de passe sudo). Rien
                  n'est exécuté à votre place.
                </p>
                <div className="flex items-center gap-2">
                  <code className="selectable min-w-0 flex-1 break-all rounded-[var(--radius-sm)] bg-code px-2.5 py-2 font-mono text-[11.5px] text-fg">{install}</code>
                  <Button size="sm" onClick={() => insertIntoActive(install)}>
                    <ClipboardPaste size={12} /> Insérer
                  </Button>
                  <Button size="sm" onClick={() => void navigator.clipboard.writeText(install).then(() => toast("info", "Commande copiée."))}>
                    <Copy size={12} /> Copier
                  </Button>
                </div>
              </>
            ) : diag.tools.every((t) => t.found || TOOL_INFO[t.command]?.optional) ? (
              <p className="text-[12.5px] text-ok">Tous les outils nécessaires sont installés.</p>
            ) : (
              <p className="text-[12.5px] text-muted">
                {isApt ? "Seuls des outils facultatifs manquent : installez-les si vous en avez besoin." : "Installez les outils manquants avec le gestionnaire de paquets de cette distribution."}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
