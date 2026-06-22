import {
  Boxes,
  Bot,
  Building2,
  Code2,
  LogOut,
  Monitor,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Server,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

import type { Theme } from "@/api/generated";
import { EdgeTab } from "@/components/common";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, useRuntime } from "@/contexts";
import { isPortal } from "@/portal";
import { cn } from "@/lib/utils";

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

function wideViewport() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 768px)").matches
  );
}

export function AppLayout({ changeServer }: { changeServer: () => void }) {
  const { user, logout, updateTheme } = useAuth();
  const { handshake } = useRuntime();
  // Default the rail open on desktop, collapsed on phones.
  const [open, setOpen] = useState(wideViewport);
  const workspace = [
    { to: "/", label: "Chats", icon: Bot },
    // The coding agent needs local filesystem/shell access, so it is only
    // available in the desktop Portal build.
    ...(isPortal ? [{ to: "/code", label: "Code", icon: Code2 }] : []),
    { to: "/settings", label: "Settings", icon: Settings },
  ];
  const admin = [
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/providers", label: "Providers", icon: Building2 },
    { to: "/admin/models", label: "Models", icon: Bot },
    { to: "/admin/lmstudio", label: "LM Studio", icon: Boxes },
    { to: "/admin/server", label: "Server", icon: Server },
    { to: "/admin/branding", label: "Branding", icon: Sun },
  ];

  const theme = user?.theme ?? "system";
  const ThemeIcon = THEME_ICON[theme];

  // Close the drawer after navigating on phones, where it overlays content.
  const navigated = () => {
    if (!wideViewport()) setOpen(false);
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium transition duration-150",
      isActive
        ? "bg-[image:var(--accent-grad)] text-primary-foreground shadow-[0_10px_28px_-14px_var(--glow)]"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
    );

  return (
    <div className="flex min-h-screen">
      {/* Pull tab — reveals the rail at every breakpoint when collapsed. */}
      {!open && (
        <EdgeTab
          icon={PanelLeft}
          label="Open navigation"
          onClick={() => setOpen(true)}
          className="fixed top-[42%] left-0"
        />
      )}

      {/* Dim backdrop only when the rail overlays content (phones). */}
      {open && (
        <button
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <aside
        className={cn(
          "panel fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-y-0 border-l-0 p-4 transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-7 flex items-center gap-2 px-1 pt-1">
          {handshake.branding.logo_url ? (
            <img
              src={handshake.branding.logo_url}
              alt=""
              className="h-9 w-9 rounded-xl object-cover"
            />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[image:var(--accent-grad)] text-primary-foreground shadow-[0_8px_22px_-10px_var(--glow)]">
              <Bot size={19} />
            </div>
          )}
          <strong className="min-w-0 flex-1 truncate text-[0.98rem] tracking-tight">
            {handshake.branding.server_name}
          </strong>
          <button
            onClick={() => setOpen(false)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label="Collapse navigation"
            title="Collapse"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        <nav
          className="grid content-start gap-1 overflow-y-auto"
          aria-label="Primary"
        >
          <NavSectionLabel>Workspace</NavSectionLabel>
          {workspace.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={navigated}
              className={linkClass}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}

          {user?.role === "admin" && (
            <>
              <NavSectionLabel className="mt-4">Administration</NavSectionLabel>
              {admin.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={navigated}
                  className={linkClass}
                >
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="mt-auto pt-4">
          <DropdownMenu>
            <DropdownMenuTrigger className="card flex w-full items-center gap-3 rounded-xl p-2.5 text-left outline-none transition hover:border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] focus-visible:ring-[3px] focus-visible:ring-ring/60">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[image:var(--accent-grad)] text-sm font-bold text-primary-foreground">
                {(user?.username ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm">
                  {user?.username}
                </strong>
                <span className="block text-xs text-muted-foreground capitalize">
                  {user?.role}
                </span>
              </div>
              <ThemeIcon size={17} className="shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-[14.5rem]">
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => void updateTheme(value as Theme)}
              >
                <DropdownMenuRadioItem value="system">
                  <Monitor size={16} /> System
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">
                  <Sun size={16} /> Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon size={16} /> Dark
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {isPortal && (
                <DropdownMenuItem onSelect={() => changeServer()}>
                  <Server size={16} /> Change server
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void logout()}
              >
                <LogOut size={16} /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main
        className={cn(
          "min-w-0 flex-1 transition-[margin] duration-200",
          open ? "md:ml-64" : "ml-0",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}

function NavSectionLabel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "px-3 pb-1 text-[0.68rem] font-bold tracking-[0.12em] text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}
