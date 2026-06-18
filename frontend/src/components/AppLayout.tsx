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
import { useAuth, useRuntime } from "../contexts";
import { isPortal } from "../portal";
import type { Theme } from "../api/generated";
import { Button, EdgeTab } from "./ui";

const THEME_CYCLE: Theme[] = ["system", "light", "dark"];
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
  const cycleTheme = () => {
    const next =
      THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
    void updateTheme(next);
  };

  // Close the drawer after navigating on phones, where it overlays content.
  const navigated = () => {
    if (!wideViewport()) setOpen(false);
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium transition duration-150 ${
      isActive
        ? "bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] shadow-[0_10px_28px_-14px_var(--glow)]"
        : "text-[var(--muted)] hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
    }`;

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
        className={`panel fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-y-0 border-l-0 p-4 transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="mb-7 flex items-center gap-2 px-1 pt-1">
          {handshake.branding.logo_url ? (
            <img
              src={handshake.branding.logo_url}
              alt=""
              className="h-9 w-9 rounded-xl object-cover"
            />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] shadow-[0_8px_22px_-10px_var(--glow)]">
              <Bot size={19} />
            </div>
          )}
          <strong className="min-w-0 flex-1 truncate text-[0.98rem] tracking-tight">
            {handshake.branding.server_name}
          </strong>
          <button
            onClick={() => setOpen(false)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
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

        <div className="mt-auto grid gap-2 pt-4">
          <div className="card flex items-center gap-3 rounded-xl p-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[image:var(--accent-grad)] text-sm font-bold text-[var(--accent-contrast)]">
              {(user?.username ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm">
                {user?.username}
              </strong>
              <span className="block text-xs text-[var(--muted)] capitalize">
                {user?.role}
              </span>
            </div>
            <button
              onClick={cycleTheme}
              className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
              aria-label={`Theme: ${theme}. Click to change.`}
              title={`Theme: ${theme}`}
            >
              <ThemeIcon size={17} />
            </button>
          </div>
          {isPortal && (
            <Button
              variant="ghost"
              className="justify-start text-[var(--muted)]"
              onClick={changeServer}
            >
              <Server size={17} /> Change server
            </Button>
          )}
          <Button
            variant="ghost"
            className="justify-start text-[var(--muted)]"
            onClick={() => void logout()}
          >
            <LogOut size={17} /> Sign out
          </Button>
        </div>
      </aside>

      <main
        className={`min-w-0 flex-1 transition-[margin] duration-200 ${open ? "md:ml-64" : "ml-0"}`}
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
      className={`px-3 pb-1 text-[0.68rem] font-bold tracking-[0.12em] text-[var(--muted)] uppercase ${className}`}
    >
      {children}
    </span>
  );
}
