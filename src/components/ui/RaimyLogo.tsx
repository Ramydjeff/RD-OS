import { cn } from "@/lib/cn";
import { MARK_HEIGHT, MARK_LAYERS, MARK_WIDTH } from "@/components/ui/brandMark";

const TONE_FILL = {
  shadow: "var(--mark-shadow)",
  back: "var(--mark-back)",
  front: "var(--mark-front)",
} as const;

export interface RaimyIconProps {
  /** Height in pixels; the width follows the mark's proportions. */
  size?: number;
  className?: string;
  /** Accessible name. Leave empty when a visible wordmark already names the brand. */
  title?: string;
}

/** The official rAImy mark (traced vector, three tones that follow the theme). */
export function RaimyIcon({ size = 24, className, title }: RaimyIconProps) {
  return (
    <svg
      width={Math.round((size * MARK_WIDTH) / MARK_HEIGHT)}
      height={size}
      viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0 select-none", className)}
    >
      {MARK_LAYERS.map((l) => (
        <path key={l.tone} d={l.d} fill={TONE_FILL[l.tone]} fillRule="evenodd" />
      ))}
    </svg>
  );
}

/** "rAImy Solutions" set in Outfit, as in the official logo. */
export function RaimyWordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-baseline whitespace-nowrap font-display leading-none tracking-[-0.015em]", className)}>
      <span className="font-[650] text-[var(--brand-word)]">
        r<span className="text-[var(--brand-ai)]">AI</span>my
      </span>
      {!compact && <span className="ml-[0.28em] font-light text-[var(--brand-word)]">Solutions</span>}
    </span>
  );
}

export function RaimyTagline({ className }: { className?: string }) {
  return (
    <span className={cn("block whitespace-nowrap font-display font-[450] uppercase tracking-[0.28em] text-[var(--brand-tagline)]", className)}>
      Visual Computing &amp; Intelligent Hardware
    </span>
  );
}

export interface RaimyLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  layout?: "horizontal" | "stacked" | "icon";
  withTagline?: boolean;
  className?: string;
}

const SIZES = {
  sm: { icon: 20, word: "text-[15px]", tag: "text-[7px]", gap: "gap-2" },
  md: { icon: 28, word: "text-[20px]", tag: "text-[8px]", gap: "gap-2.5" },
  lg: { icon: 44, word: "text-[30px]", tag: "text-[9.5px]", gap: "gap-3.5" },
  xl: { icon: 68, word: "text-[44px]", tag: "text-[11px]", gap: "gap-5" },
} as const;

export function RaimyLogo({ size = "md", layout = "horizontal", withTagline = false, className }: RaimyLogoProps) {
  const s = SIZES[size];
  if (layout === "icon") return <RaimyIcon size={s.icon} className={className} title="rAImy Solutions" />;

  if (layout === "stacked") {
    return (
      <div className={cn("flex select-none flex-col items-center text-center", className)} aria-label="rAImy Solutions">
        <RaimyIcon size={s.icon * 1.4} />
        <RaimyWordmark className={cn("mt-4", s.word)} />
        {withTagline && <RaimyTagline className={cn("mt-2.5", s.tag)} />}
      </div>
    );
  }

  return (
    <div className={cn("inline-flex select-none items-center", s.gap, className)} aria-label="rAImy Solutions">
      <RaimyIcon size={s.icon} />
      <span className="flex flex-col justify-center">
        <RaimyWordmark className={s.word} />
        {withTagline && <RaimyTagline className={cn("mt-[0.55em]", s.tag)} />}
      </span>
    </div>
  );
}
