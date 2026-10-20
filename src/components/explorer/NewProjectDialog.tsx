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

/** French names for the backend's templates (same ids as templates.rs). */
const TEMPLATE_FR: Record<string, { label: string; description: string }> = {
  python: { label: "Python", description: "Script Python minimal, prêt pour un environnement virtuel." },
  vision: { label: "Vision par ordinateur", description: "Exemple OpenCV : lire, traiter et enregistrer une image." },
  node: { label: "Node.js", description: "Projet JavaScript avec package.json." },
  cpp: { label: "C++ (CMake)", description: "Programme C++ compilé avec CMake." },
};

const INSTALL_BUILD_TOOLS = "sudo apt update && sudo apt install -y build-essential cmake";

async function suggestionsFor(template: string, name: string, location: Location, result: CreateProjectResult): Promise<Suggestion[]> {
  const q = name.includes(" ") ? `"${name}"` : name;
  switch (template) {
    case "python":
      return [
        { label: "Lancer le programme", command: "python3 main.py" },
        ...(result.venv?.ok
          ? [{ label: "Activer l'environnement virtuel", command: "source .venv/bin/activate" }]
          : [{ label: "Créer un environnement virtuel (facultatif)", command: "python3 -m venv .venv && source .venv/bin/activate" }]),
      ];
    case "vision":
      return [
        {
          label: "Installer OpenCV dans un environnement virtuel",
          command: `${result.venv?.ok ? "" : "python3 -m venv .venv && "}source .venv/bin/activate && pip install -r requirements.txt`,
          note: "Télécharge OpenCV et NumPy (environ 100 Mo). Rien n'est lancé automatiquement.",
        },
        { label: "Lancer l'exemple", command: "python3 main.py input.jpg output.jpg" },
      ];
    case "node":
      return [
        { label: "Lancer le programme", command: "npm start", note: "Nécessite Node.js et npm dans la distribution." },
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
        ? [{ label: "Configurer, compiler et lancer", command: `cmake -S . -B build && cmake --build build && ./build/${q}` }]
        : [
            {
              label: "Installer d'abord le compilateur et CMake",
              command: INSTALL_BUILD_TOOLS,
              note: "g++ ou cmake est introuvable (ou n'a pas pu être vérifié). La compilation sera proposée une fois installés.",
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
          title: "Ce dossier existe déjà",
          message: `« ${name} » existe déjà dans ${locationDisplay(parent)}. Y ajouter les fichiers manquants du modèle ? Les fichiers existants ne sont jamais écrasés.`,
          confirmLabel: "Ajouter les fichiers manquants",
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
        title="Où créer le projet ?"
        confirmLabel="Utiliser ce dossier"
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
        title="Projet créé"
        onClose={onClose}
        width="max-w-xl"
        footer={
          <>
            <Button onClick={() => void openTerminal({ cwd: done.result.location })}>Ouvrir un terminal ici</Button>
            <Button variant="primary" onClick={onClose}>
              Terminé
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-[13px]">
            <Check size={15} className="text-ok" />
            <span className="selectable font-mono text-xs">{locationDisplay(done.result.location)}</span>
          </p>
          <p className="text-xs text-muted">
            Créés : {done.result.created.join(", ") || "aucun nouveau fichier"}
            {done.result.skipped.length > 0 && ` · conservés : ${done.result.skipped.join(", ")}`}
          </p>
          {done.result.venv && (
            <p className={cn("text-xs", done.result.venv.ok ? "text-ok" : "text-warn")}>
              Environnement virtuel : {done.result.venv.message}
            </p>
          )}
          {done.suggestions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[13px] font-semibold text-fg">Étapes suivantes</h3>
              <p className="text-xs text-muted">Les commandes sont insérées dans le terminal actif. Rien ne s'exécute avant que vous appuyiez sur Entrée.</p>
              {done.suggestions.map((s) => (
                <div key={s.command} className="rounded-[var(--radius-sm)] border border-line p-2">
                  <p className="mb-1 text-xs">{s.label}</p>
                  <div className="flex items-center gap-2">
                    <code className="selectable min-w-0 flex-1 break-all rounded-[3px] bg-bg px-1.5 py-1 font-mono text-xs">{s.command}</code>
                    <Button size="sm" onClick={() => insertIntoActive(s.command)}>
                      <ClipboardPaste size={12} /> Insérer
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
      title="Nouveau projet"
      description="Un dossier prêt à l'emploi, créé à partir d'un modèle."
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" disabled={!name || !!nameError || !parent || busy} onClick={() => void create(false)}>
            {busy && <LoaderCircle size={13} className="animate-spin" />} Créer le projet
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-fg2">Modèle</legend>
          <div className="grid grid-cols-2 gap-2">
            {templates.map((t) => (
              <label
                key={t.id}
                className={cn(
                  "cursor-pointer rounded-[var(--radius-sm)] border p-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                  template === t.id ? "border-accent bg-active" : "border-line hover:bg-hover",
                )}
              >
                <input type="radio" name="template" value={t.id} checked={template === t.id} onChange={() => setTemplate(t.id)} className="sr-only" />
                <span className="block text-[13px] font-medium text-fg">{TEMPLATE_FR[t.id]?.label ?? t.label}</span>
                <span className="block text-[12px] text-muted">{TEMPLATE_FR[t.id]?.description ?? t.description}</span>
                <span className="mt-1 block truncate font-mono text-[11px] text-muted">{t.files.join("  ")}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Nom du projet" error={nameError} hint="Lettres, chiffres, « . », « _ » et « - ».">
          {(id) => <TextInput id={id} data-autofocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} />}
        </Field>

        <Field label="Emplacement">
          {(id) => (
            <div className="flex items-center gap-2">
              <TextInput id={id} readOnly value={parent ? locationDisplay(parent) : "Choisissez un dossier…"} className="font-mono text-xs" />
              <Button onClick={() => setPicking(true)}>
                <FolderOpen size={13} /> Parcourir…
              </Button>
            </div>
          )}
        </Field>

        {warnMounted && (
          <p className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warn/40 p-2 text-xs text-warn">
            <TriangleAlert size={14} className="mt-px shrink-0" />
            Cet emplacement est sur le système de fichiers Windows : les outils Linux y sont nettement plus lents. Pour Python, C/C++ ou
            OpenCV, choisissez plutôt un dossier dans votre dossier personnel Linux.
          </p>
        )}

        {(template === "python" || template === "vision") && (
          <div>
            <Switch
              checked={venv && canVenv}
              disabled={!canVenv}
              onChange={setVenv}
              label="Créer un environnement virtuel (.venv)"
              description={canVenv ? "Créé dans la distribution après l'écriture des fichiers." : "Disponible pour les projets situés dans une distribution WSL."}
            />
            {venv && canVenv && (
              <p className="font-mono text-xs text-muted">
                Commande : <span className="text-fg">python3 -m venv .venv</span>
              </p>
            )}
          </div>
        )}

        {selected && selected.id === "cpp" && (
          <p className="text-xs text-muted">
            La compilation n'est proposée après la création que si un compilateur et CMake sont installés dans la distribution.
          </p>
        )}
        {error && (
          <p role="alert" className="selectable text-xs text-danger">
            {error}
          </p>
        )}
        <Badge>{selected ? `${selected.files.length} fichiers` : "Chargement des modèles…"}</Badge>
      </div>
    </Modal>
  );
}
