import { type SVGProps } from "react";
import { cn } from "@/lib/cn";

export interface RaimyIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  animated?: boolean;
}

/**
 * High-fidelity vector SVG of the official rAImy Solutions emblem:
 * - 3D isometric crimson-red angled A-chevron
 * - Dark burgundy dimensional depth extrusion
 * - Concentric crimson bullseye / target
 */
export function RaimyIcon({ size = 32, animated = false, className, ...props }: RaimyIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 select-none", className)}
      aria-label="rAImy Solutions logo"
      {...props}
    >
      <defs>
        {/* Front face primary crimson gradient */}
        <linearGradient id="raimy-crimson-grad" x1="45" y1="35" x2="160" y2="165" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#EA3843" />
          <stop offset="45%" stopColor="#D6303A" />
          <stop offset="100%" stopColor="#BA1F28" />
        </linearGradient>

        {/* 3D depth extrusion gradient (dark burgundy/crimson shadow) */}
        <linearGradient id="raimy-depth-grad" x1="40" y1="40" x2="150" y2="170" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6E0F16" />
          <stop offset="60%" stopColor="#4A090E" />
          <stop offset="100%" stopColor="#35060A" />
        </linearGradient>

        {/* Top gloss highlight */}
        <linearGradient id="raimy-gloss-grad" x1="50" y1="30" x2="150" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.45" />
          <stop offset="35%" stopColor="#FFFFFF" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>

        {/* Subtle ambient red glow filter */}
        <filter id="raimy-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#D6303A" floodOpacity="0.38" />
        </filter>
      </defs>

      <g filter="url(#raimy-glow)">
        {/* ── 3D DEPTH / EXTRUSION LAYER (UNDERNEATH) ──────────────────── */}
        {/* Left leg shadow extrusion */}
        <g transform="translate(-7, 9)">
          <rect
            x="48"
            y="42"
            width="28"
            height="116"
            rx="14"
            fill="url(#raimy-depth-grad)"
            transform="rotate(-26 48 42)"
          />
        </g>
        {/* Right leg shadow extrusion */}
        <g transform="translate(-6, 9)">
          <rect
            x="96"
            y="44"
            width="28"
            height="124"
            rx="14"
            fill="url(#raimy-depth-grad)"
            transform="rotate(27 96 44)"
          />
        </g>

        {/* Seamless fill polygon between feet and shadow */}
        <polygon
          points="46,144 39,153 64,153 71,144"
          fill="#4A090E"
        />
        <polygon
          points="136,152 130,161 155,161 161,152"
          fill="#3E080C"
        />

        {/* ── FRONT FACE LAYER ─────────────────────────────────────────── */}
        {/* Left Leg: Pill angled upwards to the apex */}
        <rect
          x="48"
          y="42"
          width="28"
          height="116"
          rx="14"
          fill="url(#raimy-crimson-grad)"
          transform="rotate(-26 48 42)"
        />

        {/* Right Leg: Overlapping pill angled downwards from the apex */}
        <rect
          x="96"
          y="44"
          width="28"
          height="124"
          rx="14"
          fill="url(#raimy-crimson-grad)"
          transform="rotate(27 96 44)"
        />

        {/* Highlight sheen across the top face */}
        <path
          d="M 98 44 L 148 142"
          stroke="url(#raimy-gloss-grad)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path
          d="M 92 48 L 54 130"
          stroke="url(#raimy-gloss-grad)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* ── CENTER TARGET / BULLSEYE ──────────────────────────────────── */}
        <g className={animated ? "animate-pulse" : undefined}>
          {/* Outer circle ring */}
          <circle
            cx="98"
            cy="137"
            r="16"
            stroke="#D6303A"
            strokeWidth="5.5"
            fill="none"
          />
          {/* Inner solid dot */}
          <circle
            cx="98"
            cy="137"
            r="6"
            fill="#D6303A"
          />
        </g>
      </g>
    </svg>
  );
}

export interface RaimyLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  layout?: "horizontal" | "vertical" | "icon";
  withTagline?: boolean;
  animated?: boolean;
  className?: string;
}

const ICON_SIZES = {
  sm: 22,
  md: 32,
  lg: 48,
  xl: 72,
} as const;

export function RaimyLogo({
  size = "md",
  layout = "horizontal",
  withTagline = true,
  animated = false,
  className,
}: RaimyLogoProps) {
  const iconSize = ICON_SIZES[size];

  if (layout === "icon") {
    return <RaimyIcon size={iconSize} animated={animated} className={className} />;
  }

  if (layout === "vertical") {
    return (
      <div className={cn("flex flex-col items-center text-center select-none", className)}>
        <RaimyIcon size={iconSize} animated={animated} className="mb-3" />
        <div className="flex items-baseline font-sans leading-none tracking-tight">
          <span className="text-white font-medium text-xl md:text-2xl">r</span>
          <span className="text-[#D6303A] font-extrabold text-xl md:text-2xl">AI</span>
          <span className="text-[#D6E7F3] font-semibold text-xl md:text-2xl">my</span>
          <span className="ml-2 text-white font-light text-xl md:text-2xl">Solutions</span>
        </div>
        {withTagline && (
          <p className="mt-2 text-[9px] md:text-[10px] uppercase font-semibold tracking-[0.24em] text-[#D6E7F3]/80">
            Visual Computing &amp; Intelligent Hardware
          </p>
        )}
      </div>
    );
  }

  // Horizontal layout
  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <RaimyIcon size={iconSize} animated={animated} />
      <div className="flex flex-col justify-center leading-none">
        <div className="flex items-baseline font-sans text-[15px] font-medium tracking-tight">
          <span className="text-white">r</span>
          <span className="text-[#D6303A] font-extrabold">AI</span>
          <span className="text-[#D6E7F3] font-semibold">my</span>
          <span className="ml-1.5 text-white font-normal">Solutions</span>
        </div>
        {withTagline && (
          <span className="mt-1 text-[8px] font-semibold uppercase tracking-[0.2em] text-[#D6E7F3]/75">
            Visual Computing &amp; Intelligent Hardware
          </span>
        )}
      </div>
    </div>
  );
}
