import {
  Bot,
  Building2,
  LogOut,
  Menu,
  Server,
  Settings,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth, useRuntime } from "../contexts";
import { isPortal } from "../portal";
import { Button } from "./ui";

export function AppLayout({ changeServer }: { changeServer: () => void }) {
  const { user, logout } = useAuth();
  const { handshake } = useRuntime();
  const [open, setOpen] = useState(false);
  const nav = [
    { to: "/", label: "Chats", icon: Bot },
    { to: "/settings", label: "Settings", icon: Settings },
  ];
  const admin = [
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/providers", label: "Providers", icon: Building2 },
    { to: "/admin/models", label: "Models", icon: Bot },
    { to: "/admin/server", label: "Server", icon: Server },
    { to: "/admin/branding", label: "Branding", icon: Sun },
  ];
  return (
    <div className="flex min-h-screen">
      <Button
        variant="secondary"
        className="fixed top-3 left-3 z-30 md:hidden"
        onClick={() => setOpen(!open)}
        aria-label="Toggle navigation"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </Button>
      {open && (
        <button
          className="fixed inset-0 z-10 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        className={`panel fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-y-0 border-l-0 p-4 transition-transform md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="mb-6 flex items-center gap-3 px-2 pt-2">
          {handshake.branding.logo_url ? (
            <img
              src={handshake.branding.logo_url}
              alt=""
              className="h-9 w-9 rounded-xl object-cover"
            />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-white">
              <Bot size={19} />
            </div>
          )}
          <strong className="truncate">{handshake.branding.server_name}</strong>
        </div>
        <nav className="grid gap-1" aria-label="Primary">
          {[...nav, ...(user?.role === "admin" ? admin : [])].map(
            ({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium transition ${isActive ? "bg-[var(--accent)] text-white" : "hover:bg-black/5 dark:hover:bg-white/10"}`
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="mt-auto grid gap-2">
          <div className="truncate px-2 text-sm">
            <strong>{user?.username}</strong>
            <span className="block text-xs text-[var(--muted)]">
              {user?.role}
            </span>
          </div>
          {isPortal && (
            <Button
              variant="ghost"
              className="justify-start"
              onClick={changeServer}
            >
              <Server size={17} /> Change server
            </Button>
          )}
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => void logout()}
          >
            <LogOut size={17} /> Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 md:ml-64">
        <Outlet />
      </main>
    </div>
  );
}
