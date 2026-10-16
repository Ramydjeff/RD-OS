// Settings page — terminal appearance, theme, shortcuts and confirmations.

import { useState } from "react";
import { AlertTriangle, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { DEFAULT_SHORTCUTS, formatShortcut } from "@/lib/shortcuts";
import { DEFAULT_SETTINGS, useSettings } from "@/store/settings";
import { useTheme } from "@/store/theme";
import { toast } from "@/store/ui";
import type { CursorStyle, Settings, StartupBehavior, ThemeSetting } from "@/types/ipc";

// ─── Small form primitives ────────────────────────────────────────────────────

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-line last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-7 rounded-[var(--radius-sm)] border border-line bg-elevated px-2 text-[13px] text-fg focus-visible:outline"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function NumberInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-7 w-24 rounded-[var(--radius-sm)] border border-line bg-elevated px-2 font-mono text-[13px] text-fg focus-visible:outline"
    />
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-56 rounded-[var(--radius-sm)] border border-line bg-elevated px-2 text-[13px] text-fg focus-visible:outline"
    />
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
        checked ? "bg-accent" : "bg-line",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SettingsPage() {
  const { settings, update, reset, warning } = useSettings();
  const { setSetting: setThemeSetting } = useTheme.getState();
  const [draft, setDraft] = useState<Settings>(() => structuredClone(settings));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaveError(null);
  }
  function patchTerminal<K extends keyof Settings["terminal"]>(key: K, value: Settings["terminal"][K]) {
    setDraft((d) => ({ ...d, terminal: { ...d.terminal, [key]: value } }));
    setSaveError(null);
  }
  function patchConfirmations<K extends keyof Settings["confirmations"]>(key: K, value: boolean) {
    setDraft((d) => ({ ...d, confirmations: { ...d.confirmations, [key]: value } }));
    setSaveError(null);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const err = await update(() => draft);
    setSaving(false);
    if (err) {
      setSaveError(err);
    } else {
      setThemeSetting(draft.theme);
      toast("success", "Settings saved.");
    }
  }

  async function handleReset() {
    const err = await reset();
    if (err) {
      toast("error", `Reset failed: ${err}`);
    } else {
      setDraft(structuredClone(DEFAULT_SETTINGS));
      setThemeSetting(DEFAULT_SETTINGS.theme);
      toast("info", "Settings reset to defaults.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Settings</h1>
          <p className="text-xs text-muted">Configure appearance, terminal behaviour and shortcuts.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void handleReset()}>
            <RotateCcw size={13} /> Reset defaults
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            <Save size={13} /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {(warning || saveError) && (
        <div className="flex items-start gap-2 rounded-md border border-warn/50 bg-surface p-3 text-xs text-warn">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <p className="selectable">{saveError ?? warning}</p>
        </div>
      )}

      {/* ── Appearance ─────────────────────────────────────────────── */}
      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Appearance</h2>
        <Row label="Theme" hint="Controls the colour scheme of the application.">
          <Select<ThemeSetting>
            value={draft.theme}
            onChange={(v) => patch("theme", v)}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
            ]}
          />
        </Row>
      </section>

      {/* ── Terminal ───────────────────────────────────────────────── */}
      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Terminal</h2>
        <Row label="Font family" hint="Comma-separated list of font names.">
          <TextInput value={draft.terminal.fontFamily} onChange={(v) => patchTerminal("fontFamily", v)} placeholder="Cascadia Code, monospace" />
        </Row>
        <Row label="Font size" hint="Between 8 and 32 pixels.">
          <NumberInput value={draft.terminal.fontSize} onChange={(v) => patchTerminal("fontSize", v)} min={8} max={32} />
        </Row>
        <Row label="Line height" hint="Between 1.0 and 2.0.">
          <NumberInput value={draft.terminal.lineHeight} onChange={(v) => patchTerminal("lineHeight", v)} min={1} max={2} step={0.05} />
        </Row>
        <Row label="Cursor style">
          <Select<CursorStyle>
            value={draft.terminal.cursorStyle}
            onChange={(v) => patchTerminal("cursorStyle", v)}
            options={[
              { value: "block", label: "Block" },
              { value: "underline", label: "Underline" },
              { value: "bar", label: "Bar" },
            ]}
          />
        </Row>
        <Row label="Cursor blink">
          <Toggle checked={draft.terminal.cursorBlink} onChange={(v) => patchTerminal("cursorBlink", v)} />
        </Row>
        <Row label="Scrollback" hint="Lines kept in history (500–100 000).">
          <NumberInput value={draft.terminal.scrollback} onChange={(v) => patchTerminal("scrollback", v)} min={500} max={100000} step={500} />
        </Row>
        <Row label="Copy on select" hint="Automatically copy selected text to the clipboard.">
          <Toggle checked={draft.terminal.copyOnSelect} onChange={(v) => patchTerminal("copyOnSelect", v)} />
        </Row>
      </section>

      {/* ── Startup ────────────────────────────────────────────────── */}
      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Startup</h2>
        <Row label="On launch">
          <Select<StartupBehavior>
            value={draft.startup}
            onChange={(v) => patch("startup", v)}
            options={[
              { value: "open_terminal", label: "Open a new terminal" },
              { value: "empty", label: "Show empty workspace" },
              { value: "restore_project", label: "Restore last project" },
            ]}
          />
        </Row>
      </section>

      {/* ── Confirmations ──────────────────────────────────────────── */}
      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Confirmations</h2>
        <Row label="Ask before deleting files">
          <Toggle checked={draft.confirmations.deleteEntries} onChange={(v) => patchConfirmations("deleteEntries", v)} />
        </Row>
        <Row label="Ask before closing a busy terminal">
          <Toggle checked={draft.confirmations.closeBusyTerminal} onChange={(v) => patchConfirmations("closeBusyTerminal", v)} />
        </Row>
        <Row label="Ask before quitting with open sessions">
          <Toggle checked={draft.confirmations.closeAppWithSessions} onChange={(v) => patchConfirmations("closeAppWithSessions", v)} />
        </Row>
        <Row label="Ask before stopping a distribution">
          <Toggle checked={draft.confirmations.terminateDistro} onChange={(v) => patchConfirmations("terminateDistro", v)} />
        </Row>
      </section>

      {/* ── Keyboard shortcuts ─────────────────────────────────────── */}
      <section className="rounded-md border border-line bg-surface p-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Keyboard shortcuts</h2>
        <p className="mb-3 text-xs text-muted">
          These are the default bindings. Customisation via the settings file is planned for a future release.
        </p>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
              <th className="py-2 pr-6 text-left">Action</th>
              <th className="py-2 text-left">Shortcut</th>
            </tr>
          </thead>
          <tbody>
            {DEFAULT_SHORTCUTS.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="py-2 pr-6 text-[13px]">{s.label}</td>
                <td className="py-2 font-mono text-xs text-muted">{formatShortcut(draft.shortcuts[s.id] ?? s.keys)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── About rAImy Solutions ─────────────────────────────────── */}
      <section className="rounded-md border border-line bg-surface p-6 flex flex-col items-center text-center space-y-3">
        <div className="flex items-baseline font-sans text-xl font-medium tracking-tight">
          <span className="text-white">r</span>
          <span className="text-[#D6303A] font-extrabold text-2xl">AI</span>
          <span className="text-[#D6E7F3] font-semibold text-2xl">my</span>
          <span className="ml-2 text-white font-normal text-2xl">Solutions</span>
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#D6E7F3]">
          Visual Computing &amp; Intelligent Hardware
        </p>
        <p className="max-w-md text-xs text-muted">
          Unified desktop workspace connecting Windows to high-performance WSL 2 Linux subsystems,
          streamlined for computer vision, AI development, and intelligent hardware engineering.
        </p>
        <div className="flex items-center gap-2 pt-2 text-[11px] text-muted">
          <span>Version 0.1.0</span>
          <span>•</span>
          <span>Tauri + React + WSL 2</span>
          <span>•</span>
          <span className="text-[#D6303A] font-medium">Production Build</span>
        </div>
      </section>
    </div>
  );
}
