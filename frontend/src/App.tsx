import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth, useRuntime } from "./contexts";
import { AppLayout } from "./components/AppLayout";
import { AdminBrandingPage } from "./pages/admin/Branding";
import { AdminModelsPage } from "./pages/admin/Models";
import { AdminProvidersPage } from "./pages/admin/Providers";
import { AdminServerPage } from "./pages/admin/Server";
import { AdminUsersPage } from "./pages/admin/Users";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { ChatPage } from "./pages/Chat";
import { LoginPage } from "./pages/Login";
import { SettingsPage } from "./pages/Settings";
import { SetupPage } from "./pages/Setup";

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
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/providers" element={<AdminProvidersPage />} />
            <Route path="/admin/models" element={<AdminModelsPage />} />
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
      <main className="grid min-h-screen place-items-center">
        Loading session…
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
  return user?.role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}
