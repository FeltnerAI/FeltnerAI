import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { Button, ErrorNotice, Input } from "../components/common";

export function SetupPage() {
  const [form, setForm] = useState({
    token: "",
    serverName: "FeltnerAI",
    publicUrl: "",
    username: "admin",
    email: "",
    password: "",
    accent: "#6d5dfc",
    providerName: "",
    providerUrl: "",
    apiKey: "",
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<void>("/setup/complete", {
        method: "POST",
        headers: { "x-setup-token": form.token },
        body: JSON.stringify({
          server_name: form.serverName,
          public_url: form.publicUrl || null,
          accent_color: form.accent,
          username: form.username,
          email: form.email || null,
          password: form.password,
          provider: form.providerUrl
            ? {
                name: form.providerName || "OpenAI-compatible",
                base_url: form.providerUrl,
                api_key: form.apiKey || null,
                additional_headers: {},
              }
            : null,
        }),
      });
      window.location.reload();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  return (
    <main className="mx-auto min-h-screen max-w-4xl p-5 py-12">
      <form className="panel-strong rounded-3xl p-6 sm:p-9" onSubmit={submit}>
        <p className="text-sm font-bold tracking-[0.18em] text-[var(--accent)] uppercase">
          First-run setup
        </p>
        <h1 className="text-gradient mt-2 text-4xl font-bold tracking-tight">
          Make this server yours.
        </h1>
        <p className="mt-3 max-w-2xl text-[var(--muted)]">
          Enter the temporary setup token printed by the server. It changes
          after every restart and is disabled permanently when setup completes.
        </p>
        <div className="mt-8 grid gap-8">
          <section className="grid gap-4 sm:grid-cols-2">
            <h2 className="sm:col-span-2 text-xl font-bold">Server identity</h2>
            <Input
              label="Setup token"
              type="password"
              required
              value={form.token}
              onChange={(e) => set("token", e.target.value)}
            />
            <Input
              label="Server name"
              required
              value={form.serverName}
              onChange={(e) => set("serverName", e.target.value)}
            />
            <Input
              label="Public URL"
              type="url"
              placeholder="https://ai.example.com"
              value={form.publicUrl}
              onChange={(e) => set("publicUrl", e.target.value)}
            />
            <Input
              label="Accent color"
              type="color"
              value={form.accent}
              onChange={(e) => set("accent", e.target.value)}
            />
          </section>
          <section className="grid gap-4 sm:grid-cols-2">
            <h2 className="sm:col-span-2 text-xl font-bold">
              First administrator
            </h2>
            <Input
              label="Username"
              required
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
            />
            <Input
              label="Email (optional)"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
            <Input
              label="Password"
              type="password"
              minLength={12}
              required
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              hint="At least 12 characters."
            />
          </section>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <h2 className="text-xl font-bold">Provider (optional)</h2>
              <p className="text-sm text-[var(--muted)]">
                You can skip this and configure providers after signing in.
              </p>
            </div>
            <Input
              label="Provider name"
              value={form.providerName}
              onChange={(e) => set("providerName", e.target.value)}
            />
            <Input
              label="Base URL"
              type="url"
              placeholder="https://api.openai.com/v1"
              value={form.providerUrl}
              onChange={(e) => set("providerUrl", e.target.value)}
            />
            <Input
              label="API key"
              type="password"
              value={form.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
            />
          </section>
          <ErrorNotice error={error} />
          <Button className="sm:justify-self-end" type="submit" disabled={busy}>
            {busy ? "Completing setup…" : "Complete setup"}
          </Button>
        </div>
      </form>
    </main>
  );
}
