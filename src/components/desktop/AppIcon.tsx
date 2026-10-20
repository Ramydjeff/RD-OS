// Icon tiles. "Signature" style: an obsidian tile lit from inside by the app's
// tone, with the glyph in that tone and a light band at the angle of the rAImy
// "A". "Couleur" style: the same glyph in white on a tone gradient.
// Windows programs show their own icon as is; a monogram tile with a tone
// derived from the name stands in when Windows has none.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { APPS } from "@/components/desktop/apps";
import { GLYPHS, TONES, toneFor, type GlyphId, type ToneId } from "@/components/desktop/iconography";
import { cn } from "@/lib/cn";
import { useDesktop, type AppId, type IconStyle } from "@/store/desktop";
import { useWinIcon } from "@/store/winicons";

interface TileProps {
  size?: number;
  className?: string;
  /** Overrides the style chosen in Paramètres (used by the previews there). */
  variant?: IconStyle;
}

export function Tile({ tone, size = 44, className, variant, children }: TileProps & { tone: ToneId; children: ReactNode }) {
  const chosen = useDesktop((s) => s.iconStyle);
  const t = TONES[tone];
  const style = {
    width: size,
    height: size,
    borderRadius: size * 0.3,
    "--hue": t.hue,
    "--deep": t.deep,
    "--t0": t.tile[0],
    "--t1": t.tile[1],
    "--s": `${size}px`,
  } as CSSProperties;
  return (
    <span aria-hidden data-style={variant ?? chosen} data-dark={"dark" in t ? true : undefined} className={cn("app-tile", className)} style={style}>
      {children}
    </span>
  );
}

export function GlyphTile({ glyph, ...props }: TileProps & { tone: ToneId; glyph: GlyphId }) {
  const Glyph = GLYPHS[glyph];
  const px = Math.round((props.size ?? 44) * 0.62);
  return (
    <Tile {...props}>
      <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor">
        <Glyph />
      </svg>
    </Tile>
  );
}

export function AppIcon({ app, ...props }: TileProps & { app: AppId }) {
  const meta = APPS[app];
  return <GlyphTile tone={meta.tone} glyph={meta.glyph} {...props} />;
}

export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2);
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function MonogramIcon({ name, size = 44, ...props }: TileProps & { name: string }) {
  return (
    <Tile tone={toneFor(name)} size={size} {...props}>
      <span className="tile-mono font-display" style={{ fontSize: size * 0.36 }}>
        {monogram(name)}
      </span>
    </Tile>
  );
}

/** True once the element has been on screen (icons load only when seen). */
function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") return setSeen(true);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** A Windows program, shortcut or file: its real icon, or a monogram tile. */
export function WinAppIcon({ path, name, size = 44, ...props }: TileProps & { path: string; name: string }) {
  const [ref, seen] = useSeen<HTMLSpanElement>();
  const src = useWinIcon(path, seen);
  return (
    <span ref={ref} className="inline-flex shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <span aria-hidden className="app-real" style={{ ["--s" as string]: `${size}px` }}>
          <img src={src} alt="" width={size} height={size} draggable={false} />
        </span>
      ) : src === null ? (
        <MonogramIcon name={name} size={size} {...props} />
      ) : null}
    </span>
  );
}
