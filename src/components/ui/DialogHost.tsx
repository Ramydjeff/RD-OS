import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Fields";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { useUi } from "@/store/ui";

/** Renders whichever confirm/prompt dialog is pending plus the toast stack. */
export function DialogHost() {
  const confirm = useUi((s) => s.confirm);
  const prompt = useUi((s) => s.prompt);
  return (
    <>
      {confirm && (
        <Modal
          key={confirm.id}
          title={confirm.title}
          onClose={() => confirm.resolve(false)}
          hideClose
          width="max-w-md"
          footer={
            <>
              <Button variant="ghost" onClick={() => confirm.resolve(false)} data-autofocus={confirm.danger ? true : undefined}>
                {confirm.cancelLabel}
              </Button>
              <Button
                variant={confirm.danger ? "danger" : "primary"}
                onClick={() => confirm.resolve(true)}
                data-autofocus={confirm.danger ? undefined : true}
              >
                {confirm.confirmLabel}
              </Button>
            </>
          }
        >
          <div className="flex gap-3">
            {confirm.danger && <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />}
            <div className="min-w-0 space-y-2.5">
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-fg2">{confirm.message}</p>
              {confirm.detail && (
                <pre className="selectable max-h-48 overflow-auto rounded-[var(--radius-sm)] border border-line bg-bg px-2.5 py-2 font-mono text-[11.5px] text-fg2">
                  {confirm.detail}
                </pre>
              )}
            </div>
          </div>
        </Modal>
      )}
      {prompt && <PromptDialog key={prompt.id} />}
      <Toasts />
    </>
  );
}

function PromptDialog() {
  const prompt = useUi((s) => s.prompt)!;
  const [value, setValue] = useState(prompt.initial);
  const error = value.length > 0 && prompt.validate ? prompt.validate(value) : null;
  const canSubmit = value.trim().length > 0 && !(prompt.validate?.(value) ?? null);
  const submit = () => canSubmit && prompt.resolve(value);
  return (
    <Modal
      title={prompt.title}
      onClose={() => prompt.resolve(null)}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => prompt.resolve(null)}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {prompt.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-1.5"
      >
        <label htmlFor="prompt-input" className="text-[12px] font-medium text-fg2">
          {prompt.label}
        </label>
        <TextInput id="prompt-input" data-autofocus value={value} onChange={(e) => setValue(e.target.value)} />
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

const TOAST_ICON = {
  info: <Info size={15} className="text-accent2" />,
  success: <CheckCircle2 size={15} className="text-ok" />,
  error: <XCircle size={15} className="text-danger" />,
} as const;

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-9 right-4 z-[60] flex w-[340px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={cn(
            "pop-in pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-md)] border bg-elevated px-3 py-2.5 shadow-[var(--shadow)]",
            t.kind === "error" ? "border-danger/45" : "border-line",
          )}
        >
          <span className="mt-px shrink-0">{TOAST_ICON[t.kind]}</span>
          <p className="selectable min-w-0 flex-1 break-words text-[12.5px] leading-snug text-fg">{t.message}</p>
          <button
            type="button"
            aria-label="Fermer la notification"
            className="-mr-1 shrink-0 rounded p-0.5 text-muted hover:bg-hover hover:text-fg"
            onClick={() => dismiss(t.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
