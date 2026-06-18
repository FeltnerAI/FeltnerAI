import * as Dialog from "@radix-ui/react-dialog";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Slot } from "@radix-ui/react-slot";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

export function Button({
  variant = "primary",
  asChild,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  asChild?: boolean;
}) {
  const Component = asChild ? Slot : "button";
  const variants = {
    primary:
      "text-[var(--accent-contrast)] bg-[image:var(--accent-grad)] shadow-[0_10px_30px_-12px_var(--glow)] hover:brightness-[1.08] hover:shadow-[0_16px_40px_-12px_var(--glow)]",
    secondary:
      "bg-[var(--panel-strong)] border border-[var(--border-strong)] backdrop-blur-md hover:border-[var(--accent)]",
    danger: "bg-[var(--danger)] text-white hover:brightness-110",
    ghost: "bg-transparent hover:bg-black/5 dark:hover:bg-white/10",
  };
  return (
    <Component
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 font-semibold transition duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      <span>{label}</span>
      <input className="field font-normal" {...props} />
      {hint && (
        <span className="text-xs font-normal text-[var(--muted)]">{hint}</span>
      )}
    </label>
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
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={`field flex min-w-0 items-center justify-between gap-2 sm:min-w-44 ${className}`}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={label} />
        </span>
        <SelectPrimitive.Icon className="shrink-0">
          <ChevronDown size={16} className="opacity-70" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="panel-strong z-50 overflow-hidden rounded-xl p-1">
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer select-none items-center rounded-lg py-2 pr-8 pl-3 outline-none transition data-[highlighted]:bg-[image:var(--accent-grad)] data-[highlighted]:text-[var(--accent-contrast)]"
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check size={16} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-overlay fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
        <Dialog.Content className="panel-strong animate-dialog fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-bold tracking-tight">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-[var(--muted)]">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Close" className="-mt-1">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>
          {!description && (
            <Dialog.Description className="sr-only">
              {title} dialog
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
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
        <div className="mt-2 text-[var(--muted)]">{children}</div>
      </div>
    </div>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]"
    >
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden />;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/**
 * A frosted "pull tab" anchored to a screen edge that reveals a collapsible
 * drawer. Anchoring (`fixed`/`absolute`), position, and responsive visibility
 * are all supplied via `className` (e.g. `fixed left-0 top-[42%]`).
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
      className={`frosted-bar group z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-r-2xl border border-l-0 border-[var(--border-strong)] py-3.5 pr-1 pl-0.5 text-[var(--muted)] shadow-[var(--shadow)] transition hover:pr-2 hover:text-current active:scale-95 ${className}`}
    >
      <Icon size={18} />
      <ChevronRight
        size={13}
        className="opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-90"
      />
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "danger";
}) {
  const tones = {
    neutral:
      "bg-[var(--muted)]/15 text-[var(--muted)] border border-[var(--border-strong)]",
    accent: "bg-[image:var(--accent-grad)] text-[var(--accent-contrast)]",
    success: "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30",
    danger:
      "bg-[var(--danger)]/15 text-[var(--danger)] border border-[var(--danger)]/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
