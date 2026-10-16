import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white font-medium hover:brightness-110 active:brightness-95 disabled:hover:brightness-100 shadow-[0_2px_10px_rgba(214,48,58,0.25)] hover:shadow-[0_4px_16px_rgba(214,48,58,0.38)]",
  secondary: "bg-elevated text-fg border border-line hover:bg-active hover:border-line/80",
  ghost: "text-fg hover:bg-hover",
  danger: "bg-danger text-white font-medium hover:brightness-110 disabled:hover:brightness-100 shadow-[0_2px_10px_rgba(224,56,66,0.25)]",
};

const SIZES: Record<Size, string> = {
  sm: "h-6 px-2 text-xs gap-1.5",
  md: "h-7 px-3 text-[13px] gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  icon: ReactNode;
  active?: boolean;
  size?: "sm" | "md";
}

/** Icon-only button. `label` becomes both the tooltip and the accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, active, size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted transition-colors",
        "hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted",
        size === "sm" ? "h-6 w-6" : "h-7 w-7",
        active && "bg-active text-fg",
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
});
