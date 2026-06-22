import { Bot } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button, ErrorNotice, Input, Spinner } from "../components/common";
import { useAuth, useRuntime } from "../contexts";

export function LoginPage() {
  const auth = useAuth();
  const { handshake } = useRuntime();
  const location = useLocation();
  const navigate = useNavigate();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (auth.user)
    return (
      <Navigate
        to={auth.user.must_change_password ? "/change-password" : "/"}
        replace
      />
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(loginName, password);
      navigate((location.state as { from?: string } | null)?.from ?? "/", {
        replace: true,
      });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center p-5">
      <form
        onSubmit={submit}
        className="panel-strong w-[min(92vw,28rem)] rounded-3xl p-7"
      >
        <div className="mb-7 text-center">
          {handshake.branding.logo_url ? (
            <img
              src={handshake.branding.logo_url}
              alt=""
              className="mx-auto mb-4 h-16 w-16 rounded-2xl object-cover"
            />
          ) : (
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] shadow-[0_16px_40px_-16px_var(--glow)]">
              <Bot size={30} />
            </div>
          )}
          <h1 className="text-gradient text-3xl font-bold tracking-tight">
            {handshake.branding.server_name}
          </h1>
          <p className="mt-2 text-[var(--muted)]">
            Sign in to your private workspace.
          </p>
        </div>
        <div className="grid gap-4">
          <Input
            label="Username or email"
            autoComplete="username"
            required
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <ErrorNotice error={error} />
          {auth.storageWarning && (
            <p className="rounded-xl bg-amber-500/10 p-3 text-sm">
              {auth.storageWarning}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <Spinner size={16} />}
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>
    </main>
  );
}
