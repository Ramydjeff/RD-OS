// Home page: what you can start, what you were working on, and the state of
// the machine — real numbers only.

import { useMemo } from "react";
import { ArrowUpRight, Command, FolderOpen, FolderPlus, GitFork, SquareTerminal } from "lucide-react";
import { RaimyIcon } from "@/components/ui/RaimyLogo";
import { Keys } from "@/components/ui/Fields";
import { openTerminal } from "@/features/terminalActions";
import { useWslMetrics } from "@/hooks/useMonitorLoop";
import { formatAgo, formatBytes, formatDuration } from "@/lib/format";
import { locationDisplay, locationKey } from "@/lib/paths";
import { formatShortcut, resolveBindings } from "@/lib/shortcuts";
import { useMonitor } from "@/store/monitor";
import { useSettings } from "@/store/settings";
import { useProcessesView } from "@/store/processesView";
import { useTerminals } from "@/store/terminals";
import { useUi } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";
import { chooseDistro, usableDistros, useWsl } from "@/store/wsl";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5 || h >= 18) return "Bonsoir";
  if (h < 12) return "Bonjour";
  return "Bon après-midi";
}

function StartItem({
  icon,
  title,
  desc,
  keys,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  keys?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group -mx-3 flex w-[calc(100%+1.5rem)] items-center gap-4 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors hover:bg-hover"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-glass text-fg2 shadow-[inset_0_0_0_1px_var(--glass-line)] transition-colors group-hover:text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-fg">{title}</span>
        <span className="block truncate text-[12.5px] text-muted">{desc}</span>
      </span>
      {keys && <Keys combo={keys} className="shrink-0 opacity-70 group-hover:opacity-100" />}
    </button>
  );
}

function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0" title={hint}>
      <dt className="shrink-0 text-[12.5px] text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[12.5px] text-fg tabular">{value}</dd>
    </div>
  );
}

export function WorkspaceDashboard() {
  useWslMetrics();
  const setOpenProjectOpen = useUi((s) => s.setOpenProjectOpen);
  const setNewProjectOpen = useUi((s) => s.setNewProjectOpen);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const openProject = useWorkspace((s) => s.openProject);
  const recentProjects = useWorkspace((s) => s.recentProjects);
  const project = useWorkspace((s) => s.project);
  const setView = useWorkspace((s) => s.setView);

  const status = useWsl((s) => s.status);
  const wslLoading = useWsl((s) => s.loading);
  const selectedDistro = useWorkspace((s) => s.selectedDistro);
  const distros = usableDistros(status);
  const distroName = selectedDistro && distros.some((d) => d.name === selectedDistro) ? selectedDistro : chooseDistro(status);
  const distro = distros.find((d) => d.name === distroName) ?? null;

  const host = useMonitor((s) => s.host);
  const wsl = useMonitor((s) => s.wsl);
  const terminals = useTerminals((s) => s.tabs.length);

  const shortcuts = useSettings((s) => s.settings.shortcuts);
  const keys = useMemo(() => resolveBindings(shortcuts), [shortcuts]);
  const key = (id: string, fallback: string) => formatShortcut(keys.get(id) ?? fallback);

  const recents = recentProjects.filter((r) => !project || locationKey(r.location) !== locationKey(project)).slice(0, 6);

  return (
    <div className="mx-auto w-full max-w-[920px] px-10 pb-14 pt-12">
      {/* ── Intro ─────────────────────────────────────────────── */}
      <header className="mb-12 flex items-start justify-between gap-8">
        <div className="min-w-0">
          <p className="eyebrow mb-3">rAImy Solutions · Espace de travail</p>
          <h1 className="font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] text-fg">{greeting()}.</h1>
          <p className="mt-3 max-w-[520px] text-[14.5px] leading-relaxed text-fg2">
            Un terminal Linux natif, vos projets et un simulateur de processus UNIX, réunis dans une seule fenêtre.
          </p>
        </div>
        <RaimyIcon size={64} className="mt-1 hidden opacity-95 sm:block" />
      </header>

      <div className="grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-10">
          {/* ── Démarrer ─────────────────────────────────────── */}
          <section>
            <h2 className="eyebrow mb-2">Démarrer</h2>
            <StartItem
              icon={<SquareTerminal size={17} />}
              title="Nouveau terminal"
              desc={distroName ? `Shell Linux dans ${distroName}${project ? `, dossier ${project.path}` : ""}` : "Shell Linux (WSL 2)"}
              keys={key("terminal.new", "Ctrl+Shift+T")}
              onClick={() => void openTerminal()}
            />
            <StartItem
              icon={<FolderOpen size={17} />}
              title="Ouvrir un dossier"
              desc="Parcourir et modifier un projet Linux ou Windows"
              onClick={() => setOpenProjectOpen(true)}
            />
            <StartItem
              icon={<FolderPlus size={17} />}
              title="Nouveau projet"
              desc="Python, C++, Node.js ou vision par ordinateur, prêt à lancer"
              onClick={() => setNewProjectOpen(true)}
            />
            <StartItem
              icon={<GitFork size={17} />}
              title="Simulateur de processus"
              desc="Voir fork(), wait() et exit() s'exécuter pas à pas"
              onClick={() => {
                useProcessesView.getState().setTab("simulator");
                setView("processes");
              }}
            />
            <StartItem
              icon={<Command size={17} />}
              title="Palette de commandes"
              desc="Toutes les actions de l'application, au clavier"
              keys={key("palette.open", "Ctrl+Shift+P")}
              onClick={() => setPaletteOpen(true)}
            />
          </section>

          {/* ── Récents ──────────────────────────────────────── */}
          <section>
            <h2 className="eyebrow mb-2">Récents</h2>
            {recents.length === 0 ? (
              <p className="py-2 text-[12.5px] text-muted">Les dossiers que vous ouvrez apparaîtront ici.</p>
            ) : (
              <ul>
                {recents.map((r) => (
                  <li key={locationKey(r.location)}>
                    <button
                      type="button"
                      onClick={() => openProject(r.location)}
                      className="group -mx-3 flex w-[calc(100%+1.5rem)] items-baseline gap-3 rounded-[var(--radius-sm)] px-3 py-1.5 text-left transition-colors hover:bg-hover"
                    >
                      <span className="shrink-0 text-[13.5px] font-medium text-fg group-hover:text-accent">{r.name}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{locationDisplay(r.location)}</span>
                      <span className="shrink-0 text-[11px] text-faint">{formatAgo(r.openedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-10">
          {/* ── Système ──────────────────────────────────────── */}
          <section>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="eyebrow">Système</h2>
              <button type="button" onClick={() => setView("environments")} className="flex items-center gap-0.5 text-[11.5px] text-muted hover:text-fg">
                Environnements <ArrowUpRight size={12} />
              </button>
            </div>
            <dl>
              <Fact
                label="WSL"
                value={
                  wslLoading && !status ? (
                    <span className="text-muted">détection…</span>
                  ) : status?.available ? (
                    status.wslVersion ? `version ${status.wslVersion}` : "disponible"
                  ) : (
                    <span className="text-warn">indisponible</span>
                  )
                }
              />
              <Fact
                label="Distribution"
                value={
                  distro ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className={distro.running ? "h-1.5 w-1.5 rounded-full bg-ok" : "h-1.5 w-1.5 rounded-full bg-faint"} />
                      {distro.name} <span className="text-muted">· {distro.running ? "démarrée" : "arrêtée"}</span>
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              {wsl?.memTotalKb != null && wsl.memAvailableKb != null && (
                <Fact
                  label="Mémoire Linux"
                  value={`${formatBytes((wsl.memTotalKb - wsl.memAvailableKb) * 1024)} / ${formatBytes(wsl.memTotalKb * 1024)}`}
                />
              )}
              {wsl?.load1 != null && <Fact label="Charge Linux (1 min)" value={wsl.load1.toFixed(2).replace(".", ",")} />}
              {wsl?.uptimeSecs != null && <Fact label="Linux démarré depuis" value={formatDuration(wsl.uptimeSecs)} />}
              {host && (
                <Fact
                  label="Mémoire Windows"
                  value={`${formatBytes(host.systemMemoryUsed)} / ${formatBytes(host.systemMemoryTotal)}`}
                />
              )}
              {host && (
                <Fact
                  label="Cette application"
                  value={`${Math.round(host.appCpuPercent)} % CPU · ${formatBytes(host.appMemoryBytes)}`}
                  hint={`${host.logicalCpus} processeurs logiques`}
                />
              )}
              <Fact label="Terminaux ouverts" value={terminals} />
            </dl>
          </section>

          {/* ── Raccourcis ───────────────────────────────────── */}
          <section>
            <h2 className="eyebrow mb-1">Raccourcis utiles</h2>
            <dl>
              {(
                [
                  ["Afficher le terminal", key("view.togglePanel", "Ctrl+Backquote")],
                  ["Agrandir le terminal", key("view.maximizePanel", "Ctrl+Shift+M")],
                  ["Rechercher dans le terminal", key("terminal.search", "Ctrl+F")],
                  ["Copier dans le terminal", "Ctrl+Maj+C"],
                  ["Paramètres", key("settings.open", "Ctrl+Comma")],
                ] as const
              ).map(([label, combo]) => (
                <Fact key={label} label={label} value={<Keys combo={combo} />} />
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
