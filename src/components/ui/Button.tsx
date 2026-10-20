import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-onaccent hover:bg-accent-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.22)] disabled:hover:bg-accent",
  secondary:
    "bg-glass text-fg shadow-[inset_0_0_0_1px_var(--glass-line)] hover:bg-glass-hover disabled:hover:bg-glass",
  ghost: "text-fg2 hover:bg-hover hover:text-fg disabled:hover:bg-transparent",
  danger: "bg-danger text-onaccent hover:brightness-110 disabled:hover:brightness-100",
};

const SIZES: Record<Size, string> = {
  sm: "h-[26px] px-2.5 text-[12px] gap-1.5",
  md: "h-8 px-3.5 text-[13px] gap-2",
  lg: "h-10 px-5 text-[14px] gap-2.5",
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
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[var(--radius-sm)] font-medium",
        "transition-[background-color,color,box-shadow,filter] duration-150 active:translate-y-px",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0",
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
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted transition-colors duration-150",
        "hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted",
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
