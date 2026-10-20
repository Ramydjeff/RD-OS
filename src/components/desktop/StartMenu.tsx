import { useState } from "react";
import { FileCode2, FolderOpen, LayoutPanelLeft, Maximize, Minimize2, Power, Search, Settings } from "lucide-react";
import { AppIcon } from "@/components/desktop/AppIcon";
import { APPS } from "@/components/desktop/apps";
import { RaimyWordmark } from "@/components/ui/RaimyLogo";
import { minimizeOs, openFolder, openInStudio, quitOs, toggleFullscreen } from "@/features/desktopActions";
import { cn } from "@/lib/cn";
import { locationDisplay } from "@/lib/paths";
import { APP_IDS, useDesktop } from "@/store/desktop";
import { useStudio } from "@/store/studio";
import { useWinApps } from "@/store/winapps";
import { useWorkspace } from "@/store/workspace";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.map((p) => p[0]).join("").slice(0, 2) || "R").toUpperCase();
}

export function useDisplayName(): string {
  const userName = useDesktop((s) => s.userName);
  const winUser = useWinApps((s) => s.places?.userName);
  return userName || winUser || "Étudiant rAImy";
}

export function StartMenu() {
  const openApp = useDesktop((s) => s.openApp);
  const openLauncher = useDesktop((s) => s.openLauncher);
  const setShellMode = useDesktop((s) => s.setShellMode);
  const recents = useStudio((s) => s.recents);
  const projects = useWorkspace((s) => s.recentProjects);
  const name = useDisplayName();
  const [power, setPower] = useState(false);

  const recommended = [
    ...recents.slice(0, 4).map((r) => ({
      key: `f:${locationDisplay(r.location)}`,
      title: r.name,
      detail: locationDisplay(r.location),
      at: r.openedAt,
      icon: <FileCode2 size={16} className="text-accent2" />,
      open: () => void openInStudio(r.location),
    })),
    ...projects.slice(0, 4).map((p) => ({
      key: `p:${locationDisplay(p.location)}`,
      title: p.name,
      detail: locationDisplay(p.location),
      at: p.openedAt,
      icon: <FolderOpen size={16} className="text-[#f7c35b]" />,
      open: () => openFolder(p.location),
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);

  return (
    <div
      role="dialog"
      aria-label="Menu Démarrer"
      className="os-glass-strong os-pop-up absolute bottom-[64px] left-2 z-40 flex w-[620px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl shadow-[var(--shadow)]"
    >
      <div className="p-5 pb-3">
        <label className="flex h-10 items-center gap-2.5 rounded-xl border border-glass-line bg-glass px-3.5 focus-within:border-accent/60">
          <Search size={15} className="text-muted" />
          <input
            autoFocus
            placeholder="Rechercher une app, un fichier, une commande…"
            className="h-full flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
            onChange={(e) => openLauncher(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") useDesktop.getState().setOverlay(null);
            }}
          />
        </label>
      </div>

      <section className="px-5">
        <h3 className="eyebrow mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Applications</h3>
        <div className="grid grid-cols-5 gap-1">
          {APP_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => openApp(id)}
              title={APPS[id].blurb}
              className="group flex flex-col items-center gap-2 rounded-xl px-1 py-3 transition-colors hover:bg-glass-hover"
            >
              <span className="transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-90">
                <AppIcon app={id} size={42} />
              </span>
              <span className="line-clamp-1 text-[11.5px] text-fg2">{APPS[id].name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-3 min-h-[148px] px-5 pb-4">
        <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Recommandé</h3>
        {recommended.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-glass-line px-4 py-4 text-[12px] text-muted">
            <RaimyWordmark compact className="text-[15px]" />
            Vos fichiers et projets récents apparaîtront ici.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            {recommended.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={r.open}
                className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-glass-hover"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-glass">{r.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] text-fg">{r.title}</span>
                  <span className="block truncate font-mono text-[10.5px] text-faint">{r.detail}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <footer className="relative flex items-center justify-between border-t border-glass-line bg-[var(--os-glass-hi)] px-5 py-3">
        <button
          type="button"
          onClick={() => openApp("settings", { args: { tab: "desktop" } })}
          className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-glass-hover"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#f43f52] to-[#642125] text-[12px] font-semibold text-white">
            {initials(name)}
          </span>
          <span className="text-[12.5px] font-medium text-fg">{name}</span>
        </button>
        <div className="flex items-center gap-1">
          <FooterButton label="Mode Workspace (IDE)" onClick={() => setShellMode("workspace")}>
            <LayoutPanelLeft size={16} />
          </FooterButton>
          <FooterButton label="Paramètres" onClick={() => openApp("settings")}>
            <Settings size={16} />
          </FooterButton>
          <FooterButton label="Alimentation" active={power} onClick={() => setPower((p) => !p)}>
            <Power size={16} />
          </FooterButton>
        </div>
        {power && (
          <div className="os-glass-strong os-pop-up absolute right-4 bottom-14 w-56 rounded-xl p-1 shadow-[var(--shadow)]">
            <PowerItem icon={<Minimize2 size={14} />} label="Réduire rAImy OS" onClick={() => void minimizeOs()} />
            <PowerItem icon={<Maximize size={14} />} label="Plein écran (F11)" onClick={() => void toggleFullscreen()} />
            <PowerItem icon={<Power size={14} />} label="Quitter rAImy OS" danger onClick={() => void quitOs()} />
          </div>
        )}
      </footer>
    </div>
  );
}

function FooterButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn("flex h-9 w-9 items-center justify-center rounded-xl text-fg2 transition-colors hover:bg-glass-hover hover:text-fg", active && "bg-glass-hover")}
    >
      {children}
    </button>
  );
}

function PowerItem({ icon, label, danger, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-glass-hover", danger ? "text-danger" : "text-fg")}
    >
      {icon}
      {label}
    </button>
  );
}
