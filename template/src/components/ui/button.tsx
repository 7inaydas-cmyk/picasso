import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "ghost";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/* A shadcn-style component: it OWNS its spacing, radius, and weight. Callers
   use variants for appearance and layout classes for placement — the
   no-restyle contract in eslint.config.mjs enforces that split at the call
   site, so the className that reaches here is layout-only by the time it does. */
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-ink hover:bg-primary/90",
  outline: "border border-line bg-canvas text-ink hover:bg-line/40",
  ghost: "text-ink hover:bg-line/40",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-base",
};

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
}
