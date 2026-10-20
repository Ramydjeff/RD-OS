// Panels that open from the tray: quick settings and the calendar.

import { useState } from "react";
import { ChevronLeft, ChevronRight, LayoutPanelLeft, Maximize, Minimize2, Moon, Monitor, Play, Power, Square, Sun } from "lucide-react";
import { Wallpaper, WALLPAPER_LABELS } from "@/components/desktop/Wallpaper";
import { useClock } from "@/components/desktop/Taskbar";
import { minimizeOs, quitOs, toggleFullscreen } from "@/features/desktopActions";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { useDesktop, WALLPAPERS } from "@/store/desktop";
import { useMonitor } from "@/store/monitor";
import { useSettings } from "@/store/settings";
import { useTheme } from "@/store/theme";
import { toast } from "@/store/ui";
import { chooseDistro, usableDistros, useWsl } from "@/store/wsl";
import type { ThemeSetting } from "@/types/ipc";

export async function setThemeSetting(theme: ThemeSetting): Promise<void> {
  const err = await useSettings.getState().update((s) => ({ ...s, theme }));
  if (err) toast("error", err);
  else useTheme.getState().setSetting(theme);
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("os-glass-strong os-pop-up absolute right-2 bottom-[64px] z-40 rounded-2xl p-4 shadow-[var(--shadow)]", className)}>
      {children}
    </div>
  );
}

export function QuickSettings() {
  const theme = useSettings((s) => s.settings.theme);
  const wallpaper = useDesktop((s) => s.wallpaper);
  const setWallpaper = useDesktop((s) => s.setWallpaper);
  const status = useWsl((s) => s.status);
  const host = useMonitor((s) => s.host);
  const [busy, setBusy] = useState<string | null>(null);
  const distro = chooseDistro(status);
  const info = usableDistros(status).find((d) => d.name === distro);

  async function toggleDistro() {
    if (!info) return;
    setBusy(info.name);
    try {
      if (info.running) await ipc.wslTerminateDistro(info.name);
      else await ipc.wslStartDistro(info.name);
      await useWsl.getState().refresh();
    } catch (e) {
      toast("error", errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const ramPct = host && host.systemMemoryTotal > 0 ? (host.systemMemoryUsed / host.systemMemoryTotal) * 100 : 0;

  return (
    <Panel className="w-[360px]">
      <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Thème</p>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-glass p-1">
        {(
          [
            ["dark", "Sombre", <Moon key="d" size={14} />],
            ["light", "Clair", <Sun key="l" size={14} />],
            ["system", "Système", <Monitor key="s" size={14} />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => void setThemeSetting(id)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] transition-colors",
              theme === id ? "bg-elevated text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      <p className="mt-4 mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Fond d'écran</p>
      <div className="grid grid-cols-5 gap-1.5">
        {WALLPAPERS.map((w) => (
          <button
            key={w}
            type="button"
            title={WALLPAPER_LABELS[w]}
            onClick={() => setWallpaper(w)}
            className={cn(
              "relative h-11 overflow-hidden rounded-lg transition-shadow",
              wallpaper === w ? "ring-2 ring-accent ring-inset" : "ring-1 ring-glass-line ring-inset hover:ring-fg2",
            )}
          >
            <Wallpaper id={w} preview />
          </button>
        ))}
      </div>

      <p className="mt-4 mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Ubuntu (WSL)</p>
      <div className="flex items-center gap-3 rounded-xl bg-glass px-3 py-2.5">
        <span className={cn("h-2 w-2 rounded-full", info?.running ? "bg-ok shadow-[0_0_8px_var(--ok)]" : "bg-faint")} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] text-fg">{info?.name ?? "Aucune distribution"}</p>
          <p className="text-[11px] text-muted">{info ? (info.running ? "Démarrée" : "Arrêtée") : (status?.problem?.message ?? "WSL non détecté")}</p>
        </div>
        {info && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void toggleDistro()}
            className="flex items-center gap-1.5 rounded-lg border border-glass-line px-2.5 py-1 text-[11.5px] text-fg2 hover:bg-glass-hover disabled:opacity-50"
          >
            {info.running ? <Square size={11} /> : <Play size={11} />}
            {busy ? "…" : info.running ? "Arrêter" : "Démarrer"}
          </button>
        )}
      </div>

      {host && (
        <div className="mt-3 space-y-2 rounded-xl bg-glass px-3 py-2.5">
          <Meter label="Mémoire Windows" value={ramPct} text={`${(host.systemMemoryUsed / 1024 ** 3).toFixed(1)} / ${(host.systemMemoryTotal / 1024 ** 3).toFixed(1)} Go`} />
          <Meter label="CPU de rAImy OS" value={Math.min(100, host.appCpuPercent)} text={`${host.appCpuPercent.toFixed(0)} %`} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-4 gap-1.5">
        <Tile icon={<Maximize size={15} />} label="Plein écran" onClick={() => void toggleFullscreen()} />
        <Tile icon={<LayoutPanelLeft size={15} />} label="Workspace" onClick={() => useDesktop.getState().setShellMode("workspace")} />
        <Tile icon={<Minimize2 size={15} />} label="Réduire" onClick={() => void minimizeOs()} />
        <Tile icon={<Power size={15} />} label="Quitter" danger onClick={() => void quitOs()} />
      </div>
    </Panel>
  );
}

function Meter({ label, value, text }: { label: string; value: number; text: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-fg2 tabular-nums">{text}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-glass-hover">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", value > 85 ? "bg-danger" : value > 70 ? "bg-warn" : "bg-accent")}
          style={{ width: `${Math.max(2, value)}%` }}
        />
      </div>
    </div>
  );
}

function Tile({ icon, label, danger, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl bg-glass px-1 py-2.5 text-[11px] transition-colors hover:bg-glass-hover",
        danger ? "text-danger" : "text-fg2",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

const WEEKDAYS = ["lu", "ma", "me", "je", "ve", "sa", "di"];

export function CalendarPanel() {
  const now = useClock(1000);
  const [offset, setOffset] = useState(0);
  const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const startPad = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(startPad).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const isThisMonth = offset === 0;

  return (
    <Panel className="w-[320px]">
      <p className="font-display text-[34px] font-light leading-none text-fg tabular-nums">
        {now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </p>
      <p className="mt-1.5 text-[12.5px] capitalize text-accent">
        {now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </p>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[13px] font-semibold capitalize text-fg">
          {month.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
        </span>
        <div className="flex gap-1">
          <button type="button" aria-label="Mois précédent" onClick={() => setOffset((o) => o - 1)} className="rounded-lg p-1 text-muted hover:bg-glass-hover hover:text-fg">
            <ChevronLeft size={15} />
          </button>
          <button type="button" aria-label="Mois suivant" onClick={() => setOffset((o) => o + 1)} className="rounded-lg p-1 text-muted hover:bg-glass-hover hover:text-fg">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1 text-[10.5px] uppercase text-faint">
            {d}
          </span>
        ))}
        {cells.map((d, i) => (
          <span
            key={i}
            className={cn(
              "flex h-8 items-center justify-center rounded-lg text-[12px] tabular-nums",
              d === null ? "" : isThisMonth && d === now.getDate() ? "bg-accent font-semibold text-onaccent" : "text-fg2 hover:bg-glass-hover",
            )}
          >
            {d}
          </span>
        ))}
      </div>
    </Panel>
  );
}
