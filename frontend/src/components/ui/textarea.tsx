import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-xl border border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--panel-solid)_70%,transparent)] px-3 py-2 text-sm transition-[color,box-shadow,border-color] outline-none",
        "placeholder:text-muted-foreground",
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

export { Textarea };
