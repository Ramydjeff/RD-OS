// The desktop's signature: a large clock with a greeting, top right, behind
// the icons and the windows. Purely decorative; it never takes the pointer.

import { useClock } from "@/components/desktop/Taskbar";
import { cn } from "@/lib/cn";
import { useDesktop } from "@/store/desktop";

function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Bonjour";
  if (hour >= 12 && hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

export function DesktopClock() {
  const now = useClock();
  const userName = useDesktop((s) => s.userName.trim());
  const light = useDesktop((s) => s.wallpaper === "paper");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const date = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const first = userName.split(/\s+/)[0];

  return (
    <div
      aria-hidden
      className={cn(
        "desk-clock pointer-events-none absolute top-[6vh] right-[4.5vw] flex select-none flex-col items-end text-right",
        light ? "text-fg" : "text-white",
      )}
    >
      <p className={cn("font-display text-[15px] font-light tracking-[0.01em]", light ? "text-fg2" : "text-white/75")}>
        {greeting(now.getHours())}
        {first && <span className="font-medium">, {first}</span>}
      </p>
      <p className="mt-1 font-display text-[clamp(64px,8.5vw,112px)] leading-[0.9] font-extralight tracking-[-0.045em] tabular-nums">
        {hh}
        <span className="desk-clock-colon text-[#f43f52]">:</span>
        {mm}
      </p>
      <p className={cn("mt-3 text-[14px] font-medium first-letter:uppercase", light ? "text-fg2" : "text-white/70")}>{date}</p>
      <span className={cn("mt-4 h-px w-16 bg-gradient-to-l to-transparent", light ? "from-[#b02d38]/60" : "from-[#f43f52]/80")} />
      <p className={cn("mt-3 flex items-baseline gap-2", light ? "text-faint" : "text-white/40")}>
        <span className="font-display text-[12px] font-medium tracking-[0.02em]">rAImy OS</span>
        <span className="font-mono text-[9px] tracking-[0.3em] uppercase">Visual Computing</span>
      </p>
    </div>
  );
}
