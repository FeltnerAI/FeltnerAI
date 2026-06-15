import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import type { Branding } from "../../api/generated";
import { Button, ErrorNotice, Input } from "../../components/ui";
import { useRuntime } from "../../contexts";
import { AdminPage } from "./Users";

export function AdminBrandingPage() {
  const { handshake } = useRuntime();
  const branding = handshake.branding;
  const [name, setName] = useState(branding.server_name);
  const [accent, setAccent] = useState(branding.accent_color);
  const [css, setCss] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api<Branding>("/admin/branding", {
        method: "PUT",
        body: JSON.stringify({
          server_name: name,
          accent_color: accent,
          custom_css: css || null,
        }),
      });
      setSaved(true);
      setError(null);
      setTimeout(() => window.location.reload(), 500);
    } catch (caught) {
      setError(caught);
    }
  }
  async function upload(kind: "logo" | "favicon", file: File) {
    const body = new FormData();
    body.append("file", file);
    try {
      await api<void>(`/admin/branding/${kind}`, { method: "POST", body });
      setSaved(true);
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <AdminPage
      title="Branding"
      description="Branding applies before login and throughout the application. Custom CSS is trusted administrator content."
    >
      <form
        className="panel grid max-w-3xl gap-5 rounded-2xl p-6"
        onSubmit={submit}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Server name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Accent"
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold">
            <span>Logo (PNG, JPEG, WebP; max 1 MiB)</span>
            <input
              className="field"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) =>
                e.target.files?.[0] && void upload("logo", e.target.files[0])
              }
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            <span>Favicon (PNG or ICO; max 1 MiB)</span>
            <input
              className="field"
              type="file"
              accept="image/png,image/x-icon"
              onChange={(e) =>
                e.target.files?.[0] && void upload("favicon", e.target.files[0])
              }
            />
          </label>
        </div>
        <label className="grid gap-1.5 text-sm font-semibold">
          <span>Custom CSS</span>
          <textarea
            className="field min-h-56 font-mono text-sm font-normal"
            maxLength={65536}
            value={css}
            onChange={(e) => setCss(e.target.value)}
            placeholder="/* Trusted administrator CSS, max 64 KiB */"
          />
        </label>
        {saved && (
          <p className="text-sm text-green-600">Branding saved. Refreshing…</p>
        )}
        <ErrorNotice error={error} />
        <Button className="justify-self-start" type="submit">
          Save branding
        </Button>
      </form>
    </AdminPage>
  );
}
