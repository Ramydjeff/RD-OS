// Bottom status line: environment, project and live numbers, each a shortcut to
// the place that explains it.

import { FolderOpen, Moon, SquareTerminal, Sun } from "lucide-react";
import { toggleTheme } from "@/features/actions";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { locationName } from "@/lib/paths";
import { useMonitor } from "@/store/monitor";
import { useProcessesView } from "@/store/processesView";
import { useTerminals } from "@/store/terminals";
import { useTheme } from "@/store/theme";
import { useWorkspace } from "@/store/workspace";
import { chooseDistro, usableDistros, useWsl } from "@/store/wsl";

function Item({ children, onClick, title, className }: { children: React.ReactNode; onClick?: () => void; title?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn("flex h-full shrink-0 items-center gap-1.5 px-2 transition-colors hover:bg-hover hover:text-fg", className)}
    >
      {children}
    </button>
  );
}

export function StatusBar() {
  const status = useWsl((s) => s.status);
  const wslLoading = useWsl((s) => s.loading);
  const selectedDistro = useWorkspace((s) => s.selectedDistro);
  const project = useWorkspace((s) => s.project);
  const setView = useWorkspace((s) => s.setView);
  const togglePanel = useWorkspace((s) => s.togglePanel);
  const sessions = useTerminals((s) => s.tabs.length);
  const host = useMonitor((s) => s.host);
  const theme = useTheme((s) => s.resolved);

  const distros = usableDistros(status);
  const distro = selectedDistro && distros.some((d) => d.name === selectedDistro) ? selectedDistro : chooseDistro(status);
  const running = distros.find((d) => d.name === distro)?.running ?? false;
  const ok = !!status?.available && !!distro;

  return (
    <footer className="flex h-6 shrink-0 items-stretch justify-between border-t border-line bg-surface text-[11px] text-muted">
      <div className="flex min-w-0 items-stretch">
        <Item
          onClick={() => setView("environments")}
          title={ok ? `Distribution WSL : ${distro}${running ? " (démarrée)" : " (arrêtée)"}` : "WSL n'est pas prêt : ouvrir les environnements"}
          className="pl-3"
        >
          <span
            aria-hidden
            className={cn(
              "h-[7px] w-[7px] rounded-full",
              wslLoading && !status ? "animate-pulse bg-faint" : ok ? (running ? "bg-ok" : "bg-faint") : "bg-warn",
            )}
          />
          <span className="font-medium text-fg2">{wslLoading && !status ? "Détection de WSL…" : ok ? `WSL · ${distro}` : "WSL indisponible"}</span>
        </Item>
        {project && (
          <Item onClick={() => setView("explorer")} title={project.kind === "linux" ? `${project.distro}:${project.path}` : project.path} className="min-w-0">
            <FolderOpen size={12} className="shrink-0" />
            <span className="truncate">{locationName(project)}</span>
          </Item>
        )}
      </div>
      <div className="flex items-stretch">
        <Item onClick={togglePanel} title="Afficher ou masquer le terminal">
          <SquareTerminal size={12} />
          <span className="tabular">
            {sessions} terminal{sessions > 1 ? "aux" : ""}
          </span>
        </Item>
        {host && (
          <Item
            onClick={() => {
              useProcessesView.getState().setTab("metrics");
              setView("processes");
            }}
            title="Ressources utilisées par l'application"
          >
            <span className="tabular">
              CPU {Math.round(host.appCpuPercent)} % · {formatBytes(host.appMemoryBytes)}
            </span>
          </Item>
        )}
        <Item onClick={toggleTheme} title={theme === "dark" ? "Passer au thème clair" : "Passer au thème sombre"} className="pr-3">
          {theme === "dark" ? <Moon size={12} /> : <Sun size={12} />}
        </Item>
      </div>
    </footer>
  );
}
