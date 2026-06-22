import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 [&>svg]:pointer-events-none transition",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[image:var(--accent-grad)] text-primary-foreground",
        secondary:
          "border-[var(--border-strong)] bg-[var(--muted)]/15 text-muted-foreground",
        success:
          "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        destructive:
          "border-[var(--danger)]/30 bg-destructive/15 text-destructive",
        outline: "text-foreground border-[var(--border-strong)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
