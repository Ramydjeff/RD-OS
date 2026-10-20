// Paramètres: the desktop, rAImy Agent, and the existing system settings page.

import { useEffect, useState } from "react";
import { Bot, Keyboard, Monitor, Settings2 } from "lucide-react";
import { AgentSettings } from "@/components/apps/agent/AgentSettings";
import { AppIcon } from "@/components/desktop/AppIcon";
import { useWindow } from "@/components/desktop/windowContext";
import { Wallpaper, WALLPAPER_LABELS } from "@/components/desktop/Wallpaper";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { cn } from "@/lib/cn";
import { useDesktop, WALLPAPERS, type AppId, type IconStyle } from "@/store/desktop";

type Tab = "desktop" | "agent" | "keys" | "system";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "desktop", label: "Bureau", icon: <Monitor size={15} /> },
  { id: "agent", label: "rAImy Agent", icon: <Bot size={15} /> },
  { id: "keys", label: "Raccourcis", icon: <Keyboard size={15} /> },
  { id: "system", label: "Terminal & système", icon: <Settings2 size={15} /> },
];

export const DESKTOP_SHORTCUTS: [string, string][] = [
  ["Ctrl + Maj + Espace", "Rechercher / lancer / demander à rAImy"],
  ["Ctrl + Maj + A", "Ouvrir rAImy Agent"],
  ["Ctrl + Maj + P", "Palette de commandes"],
  ["Ctrl + Alt + T", "Terminal"],
  ["Ctrl + Alt + E", "Nouvelle fenêtre Fichiers"],
  ["Ctrl + Alt + C", "Code Studio"],
  ["Ctrl + Alt + G", "rAImy Academy (guides)"],
  ["Ctrl + Alt + D", "Afficher le bureau"],
  ["Ctrl + Alt + ← / →", "Ancrer la fenêtre à gauche / à droite"],
  ["Ctrl + Alt + ↑ / ↓", "Agrandir / restaurer ou réduire"],
  ["Ctrl + Alt + Page ↑/↓", "Passer d'une fenêtre à l'autre"],
  ["Ctrl + Alt + W", "Fermer la fenêtre active"],
  ["F11", "Plein écran"],
  ["Code Studio : Ctrl + S / Ctrl + Entrée", "Enregistrer / exécuter"],
];

const ICON_STYLES: { id: IconStyle; label: string; hint: string }[] = [
  { id: "signature", label: "Signature", hint: "Obsidienne, glyphes lumineux — l'identité rAImy" },
  { id: "color", label: "Couleur", hint: "Tuiles pleines et vives, glyphes blancs" },
];
const PREVIEW_APPS: AppId[] = ["files", "studio", "terminal", "agent", "guide"];

function DesktopTab() {
  const wallpaper = useDesktop((s) => s.wallpaper);
  const iconStyle = useDesktop((s) => s.iconStyle);
  const showClock = useDesktop((s) => s.showClock);
  const userName = useDesktop((s) => s.userName);
  const shellMode = useDesktop((s) => s.shellMode);
  const d = useDesktop.getState();
  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-3 text-[13px] font-semibold text-fg">Fond d'écran</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {WALLPAPERS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => d.setWallpaper(w)}
              className={cn(
                "overflow-hidden rounded-xl border-2 text-left transition-colors",
                wallpaper === w ? "border-accent" : "border-transparent hover:border-line-strong",
              )}
            >
              <span className="relative block h-24">
                <Wallpaper id={w} preview />
              </span>
              <span className="block bg-surface px-3 py-1.5 text-[12px] text-fg2">{WALLPAPER_LABELS[w]}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-[13px] font-semibold text-fg">Style des icônes</h3>
        <div className="grid max-w-xl grid-cols-2 gap-3">
          {ICON_STYLES.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => d.setIconStyle(st.id)}
              className={cn(
                "overflow-hidden rounded-xl border-2 text-left transition-colors",
                iconStyle === st.id ? "border-accent" : "border-transparent hover:border-line-strong",
              )}
            >
              <span className="relative flex h-20 items-center justify-center gap-2 overflow-hidden">
                <Wallpaper id={wallpaper} preview />
                {PREVIEW_APPS.map((app) => (
                  <AppIcon key={app} app={app} size={34} variant={st.id} className="relative" />
                ))}
              </span>
              <span className="block bg-surface px-3 py-2">
                <span className="block text-[12.5px] font-medium text-fg">{st.label}</span>
                <span className="block text-[11px] text-muted">{st.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <label className="mt-4 flex max-w-xl cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3">
          <span>
            <span className="block text-[12.5px] font-medium text-fg">Horloge du bureau</span>
            <span className="block text-[11px] text-muted">Grande horloge et message d'accueil en haut à droite</span>
          </span>
          <input type="checkbox" checked={showClock} onChange={(e) => d.setShowClock(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
        </label>
      </section>
      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-fg">Votre nom</h3>
        <input
          value={userName}
          onChange={(e) => d.setUserName(e.target.value)}
          placeholder="Affiché dans le menu Démarrer et sur le bureau"
          className="h-9 w-full max-w-sm rounded-lg border border-line bg-bg px-3 text-[13px] outline-none focus:border-accent/60"
        />
      </section>
      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-fg">Interface au démarrage</h3>
        <div className="grid max-w-xl grid-cols-2 gap-2">
          {(
            [
              ["desktop", "Bureau rAImy OS", "Fenêtres, barre des tâches, applications"],
              ["workspace", "Workspace (IDE)", "Explorateur de projet et terminal intégré"],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              onClick={() => d.setShellMode(id)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left",
                shellMode === id ? "border-accent bg-active" : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <span className="block text-[12.5px] font-medium text-fg">{label}</span>
              <span className="block text-[11px] text-muted">{hint}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="flex flex-wrap gap-2">
        <button type="button" onClick={() => d.resetIcons()} className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-fg2 hover:bg-hover">
          Réorganiser les icônes du bureau
        </button>
      </section>
    </div>
  );
}

function KeysTab() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {DESKTOP_SHORTCUTS.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5 last:border-0">
          <span className="text-[12.5px] text-fg2">{v}</span>
          <kbd className="shrink-0 rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[11px] text-fg">{k}</kbd>
        </div>
      ))}
    </div>
  );
}

export default function SettingsApp() {
  const { win } = useWindow();
  const [tab, setTab] = useState<Tab>("desktop");
  useEffect(() => {
    const t = win.args.tab;
    if (t === "desktop" || t === "agent" || t === "keys" || t === "system") setTab(t);
  }, [win.args.nonce, win.args.tab]);

  return (
    <div className="flex h-full">
      <nav className="w-52 shrink-0 space-y-0.5 border-r border-line bg-surface p-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors",
              tab === t.id ? "bg-active font-medium text-fg" : "text-fg2 hover:bg-hover",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {tab === "system" ? (
          <SettingsPage />
        ) : (
          <div className="mx-auto max-w-3xl p-6">
            <h2 className="mb-5 font-display text-[18px] font-semibold text-fg">{TABS.find((t) => t.id === tab)?.label}</h2>
            {tab === "desktop" && <DesktopTab />}
            {tab === "agent" && <AgentSettings />}
            {tab === "keys" && <KeysTab />}
          </div>
        )}
      </div>
    </div>
  );
}
