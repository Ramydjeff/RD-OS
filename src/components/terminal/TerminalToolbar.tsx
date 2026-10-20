import { useState } from "react";
import {
  ClipboardPaste,
  Columns2,
  Copy,
  Eraser,
  Ellipsis,
  FolderInput,
  Maximize2,
  Minimize2,
  PanelBottomClose,
  Power,
  RotateCcw,
  Rows2,
  Search,
} from "lucide-react";
import { FolderPicker } from "@/components/explorer/FolderPicker";
import { IconButton } from "@/components/ui/Button";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { Select } from "@/components/ui/Fields";
import {
  activeController,
  openSearch,
  openTerminal,
  restartTerminal,
  terminateTerminal,
} from "@/features/terminalActions";
import { formatShortcut, resolveBindings } from "@/lib/shortcuts";
import { useSettings } from "@/store/settings";
import { activeTerminalId, useTerminals } from "@/store/terminals";
import { chooseDistro, usableDistros, useWsl } from "@/store/wsl";
import { useWorkspace } from "@/store/workspace";

export function TerminalToolbar() {
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const status = useWsl((s) => s.status);
  const selectedDistro = useWorkspace((s) => s.selectedDistro);
  const setSelectedDistro = useWorkspace((s) => s.setSelectedDistro);
  const maximized = useWorkspace((s) => s.panelMaximized);
  const toggleMaximize = useWorkspace((s) => s.toggleMaximize);
  const setPanelVisible = useWorkspace((s) => s.setPanelVisible);
  const shortcuts = useSettings((s) => s.settings.shortcuts);

  const terminalId = useTerminals(() => activeTerminalId());
  const state = useTerminals((s) => (terminalId ? s.meta[terminalId]?.state : undefined));
  const hasTerminal = terminalId !== null;
  const running = state === "running";

  const distros = usableDistros(status);
  const current = selectedDistro && distros.some((d) => d.name === selectedDistro) ? selectedDistro : (chooseDistro(status) ?? "");
  const keys = resolveBindings(shortcuts);
  const tip = (label: string, id?: string) => {
    const k = id ? keys.get(id) : undefined;
    return k ? `${label} (${formatShortcut(k)})` : label;
  };

  const more: (MenuItem | "separator")[] = [
    { id: "in-folder", label: "Nouveau terminal dans un dossier…", icon: <FolderInput size={14} />, onSelect: () => setPicking(true) },
    "separator",
    {
      id: "copy",
      label: "Copier la sélection",
      icon: <Copy size={14} />,
      hint: "Ctrl+Maj+C",
      disabled: !hasTerminal,
      onSelect: () => void activeController()?.copySelection(false),
    },
    { id: "paste", label: "Coller", icon: <ClipboardPaste size={14} />, hint: "Ctrl+V", disabled: !running, onSelect: () => void activeController()?.paste() },
    {
      id: "clear",
      label: "Effacer l'écran",
      icon: <Eraser size={14} />,
      hint: keys.get("terminal.clear") ? formatShortcut(keys.get("terminal.clear")!) : undefined,
      disabled: !hasTerminal,
      onSelect: () => activeController()?.clear(),
    },
    "separator",
    {
      id: "restart",
      label: "Redémarrer la session",
      icon: <RotateCcw size={14} />,
      disabled: !hasTerminal,
      onSelect: () => terminalId && void restartTerminal(terminalId),
    },
    {
      id: "terminate",
      label: "Arrêter la session",
      icon: <Power size={14} />,
      danger: true,
      disabled: !running,
      onSelect: () => terminalId && void terminateTerminal(terminalId),
    },
  ];

  return (
    <>
      <div className="flex items-center gap-0.5 px-1.5" role="toolbar" aria-label="Actions du terminal">
        {distros.length > 0 && (
          <Select
            aria-label="Distribution des nouveaux terminaux"
            title="Distribution utilisée par les nouveaux terminaux"
            value={current}
            onChange={(e) => setSelectedDistro(e.target.value)}
            className="mr-1 h-[26px] w-auto max-w-44 border-line bg-transparent pl-2 text-[12px]"
          >
            {distros.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
                {d.running ? "" : " (arrêtée)"}
              </option>
            ))}
          </Select>
        )}
        <IconButton
          label="Diviser côte à côte"
          icon={<Columns2 size={15} />}
          disabled={!hasTerminal}
          onClick={() => void openTerminal({ split: "row" })}
        />
        <IconButton
          label="Diviser en hauteur"
          icon={<Rows2 size={15} />}
          disabled={!hasTerminal}
          onClick={() => void openTerminal({ split: "col" })}
        />
        <IconButton
          label={tip("Rechercher dans la sortie", "terminal.search")}
          icon={<Search size={15} />}
          disabled={!hasTerminal}
          onClick={() => openSearch()}
        />
        <IconButton
          label="Plus d'actions"
          icon={<Ellipsis size={15} />}
          active={menu !== null}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right - 220, y: r.bottom + 4 });
          }}
        />
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        <IconButton
          label={maximized ? tip("Restaurer la taille du panneau", "view.maximizePanel") : tip("Agrandir le terminal", "view.maximizePanel")}
          icon={maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          active={maximized}
          onClick={toggleMaximize}
        />
        <IconButton
          label={tip("Masquer le terminal", "view.togglePanel")}
          icon={<PanelBottomClose size={15} />}
          onClick={() => setPanelVisible(false)}
        />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={more} onClose={() => setMenu(null)} />}
      {picking && (
        <FolderPicker
          title="Ouvrir un terminal dans un dossier"
          confirmLabel="Ouvrir le terminal ici"
          onClose={() => setPicking(false)}
          onSelect={(loc) => {
            setPicking(false);
            void openTerminal({ cwd: loc });
          }}
        />
      )}
    </>
  );
}
