// API key, model and effort for rAImy Agent. The key goes straight to the
// backend, which stores it and only ever returns a short hint.

import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAgent } from "@/store/agent";
import { toast } from "@/store/ui";
import type { AgentEffort } from "@/types/ipc";

const EFFORTS: { id: AgentEffort; label: string; hint: string }[] = [
  { id: "low", label: "Rapide", hint: "Réponses quasi instantanées, idéal pour les questions simples." },
  { id: "medium", label: "Équilibré", hint: "Le bon réglage pour coder et apprendre au quotidien." },
  { id: "high", label: "Approfondi", hint: "Pour les bugs difficiles et les longs exercices." },
  { id: "xhigh", label: "Expert", hint: "Raisonnement très poussé ; plus lent et plus coûteux." },
];

export function AgentSettings({ onDone }: { onDone?: () => void }) {
  const status = useAgent((s) => s.status);
  const statusError = useAgent((s) => s.statusError);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(status?.model ?? "claude-opus-5-5");
  const [effort, setEffort] = useState<AgentEffort>(status?.effort ?? "medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status) void useAgent.getState().loadStatus();
  }, [status]);
  useEffect(() => {
    if (status) {
      setModel(status.model);
      setEffort(status.effort);
    }
  }, [status]);

  async function save(apiKey?: string) {
    setBusy(true);
    setError(null);
    const err = await useAgent.getState().configure({ apiKey, model, effort });
    setBusy(false);
    if (err) setError(err);
    else {
      setKey("");
      toast("success", apiKey === "" ? "Clé API supprimée." : "Réglages de rAImy Agent enregistrés.");
      onDone?.();
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-fg">
          <KeyRound size={14} className="text-accent" /> Clé API Anthropic
        </h3>
        <p className="mb-3 text-[12px] leading-relaxed text-muted">
          rAImy Agent utilise Claude. Créez une clé sur la console Anthropic, puis collez-la ici. Elle reste sur cet ordinateur,
          dans le dossier de configuration de rAImy OS, et n'est jamais renvoyée à l'interface.
        </p>
        {status?.hasKey && (
          <p className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-fg2">
            <ShieldCheck size={14} className="text-ok" />
            Clé active <span className="font-mono text-muted">{status.keyHint}</span>
            <span className="text-faint">({status.keySource === "env" ? "variable ANTHROPIC_API_KEY" : "enregistrée"})</span>
          </p>
        )}
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={status?.hasKey ? "Remplacer la clé…" : "sk-ant-…"}
            className="h-9 flex-1 rounded-lg border border-line bg-bg px-3 font-mono text-[12.5px] outline-none focus:border-accent/60"
            onKeyDown={(e) => {
              if (e.key === "Enter" && key.trim()) void save(key.trim());
            }}
          />
          <button
            type="button"
            disabled={busy || !key.trim()}
            onClick={() => void save(key.trim())}
            className="rounded-lg bg-accent px-4 text-[12.5px] font-semibold text-onaccent hover:bg-accent-hover disabled:opacity-40"
          >
            Enregistrer
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void openUrl("https://console.anthropic.com/settings/keys").catch(() => undefined)}
            className="flex items-center gap-1 text-[12px] text-accent2 hover:underline"
          >
            Obtenir une clé sur console.anthropic.com <ExternalLink size={11} />
          </button>
          {status?.keySource === "stored" && (
            <button type="button" onClick={() => void save("")} className="text-[12px] text-muted hover:text-danger">
              Supprimer la clé
            </button>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-fg">Modèle</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {(status?.models ?? [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }]).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModel(m.id)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-colors",
                model === m.id ? "border-accent bg-active" : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <span className="flex items-center justify-between text-[12.5px] font-medium text-fg">
                {m.label}
                {model === m.id && <Check size={13} className="text-accent" />}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted">
                {m.id.includes("opus") ? "Le plus capable (recommandé)" : m.id.includes("sonnet") ? "Rapide et très bon en code" : "Le plus économique"}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-fg">Profondeur de réflexion</h3>
        <div className="grid gap-2 sm:grid-cols-4">
          {EFFORTS.map((e) => (
            <button
              key={e.id}
              type="button"
              title={e.hint}
              onClick={() => setEffort(e.id)}
              className={cn(
                "rounded-xl border px-3 py-2 text-[12.5px] transition-colors",
                effort === e.id ? "border-accent bg-active text-fg" : "border-line bg-surface text-fg2 hover:border-line-strong",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-muted">{EFFORTS.find((e) => e.id === effort)?.hint}</p>
      </section>

      {(error || statusError) && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error ?? statusError}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(undefined)}
          className="rounded-lg border border-line px-4 py-2 text-[12.5px] font-medium text-fg hover:bg-hover disabled:opacity-40"
        >
          Enregistrer le modèle et la profondeur
        </button>
      </div>
    </div>
  );
}
