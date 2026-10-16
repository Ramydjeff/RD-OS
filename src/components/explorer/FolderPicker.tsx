import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openNativeDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUp, ChevronRight, Folder, FolderOpen, Home, LoaderCircle } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { Select, TextInput } from "@/components/ui/Fields";
import { Modal } from "@/components/ui/Modal";
import { errorMessage } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { isMountedWindowsPath, locationDisplay, parentLocation } from "@/lib/paths";
import { useSettings } from "@/store/settings";
import { chooseDistro, usableDistros, useWsl } from "@/store/wsl";
import type { FsEntry, Location } from "@/types/ipc";

interface Props {
  title: string;
  confirmLabel: string;
  initial?: Location | null;
  onSelect: (loc: Location) => void;
  onClose: () => void;
}

type Mode = "linux" | "windows";

/** Browses directories in a WSL distribution or on a Windows drive and returns the chosen folder. */
export function FolderPicker({ title, confirmLabel, initial, onSelect, onClose }: Props) {
  const wsl = useWsl((s) => s.status);
  const distros = usableDistros(wsl);
  const defaultProject = useSettings((s) => s.settings.defaultProjectDir);

  const [mode, setMode] = useState<Mode>(initial?.kind ?? (distros.length > 0 ? "linux" : "windows"));
  const [distro, setDistro] = useState<string>(initial?.kind === "linux" ? initial.distro : (chooseDistro(wsl) ?? ""));
  const [current, setCurrent] = useState<Location | null>(initial ?? null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");

  const navigate = useCallback(async (loc: Location) => {
    setLoading(true);
    setError(null);
    try {
      const listing = await ipc.fsBrowseDirs(loc, false);
      setEntries(listing.entries);
      setTruncated(listing.truncated);
      setCurrent(loc);
      setPathInput(loc.kind === "linux" ? loc.path : loc.path);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial location: given -> default project dir (same mode) -> Linux home / C:\
  useEffect(() => {
    void (async () => {
      if (initial) return navigate(initial);
      if (mode === "linux" && distro) {
        if (defaultProject?.kind === "linux" && defaultProject.distro === distro) return navigate(defaultProject);
        try {
          return navigate({ kind: "linux", distro, path: await ipc.wslLinuxHome(distro) });
        } catch (e) {
          setError(errorMessage(e));
          return navigate({ kind: "linux", distro, path: "/" });
        }
      }
      if (defaultProject?.kind === "windows") return navigate(defaultProject);
      return navigate({ kind: "windows", path: "C:\\" });
    })();
    // Run once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    if (next === "linux" && distro) {
      void ipc
        .wslLinuxHome(distro)
        .then((home) => navigate({ kind: "linux", distro, path: home }))
        .catch((e) => setError(errorMessage(e)));
    } else if (next === "windows") {
      void navigate(defaultProject?.kind === "windows" ? defaultProject : { kind: "windows", path: "C:\\" });
    }
  }

  function changeDistro(name: string) {
    setDistro(name);
    void ipc
      .wslLinuxHome(name)
      .then((home) => navigate({ kind: "linux", distro: name, path: home }))
      .catch((e) => setError(errorMessage(e)));
  }

  async function goToTyped() {
    if (!pathInput.trim()) return;
    try {
      const r = await ipc.fsResolveLocation(pathInput, mode === "linux" ? distro : null);
      if (!r.exists || !r.isDir) {
        setError(`${r.display} is not an existing folder.`);
        return;
      }
      await navigate(r.location);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function browseNative() {
    try {
      const picked = await openNativeDialog({ directory: true, multiple: false, title: "Choose a Windows folder" });
      if (typeof picked === "string") {
        const r = await ipc.fsResolveLocation(picked, null);
        await navigate(r.location);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const parent = useMemo(() => (current ? parentLocation(current) : null), [current]);

  function enter(name: string) {
    if (!current) return;
    void navigate(
      current.kind === "linux"
        ? { ...current, path: `${current.path === "/" ? "" : current.path}/${name}` }
        : { kind: "windows", path: `${current.path.replace(/\\+$/, "")}\\${name}` },
    );
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!current || loading} onClick={() => current && onSelect(current)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Filesystem" className="flex rounded-[var(--radius-sm)] border border-line p-0.5">
            {(["linux", "windows"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={mode === m}
                disabled={m === "linux" && distros.length === 0}
                onClick={() => switchMode(m)}
                className={`rounded-[3px] px-2.5 py-0.5 text-xs ${mode === m ? "bg-active text-fg" : "text-muted hover:text-fg"} disabled:opacity-40`}
              >
                {m === "linux" ? "Linux (WSL)" : "Windows"}
              </button>
            ))}
          </div>
          {mode === "linux" && (
            <Select aria-label="Distribution" value={distro} onChange={(e) => changeDistro(e.target.value)} className="w-48">
              {distros.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
          {mode === "windows" && (
            <Button size="sm" onClick={() => void browseNative()}>
              <FolderOpen size={13} /> Browse...
            </Button>
          )}
        </div>

        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void goToTyped();
          }}
        >
          <IconButton
            label="Up one level"
            icon={<ArrowUp size={14} />}
            disabled={!parent || loading}
            onClick={() => parent && void navigate(parent)}
          />
          {mode === "linux" && distro && (
            <IconButton
              label="Linux home directory"
              icon={<Home size={14} />}
              onClick={() =>
                void ipc
                  .wslLinuxHome(distro)
                  .then((home) => navigate({ kind: "linux", distro, path: home }))
                  .catch((e) => setError(errorMessage(e)))
              }
            />
          )}
          <TextInput
            aria-label="Folder path"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder={mode === "linux" ? "/home/you/projects" : "C:\\Users\\you\\projects"}
            className="font-mono text-xs"
          />
          <Button type="submit" size="sm">
            Go
          </Button>
        </form>

        {current && isMountedWindowsPath(current) && (
          <p className="rounded-[var(--radius-sm)] border border-warn/40 px-2 py-1 text-xs text-warn">
            This is a Windows drive mounted into WSL (/mnt/...). File access is slower than the Linux filesystem; keep Linux-heavy
            projects under your Linux home directory instead.
          </p>
        )}
        {error && (
          <p role="alert" className="selectable text-xs text-danger">
            {error}
          </p>
        )}

        <div
          role="listbox"
          aria-label="Folders"
          className="h-64 overflow-auto rounded-[var(--radius-sm)] border border-line bg-bg"
        >
          {loading && (
            <p className="flex items-center gap-2 p-3 text-xs text-muted">
              <LoaderCircle size={13} className="animate-spin" /> Loading...
            </p>
          )}
          {!loading && entries.length === 0 && !error && <p className="p-3 text-xs text-muted">No sub-folders.</p>}
          {entries.map((e) => (
            <button
              key={e.name}
              type="button"
              role="option"
              aria-selected={false}
              onDoubleClick={() => enter(e.name)}
              onClick={() => enter(e.name)}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] hover:bg-hover"
            >
              <Folder size={14} className="shrink-0 text-accent2" />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <ChevronRight size={12} className="text-muted" />
            </button>
          ))}
          {truncated && <p className="p-2 text-xs text-muted">Only the first entries are shown.</p>}
        </div>
        <p className="selectable truncate font-mono text-xs text-muted">
          Selected: {current ? locationDisplay(current) : "-"}
        </p>
      </div>
    </Modal>
  );
}
