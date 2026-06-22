import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-xl border border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--panel-solid)_70%,transparent)] px-3 py-2 text-sm transition-[color,box-shadow,border-color] outline-none",
        "file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
        "hover:border-[color-mix(in_srgb,var(--accent)_38%,var(--border-strong))]",
        "focus-visible:border-primary focus-visible:bg-[var(--panel-solid)] focus-visible:ring-[3px] focus-visible:ring-ring/60",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
