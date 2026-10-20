// The rAImy OS app catalogue: names, icons and the component each window shows.
// Heavy apps load on first open so the desktop itself starts instantly.

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import {
  Activity,
  Bot,
  Boxes,
  Code2,
  FolderOpen,
  GitFork,
  GraduationCap,
  LayoutGrid,
  Settings,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import type { GlyphId, ToneId } from "@/components/desktop/iconography";
import type { AppId } from "@/store/desktop";

export interface AppMeta {
  id: AppId;
  name: string;
  /** One line shown in the start menu and the launcher. */
  blurb: string;
  /** Small UI icon (menus, lists). */
  icon: LucideIcon;
  /** Desktop tile: colour family and glyph (see iconography.tsx). */
  tone: ToneId;
  glyph: GlyphId;
  keywords: string;
  component: LazyExoticComponent<ComponentType>;
}

const FilesApp = lazy(() => import("@/components/apps/files/FilesApp"));
const StudioApp = lazy(() => import("@/components/apps/studio/StudioApp"));
const TerminalApp = lazy(() => import("@/components/apps/TerminalApp"));
const AgentApp = lazy(() => import("@/components/apps/agent/AgentApp"));
const GuideApp = lazy(() => import("@/components/apps/guide/GuideApp"));
const WinAppsApp = lazy(() => import("@/components/apps/WinAppsApp"));
const MonitorApp = lazy(() => import("@/components/apps/MonitorApp"));
const EnvironmentsApp = lazy(() => import("@/components/apps/EnvironmentsApp"));
const SimulatorApp = lazy(() => import("@/components/apps/SimulatorApp"));
const SettingsApp = lazy(() => import("@/components/apps/SettingsApp"));

export const APPS: Record<AppId, AppMeta> = {
  files: {
    id: "files",
    name: "Fichiers",
    blurb: "Explorer Windows et Linux, ouvrir, exécuter",
    icon: FolderOpen,
    tone: "amber",
    glyph: "folder",
    keywords: "explorer dossier fichier files folder disque wsl home",
    component: FilesApp,
  },
  studio: {
    id: "studio",
    name: "Code Studio",
    blurb: "Python, C et C++ : éditer, compiler, exécuter",
    icon: Code2,
    tone: "violet",
    glyph: "code",
    keywords: "editeur ide code python c c++ cpp gcc g++ compiler run",
    component: StudioApp,
  },
  terminal: {
    id: "terminal",
    name: "Terminal",
    blurb: "Shell Ubuntu via WSL 2",
    icon: TerminalSquare,
    tone: "frost",
    glyph: "terminal",
    keywords: "shell bash console ubuntu linux wsl commande",
    component: TerminalApp,
  },
  agent: {
    id: "agent",
    name: "rAImy Agent",
    blurb: "Votre assistant IA de programmation",
    icon: Bot,
    tone: "coral",
    glyph: "spark",
    keywords: "ia ai assistant claude chat aide expliquer corriger",
    component: AgentApp,
  },
  guide: {
    id: "guide",
    name: "rAImy Academy",
    blurb: "Guides : installation, Ubuntu, Python, C, C++",
    icon: GraduationCap,
    tone: "teal",
    glyph: "academy",
    keywords: "guide aide tutoriel installation ubuntu wsl apprendre cours documentation",
    component: GuideApp,
  },
  apps: {
    id: "apps",
    name: "Applications",
    blurb: "Lancer vos programmes Windows (.exe)",
    icon: LayoutGrid,
    tone: "sky",
    glyph: "grid",
    keywords: "exe programmes windows lancer launcher applications raccourcis",
    component: WinAppsApp,
  },
  monitor: {
    id: "monitor",
    name: "Moniteur",
    blurb: "CPU, mémoire, WSL et sessions",
    icon: Activity,
    tone: "mint",
    glyph: "gauge",
    keywords: "gestionnaire taches task manager cpu ram memoire performance",
    component: MonitorApp,
  },
  environments: {
    id: "environments",
    name: "Ubuntu & WSL",
    blurb: "Distributions Linux et diagnostics",
    icon: Boxes,
    tone: "ember",
    glyph: "cube",
    keywords: "wsl ubuntu distribution linux environnement diagnostic outils",
    component: EnvironmentsApp,
  },
  simulator: {
    id: "simulator",
    name: "Simulateur UNIX",
    blurb: "fork, exec, wait : visualiser les processus",
    icon: GitFork,
    tone: "cyan",
    glyph: "fork",
    keywords: "processus fork exec wait unix systeme simulation pid zombie",
    component: SimulatorApp,
  },
  settings: {
    id: "settings",
    name: "Paramètres",
    blurb: "Bureau, agent IA, terminal, raccourcis",
    icon: Settings,
    tone: "mist",
    glyph: "sliders",
    keywords: "parametres reglages settings preferences theme fond ecran cle api",
    component: SettingsApp,
  },
};
