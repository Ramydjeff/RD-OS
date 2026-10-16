import { useState } from "react";
import {
  ClipboardPaste,
  Columns2,
  Copy,
  Eraser,
  FolderInput,
  Maximize2,
  Minimize2,
  PanelBottomClose,
  Plus,
  Power,
  RotateCcw,
  Rows2,
  Search,
} from "lucide-react";
import { FolderPicker } from "@/components/explorer/FolderPicker";
import { IconButton } from "@/components/ui/Button";
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

  return (
    <>
      <div className="flex items-center gap-0.5 px-1.5" role="toolbar" aria-label="Terminal actions">
        {distros.length > 0 && (
          <Select
            aria-label="Distribution for new terminals"
            title="Distribution for new terminals"
            value={current}
            onChange={(e) => setSelectedDistro(e.target.value)}
            className="mr-1 h-6 w-auto max-w-40 text-xs"
          >
            {distros.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
                {d.running ? "" : " (stopped)"}
              </option>
            ))}
          </Select>
        )}
        <IconButton label={tip("New terminal", "terminal.new")} icon={<Plus size={15} />} onClick={() => void openTerminal()} />
        <IconButton label="New terminal in folder..." icon={<FolderInput size={15} />} onClick={() => setPicking(true)} />
        <IconButton
          label="Split side by side"
          icon={<Columns2 size={15} />}
          disabled={!hasTerminal}
          onClick={() => void openTerminal({ split: "row" })}
        />
        <IconButton
          label="Split stacked"
          icon={<Rows2 size={15} />}
          disabled={!hasTerminal}
          onClick={() => void openTerminal({ split: "col" })}
        />
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        <IconButton
          label={tip("Clear visible terminal", "terminal.clear")}
          icon={<Eraser size={15} />}
          disabled={!hasTerminal}
          onClick={() => activeController()?.clear()}
        />
        <IconButton
          label={tip("Search output", "terminal.search")}
          icon={<Search size={15} />}
          disabled={!hasTerminal}
          onClick={() => openSearch()}
        />
        <IconButton
          label="Copy selection (Ctrl+Shift+C)"
          icon={<Copy size={15} />}
          disabled={!hasTerminal}
          onClick={() => void activeController()?.copySelection(false)}
        />
        <IconButton
          label="Paste (Ctrl+V)"
          icon={<ClipboardPaste size={15} />}
          disabled={!running}
          onClick={() => void activeController()?.paste()}
        />
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        <IconButton
          label="Restart session"
          icon={<RotateCcw size={15} />}
          disabled={!hasTerminal}
          onClick={() => terminalId && void restartTerminal(terminalId)}
        />
        <IconButton
          label="Terminate session"
          icon={<Power size={15} />}
          disabled={!running}
          onClick={() => terminalId && void terminateTerminal(terminalId)}
        />
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        <IconButton
          label={maximized ? tip("Restore panel size", "view.maximizePanel") : tip("Maximize terminal panel", "view.maximizePanel")}
          icon={maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          active={maximized}
          onClick={toggleMaximize}
        />
        <IconButton
          label={tip("Hide terminal panel", "view.togglePanel")}
          icon={<PanelBottomClose size={15} />}
          onClick={() => setPanelVisible(false)}
        />
      </div>
      {picking && (
        <FolderPicker
          title="Open terminal in folder"
          confirmLabel="Open terminal here"
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
