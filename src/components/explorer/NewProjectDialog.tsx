import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardPaste, FolderOpen, LoaderCircle, TriangleAlert } from "lucide-react";
import { FolderPicker } from "@/components/explorer/FolderPicker";
import { Button } from "@/components/ui/Button";
import { Badge, Field, Switch, TextInput } from "@/components/ui/Fields";
import { Modal } from "@/components/ui/Modal";
import { insertIntoActive, openTerminal } from "@/features/terminalActions";
import { AppError, errorMessage, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { isMountedWindowsPath, locationDisplay, validateProjectName } from "@/lib/paths";
import { useSettings } from "@/store/settings";
import { confirmDialog } from "@/store/ui";
import { chooseDistro, useWsl } from "@/store/wsl";
import { useWorkspace } from "@/store/workspace";
import type { CreateProjectResult, Location, TemplateInfo } from "@/types/ipc";
import { cn } from "@/lib/cn";

interface Suggestion {
  label: string;
  command: string;
  note?: string;
}

const INSTALL_BUILD_TOOLS = "sudo apt update && sudo apt install -y build-essential cmake";

async function suggestionsFor(template: string, name: string, location: Location, result: CreateProjectResult): Promise<Suggestion[]> {
  const q = name.includes(" ") ? `"${name}"` : name;
  switch (template) {
    case "python":
      return [
        { label: "Run the program", command: "python3 main.py" },
        ...(result.venv?.ok
          ? [{ label: "Activate the virtual environment", command: "source .venv/bin/activate" }]
          : [{ label: "Create a virtual environment (optional)", command: "python3 -m venv .venv && source .venv/bin/activate" }]),
      ];
    case "vision":
      return [
        {
          label: "Install OpenCV into a virtual environment",
          command: `${result.venv?.ok ? "" : "python3 -m venv .venv && "}source .venv/bin/activate && pip install -r requirements.txt`,
          note: "Downloads OpenCV and NumPy (roughly 100 MB). It is not run automatically.",
        },
        { label: "Run the example", command: "python3 main.py input.jpg output.jpg" },
      ];
    case "node":
      return [
        { label: "Run the program", command: "npm start", note: "Needs Node.js and npm in your distribution." },
      ];
    case "cpp": {
      // Only offer the build when a compiler and CMake are really installed.
      let ready = false;
      if (location.kind === "linux") {
        try {
          const d = await ipc.envDiagnostics(location.distro);
          const found = (c: string) => d.tools.find((t) => t.command === c)?.found ?? false;
          ready = found("g++") && found("cmake");
        } catch {
          ready = false;
        }
      }
      return ready
        ? [{ label: "Configure, build and run", command: `cmake -S . -B build && cmake --build build && ./build/${q}` }]
        : [
            {
              label: "Install the compiler and CMake first",
              command: INSTALL_BUILD_TOOLS,
              note: "g++ and/or cmake were not found (or could not be checked). The build is offered once they are installed.",
            },
          ];
    }
    default:
      return [];
  }
}

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const wsl = useWsl((s) => s.status);
  const defaultDir = useSettings((s) => s.settings.defaultProjectDir);
  const openProject = useWorkspace((s) => s.openProject);

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState("python");
  const [name, setName] = useState("");
  const [parent, setParent] = useState<Location | null>(defaultDir);
  const [venv, setVenv] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: CreateProjectResult; name: string; template: string; suggestions: Suggestion[] } | null>(null);

  useEffect(() => {
    void ipc.projectTemplates().then(setTemplates).catch((e) => setError(errorMessage(e)));
  }, []);

  // Default location: the Linux home of the chosen distribution.
  useEffect(() => {
    if (parent) return;
    const distro = chooseDistro(wsl);
    if (!distro) return;
    void ipc
      .wslLinuxHome(distro)
      .then((home) => setParent({ kind: "linux", distro, path: home }))
      .catch(() => undefined);
  }, [parent, wsl]);

  const nameError = name ? validateProjectName(name) : null;
  const canVenv = (template === "python" || template === "vision") && parent?.kind === "linux";
  const selected = useMemo(() => templates.find((t) => t.id === template), [templates, template]);

  async function create(allowExisting: boolean) {
    if (!parent) return;
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.projectCreate({ parent, name, template, allowExisting, createVenv: venv && canVenv });
      const suggestions = await suggestionsFor(template, name, result.location, result);
      setDone({ result, name, template, suggestions });
      openProject(result.location);
    } catch (e) {
      const err = toAppError(e);
      if (err instanceof AppError && err.kind === "already_exists" && !allowExisting) {
        const ok = await confirmDialog({
          title: "Folder already exists",
          message: `"${name}" already exists in ${locationDisplay(parent)}. Add the template's missing files to it? Existing files are never overwritten.`,
          confirmLabel: "Add missing files",
        });
        if (ok) return create(true);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <FolderPicker
        title="Choose where to create the project"
        confirmLabel="Use this folder"
        initial={parent}
        onClose={() => setPicking(false)}
        onSelect={(loc) => {
          setParent(loc);
          setPicking(false);
        }}
      />
    );
  }

  if (done) {
    return (
      <Modal
        title="Project created"
        onClose={onClose}
        width="max-w-xl"
        footer={
          <>
            <Button onClick={() => void openTerminal({ cwd: done.result.location })}>Open terminal here</Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-[13px]">
            <Check size={15} className="text-accent" />
            <span className="selectable font-mono text-xs">{locationDisplay(done.result.location)}</span>
          </p>
          <p className="text-xs text-muted">
            Created: {done.result.created.join(", ") || "nothing new"}
            {done.result.skipped.length > 0 && ` · kept existing: ${done.result.skipped.join(", ")}`}
          </p>
          {done.result.venv && (
            <p className={cn("text-xs", done.result.venv.ok ? "text-accent" : "text-warn")}>
              Virtual environment: {done.result.venv.message}
            </p>
          )}
          {done.suggestions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold">Next steps</h3>
              <p className="text-xs text-muted">Commands are inserted at the prompt of your active terminal. Nothing runs until you press Enter.</p>
              {done.suggestions.map((s) => (
                <div key={s.command} className="rounded-[var(--radius-sm)] border border-line p-2">
                  <p className="mb-1 text-xs">{s.label}</p>
                  <div className="flex items-center gap-2">
                    <code className="selectable min-w-0 flex-1 break-all rounded-[3px] bg-bg px-1.5 py-1 font-mono text-xs">{s.command}</code>
                    <Button size="sm" onClick={() => insertIntoActive(s.command)}>
                      <ClipboardPaste size={12} /> Insert
                    </Button>
                  </div>
                  {s.note && <p className="mt-1 text-xs text-muted">{s.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  const warnMounted = parent && (parent.kind === "windows" || isMountedWindowsPath(parent));

  return (
    <Modal
      title="New project from template"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name || !!nameError || !parent || busy} onClick={() => void create(false)}>
            {busy && <LoaderCircle size={13} className="animate-spin" />} Create project
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted">Template</legend>
          <div className="grid grid-cols-2 gap-2">
            {templates.map((t) => (
              <label
                key={t.id}
                className={cn(
                  "cursor-pointer rounded-[var(--radius-sm)] border p-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent2",
                  template === t.id ? "border-accent bg-hover" : "border-line hover:bg-hover",
                )}
              >
                <input type="radio" name="template" value={t.id} checked={template === t.id} onChange={() => setTemplate(t.id)} className="sr-only" />
                <span className="block text-[13px] font-medium">{t.label}</span>
                <span className="block text-xs text-muted">{t.description}</span>
                <span className="mt-1 block truncate font-mono text-[11px] text-muted">{t.files.join("  ")}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Project name" error={nameError} hint="Letters, digits, '.', '_' and '-'.">
          {(id) => <TextInput id={id} data-autofocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} />}
        </Field>

        <Field label="Location">
          {(id) => (
            <div className="flex items-center gap-2">
              <TextInput id={id} readOnly value={parent ? locationDisplay(parent) : "Choose a folder..."} className="font-mono text-xs" />
              <Button onClick={() => setPicking(true)}>
                <FolderOpen size={13} /> Browse...
              </Button>
            </div>
          )}
        </Field>

        {warnMounted && (
          <p className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warn/40 p-2 text-xs text-warn">
            <TriangleAlert size={14} className="mt-px shrink-0" />
            This location is on the Windows filesystem. Linux tools run noticeably slower there. For Python, C/C++ or OpenCV work,
            choose a folder under your Linux home directory.
          </p>
        )}

        {(template === "python" || template === "vision") && (
          <div>
            <Switch
              checked={venv && canVenv}
              disabled={!canVenv}
              onChange={setVenv}
              label="Create a virtual environment (.venv)"
              description={canVenv ? "Runs in the distribution after the files are written." : "Available for projects inside a WSL distribution."}
            />
            {venv && canVenv && (
              <p className="font-mono text-xs text-muted">
                Command: <span className="text-fg">python3 -m venv .venv</span>
              </p>
            )}
          </div>
        )}

        {selected && selected.id === "cpp" && (
          <p className="text-xs text-muted">
            The build step is offered after creation only if a compiler and CMake are installed in the distribution.
          </p>
        )}
        {error && (
          <p role="alert" className="selectable text-xs text-danger">
            {error}
          </p>
        )}
        <Badge>{selected ? `${selected.files.length} files` : "Loading templates..."}</Badge>
      </div>
    </Modal>
  );
}
