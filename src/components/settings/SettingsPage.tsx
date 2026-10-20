// Settings page — appearance, terminal, startup, confirmations and shortcuts.

import { useState } from "react";
import { AlertTriangle, RotateCcw, Save } from "lucide-react";
import { RaimyLogo } from "@/components/ui/RaimyLogo";
import { Button } from "@/components/ui/Button";
import { FIELD, Keys, Toggle } from "@/components/ui/Fields";
import { cn } from "@/lib/cn";
import { DEFAULT_SHORTCUTS, formatShortcut } from "@/lib/shortcuts";
import { DEFAULT_SETTINGS, useSettings } from "@/store/settings";
import { useTheme } from "@/store/theme";
import { toast } from "@/store/ui";
import type { CursorStyle, Settings, StartupBehavior, ThemeSetting } from "@/types/ipc";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-3.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-fg">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="eyebrow mb-1">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function Choice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-[var(--radius-sm)] bg-glass p-0.5 shadow-[inset_0_0_0_1px_var(--glass-line)]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-[5px] px-3 text-[12.5px] transition-colors",
            value === o.value ? "bg-elevated text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
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
      className={cn(FIELD, "w-24 font-mono")}
    />
  );
}

export function SettingsPage() {
  const { settings, update, reset, warning } = useSettings();
  const { setSetting: setThemeSetting } = useTheme.getState();
  const [draft, setDraft] = useState<Settings>(() => structuredClone(settings));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

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
      toast("success", "Paramètres enregistrés.");
    }
  }

  async function handleReset() {
    const err = await reset();
    if (err) {
      toast("error", `Réinitialisation impossible : ${err}`);
    } else {
      setDraft(structuredClone(DEFAULT_SETTINGS));
      setThemeSetting(DEFAULT_SETTINGS.theme);
      toast("info", "Paramètres par défaut rétablis.");
    }
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-10 px-8 pb-16 pt-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-fg">Paramètres</h1>
          <p className="mt-1 text-[13px] text-muted">Apparence, terminal, démarrage et raccourcis.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void handleReset()}>
            <RotateCcw size={13} /> Par défaut
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
            <Save size={13} /> {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </header>

      {(warning || saveError) && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warn/40 bg-warn/10 px-3 py-2.5 text-[12.5px] text-fg">
          <AlertTriangle size={14} className="mt-px shrink-0 text-warn" />
          <p className="selectable">{saveError ?? warning}</p>
        </div>
      )}

      <Section title="Apparence">
        <Row label="Thème" hint="« Système » suit le réglage de Windows.">
          <Choice<ThemeSetting>
            value={draft.theme}
            onChange={(v) => patch("theme", v)}
            options={[
              { value: "dark", label: "Sombre" },
              { value: "light", label: "Clair" },
              { value: "system", label: "Système" },
            ]}
          />
        </Row>
      </Section>

      <Section title="Terminal">
        <Row label="Police" hint="Liste de polices séparées par des virgules.">
          <input
            type="text"
            value={draft.terminal.fontFamily}
            placeholder="Cascadia Code, monospace"
            onChange={(e) => patchTerminal("fontFamily", e.target.value)}
            className={cn(FIELD, "w-64 font-mono text-[12px]")}
          />
        </Row>
        <Row label="Taille du texte" hint="Entre 8 et 32 pixels.">
          <NumberInput value={draft.terminal.fontSize} onChange={(v) => patchTerminal("fontSize", v)} min={8} max={32} />
        </Row>
        <Row label="Interligne" hint="Entre 1,0 et 2,0.">
          <NumberInput value={draft.terminal.lineHeight} onChange={(v) => patchTerminal("lineHeight", v)} min={1} max={2} step={0.05} />
        </Row>
        <Row label="Curseur">
          <Choice<CursorStyle>
            value={draft.terminal.cursorStyle}
            onChange={(v) => patchTerminal("cursorStyle", v)}
            options={[
              { value: "block", label: "Bloc" },
              { value: "underline", label: "Souligné" },
              { value: "bar", label: "Barre" },
            ]}
          />
        </Row>
        <Row label="Curseur clignotant">
          <Toggle checked={draft.terminal.cursorBlink} onChange={(v) => patchTerminal("cursorBlink", v)} label="Curseur clignotant" />
        </Row>
        <Row label="Historique" hint="Lignes conservées (500 à 100 000).">
          <NumberInput value={draft.terminal.scrollback} onChange={(v) => patchTerminal("scrollback", v)} min={500} max={100000} step={500} />
        </Row>
        <Row label="Copier à la sélection" hint="Le texte sélectionné est copié automatiquement.">
          <Toggle checked={draft.terminal.copyOnSelect} onChange={(v) => patchTerminal("copyOnSelect", v)} label="Copier à la sélection" />
        </Row>
      </Section>

      <Section title="Démarrage">
        <Row label="Au lancement">
          <select
            value={draft.startup}
            onChange={(e) => patch("startup", e.target.value as StartupBehavior)}
            className={cn(FIELD, "w-60 pr-7")}
          >
            <option value="open_terminal">Ouvrir un terminal</option>
            <option value="empty">Afficher l'accueil</option>
            <option value="restore_project">Rouvrir le dernier projet</option>
          </select>
        </Row>
      </Section>

      <Section title="Confirmations">
        <Row label="Avant de supprimer des fichiers">
          <Toggle checked={draft.confirmations.deleteEntries} onChange={(v) => patchConfirmations("deleteEntries", v)} label="Avant de supprimer des fichiers" />
        </Row>
        <Row label="Avant de fermer un terminal occupé">
          <Toggle checked={draft.confirmations.closeBusyTerminal} onChange={(v) => patchConfirmations("closeBusyTerminal", v)} label="Avant de fermer un terminal occupé" />
        </Row>
        <Row label="Avant de quitter avec des sessions ouvertes">
          <Toggle checked={draft.confirmations.closeAppWithSessions} onChange={(v) => patchConfirmations("closeAppWithSessions", v)} label="Avant de quitter avec des sessions ouvertes" />
        </Row>
        <Row label="Avant d'arrêter une distribution">
          <Toggle checked={draft.confirmations.terminateDistro} onChange={(v) => patchConfirmations("terminateDistro", v)} label="Avant d'arrêter une distribution" />
        </Row>
      </Section>

      <Section title="Raccourcis clavier">
        {DEFAULT_SHORTCUTS.map((s) => (
          <Row key={s.id} label={s.label}>
            <Keys combo={formatShortcut(draft.shortcuts[s.id] ?? s.keys)} />
          </Row>
        ))}
        <p className="pt-3 text-[12px] text-muted">
          Dans le terminal, les raccourcis Ctrl+lettre restent au shell : utilisez la variante avec Maj (par exemple Ctrl+Maj+F).
        </p>
      </Section>

      <section className="flex flex-col items-center gap-3 border-t border-line pt-10 text-center">
        <RaimyLogo size="lg" layout="stacked" withTagline />
        <p className="mt-2 max-w-md text-[12.5px] leading-relaxed text-muted">
          Espace de travail Windows relié à WSL 2 : terminal Linux natif, projets, simulateur de processus UNIX.
        </p>
        <p className="text-[11.5px] text-faint">Version 0.1.0 · Tauri, React et WSL 2</p>
      </section>
    </div>
  );
}
