import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Button, ErrorNotice, Input } from "../components/ui";
import { useAuth } from "../contexts";

export function ChangePasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [replacement, setReplacement] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (replacement !== confirm)
      return setError(new Error("New passwords do not match."));
    try {
      await api<void>("/auth/password", {
        method: "PUT",
        body: JSON.stringify({
          current_password: current,
          new_password: replacement,
        }),
      });
      await auth.refresh();
      navigate("/", { replace: true });
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center p-5">
      <form
        className="panel grid w-[min(92vw,30rem)] gap-4 rounded-3xl p-7"
        onSubmit={submit}
      >
        <div>
          <h1 className="text-2xl font-bold">Choose a new password</h1>
          <p className="mt-2 text-[var(--muted)]">
            An administrator assigned your current password. Change it before
            continuing.
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
        <Input
          label="Confirm new password"
          type="password"
          minLength={12}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <ErrorNotice error={error} />
        <Button type="submit">Change password</Button>
      </form>
    </main>
  );
}
