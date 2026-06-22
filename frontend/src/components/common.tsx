import { ChevronRight, Loader2, type LucideIcon } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button as ShadButton } from "@/components/ui/button";
import { Badge as ShadBadge } from "@/components/ui/badge";
import { Input as ShadInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton as ShadSkeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select as SelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export { Skeleton } from "@/components/ui/skeleton";

/**
 * Legacy-compatible facade over the shadcn/ui primitives. Pages were written
 * against an ergonomic, props-driven UI kit (label-aware inputs, options-based
 * selects, a one-shot modal); these wrappers preserve that surface so form
 * logic stays untouched while every control is now a shadcn component.
 */

const BUTTON_VARIANTS = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
  ghost: "ghost",
} as const;

type LegacyButtonVariant = keyof typeof BUTTON_VARIANTS;

export function Button({
  variant = "primary",
  ...props
}: Omit<React.ComponentProps<typeof ShadButton>, "variant"> & {
  variant?: LegacyButtonVariant;
}) {
  return <ShadButton variant={BUTTON_VARIANTS[variant]} {...props} />;
}

export function Input({
  label,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <ShadInput className={className} {...props} />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  label,
  className = "",
}: {
  value?: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <SelectRoot value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={label} className={cn("min-w-0 sm:min-w-44", className)}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? "" : "sr-only"}>
            {description ?? `${title} dialog`}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

const BADGE_TONES = {
  neutral: "secondary",
  accent: "default",
  success: "success",
  danger: "destructive",
} as const;

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return <ShadBadge variant={BADGE_TONES[tone]}>{children}</ShadBadge>;
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-64 place-items-center p-8 text-center">
      <div className="max-w-md">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <div className="mt-2 text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive"
    >
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden />;
}

export function SkeletonLine({ className = "" }: { className?: string }) {
  return <ShadSkeleton className={className} />;
}

/**
 * A frosted "pull tab" anchored to a screen edge that reveals a collapsible
 * drawer. Anchoring, position, and responsive visibility are supplied via
 * `className` (e.g. `fixed left-0 top-[42%]`).
 */
export function EdgeTab({
  icon: Icon,
  label,
  onClick,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "frosted-bar group z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-r-2xl border border-l-0 border-[var(--border-strong)] py-3.5 pr-1 pl-0.5 text-muted-foreground shadow-[var(--shadow)] transition hover:pr-2 hover:text-foreground active:scale-95",
        className,
      )}
    >
      <Icon size={18} />
      <ChevronRight
        size={13}
        className="opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-90"
      />
    </button>
  );
}
