import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth, useRuntime } from "./contexts";
import { isPortal } from "./portal";
import { AppLayout } from "./components/AppLayout";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { ChatPage } from "./pages/Chat";
import { CodePage } from "./pages/Code";
import { LoginPage } from "./pages/Login";
import { SettingsPage } from "./pages/Settings";
import { SetupPage } from "./pages/Setup";

// Admin pages are split into their own chunks; they are only reached by
// administrators, so they should not weigh down the initial bundle.
const AdminUsersPage = lazy(() =>
  import("./pages/admin/Users").then((m) => ({ default: m.AdminUsersPage })),
);
const AdminProvidersPage = lazy(() =>
  import("./pages/admin/Providers").then((m) => ({
    default: m.AdminProvidersPage,
  })),
);
const AdminModelsPage = lazy(() =>
  import("./pages/admin/Models").then((m) => ({ default: m.AdminModelsPage })),
);
const AdminLmStudioPage = lazy(() =>
  import("./pages/admin/LmStudio").then((m) => ({
    default: m.AdminLmStudioPage,
  })),
);
const AdminServerPage = lazy(() =>
  import("./pages/admin/Server").then((m) => ({ default: m.AdminServerPage })),
);
const AdminBrandingPage = lazy(() =>
  import("./pages/admin/Branding").then((m) => ({
    default: m.AdminBrandingPage,
  })),
);

export function App({ changeServer }: { changeServer: () => void }) {
  const { handshake } = useRuntime();
  if (!handshake.setup_complete) return <SetupPage />;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route element={<AppLayout changeServer={changeServer} />}>
          <Route index element={<ChatPage />} />
          <Route path="/chats/:chatId" element={<ChatPage />} />
          {isPortal && <Route path="/code" element={<CodePage />} />}
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/providers" element={<AdminProvidersPage />} />
            <Route path="/admin/models" element={<AdminModelsPage />} />
            <Route path="/admin/lmstudio" element={<AdminLmStudioPage />} />
            <Route path="/admin/server" element={<AdminServerPage />} />
            <Route path="/admin/branding" element={<AdminBrandingPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading)
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="panel-strong grid w-[min(92vw,22rem)] gap-3 rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <div className="skeleton h-9 w-9 rounded-xl" />
            <div className="skeleton h-4 w-32" />
          </div>
          <div className="skeleton h-3 w-full" />
          <div className="skeleton h-3 w-3/4" />
          <span className="sr-only">Loading session…</span>
        </div>
      </main>
    );
  if (!auth.user)
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (
    auth.user.must_change_password &&
    location.pathname !== "/change-password"
  ) {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

function RequireAdmin() {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return (
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  );
}

function RouteFallback() {
  return (
    <div className="mx-auto max-w-6xl p-5 py-10">
      <div className="skeleton h-8 w-48" />
      <div className="skeleton mt-4 h-4 w-80" />
      <div className="panel mt-8 grid gap-3 rounded-2xl p-6">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-2/3" />
      </div>
    </div>
  );
}
