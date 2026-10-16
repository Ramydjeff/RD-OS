import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const FIELD =
  "h-7 w-full rounded-[var(--radius-sm)] border border-line bg-bg px-2 text-[13px] text-fg placeholder:text-muted/70 " +
  "focus-visible:border-accent2 disabled:opacity-50";

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...props },
  ref,
) {
  return <input ref={ref} spellCheck={false} autoComplete="off" className={cn(FIELD, className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(FIELD, "pr-6", className)} {...props}>
      {children}
    </select>
  );
});

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[13px]">
          {label}
        </label>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-4 w-7 shrink-0 rounded-full border transition-colors disabled:opacity-50",
          checked ? "border-accent bg-accent" : "border-line bg-elevated",
        )}
      >
        <span
          className={cn(
            "absolute top-[1px] h-3 w-3 rounded-full transition-all",
            checked ? "left-[13px] bg-onaccent" : "left-[1px] bg-muted",
          )}
        />
      </button>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-line bg-elevated px-1 py-px font-mono text-[11px] text-muted">{children}</kbd>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "brand" | "warn" | "bad" }) {
  const tones = {
    neutral: "border-line text-muted bg-surface/50",
    good: "border-[#4ADE80]/40 text-[#4ADE80] bg-[#4ADE80]/10",
    brand: "border-accent/40 text-accent bg-accent/10",
    warn: "border-warn/40 text-warn bg-warn/10",
    bad: "border-danger/40 text-danger bg-danger/10",
  } as const;
  return (
    <span className={cn("inline-flex items-center rounded-[3px] border px-1.5 py-px text-[11px] leading-4", tones[tone])}>
      {children}
    </span>
  );
}
