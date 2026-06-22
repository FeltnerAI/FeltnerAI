import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { Button, ErrorNotice, Input, Select } from "../components/common";
import { applyTheme, useAuth } from "../contexts";

export function SettingsPage() {
  const auth = useAuth();
  const [current, setCurrent] = useState("");
  const [replacement, setReplacement] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api<void>("/auth/password", {
        method: "PUT",
        body: JSON.stringify({
          current_password: current,
          new_password: replacement,
        }),
      });
      setCurrent("");
      setReplacement("");
      setMessage("Password changed. Other sessions were signed out.");
      setError(null);
      await auth.refresh();
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <div className="mx-auto max-w-3xl p-5 py-12">
      <h1 className="text-3xl font-bold">Settings</h1>
      <section className="panel mt-6 rounded-2xl p-6">
        <h2 className="text-xl font-bold">Appearance</h2>
        <div className="mt-4 max-w-xs">
          <Select
            label="Theme"
            value={auth.user?.theme ?? "system"}
            onValueChange={(value) => {
              const theme = value as "light" | "dark" | "system";
              applyTheme(theme);
              void auth.updateTheme(theme).catch(setError);
            }}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
      </section>
      <form className="panel mt-5 grid gap-4 rounded-2xl p-6" onSubmit={submit}>
        <div>
          <h2 className="text-xl font-bold">Password</h2>
          <p className="text-sm text-[var(--muted)]">
            Changing your password signs out your other sessions.
          </p>
        </div>
        <Input
          label="Current password"
          type="password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          label="New password"
          type="password"
          minLength={12}
          required
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
        />
        {message && <p className="text-sm text-green-600">{message}</p>}
        <ErrorNotice error={error} />
        <Button className="justify-self-start" type="submit">
          Change password
        </Button>
      </form>
    </div>
  );
}
