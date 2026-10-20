import { memo } from "react";
import { RaimyIcon } from "@/components/ui/RaimyLogo";
import { cn } from "@/lib/cn";
import type { WallpaperId } from "@/store/desktop";

export const WALLPAPER_LABELS: Record<WallpaperId, string> = {
  signature: "Signature",
  aurora: "Aurore",
  obsidian: "Obsidienne",
  circuit: "Circuit",
  horizon: "Horizon",
  paper: "Papier",
};

/** Generated wallpapers: CSS only, no image assets, animated on the compositor. */
export const Wallpaper = memo(function Wallpaper({ id, preview = false }: { id: WallpaperId; preview?: boolean }) {
  return (
    <div aria-hidden className={cn("wp", `wp-${id}`, preview && "wp-preview")}>
      <div className="wp-layer wp-a" />
      <div className="wp-layer wp-b" />
      {!preview && (
        <div className="wp-mark">
          <RaimyIcon size={260} />
        </div>
      )}
    </div>
  );
});
