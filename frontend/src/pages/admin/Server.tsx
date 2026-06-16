import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, apiBlob } from "../../api/client";
import type { ImportDataResponse, ServerSettings } from "../../api/generated";
import { Button, ErrorNotice, Input } from "../../components/ui";
import { AdminPage } from "./Users";

export function AdminServerPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin", "server"],
    queryFn: () => api<ServerSettings>("/admin/server"),
  });
  if (!settings.data) {
    return (
      <AdminPage
        title="Server"
        description="Public URL and trusted proxy settings used for external links and client-address handling."
      >
        <ErrorNotice error={settings.error} />
        <p>Loading server settings…</p>
      </AdminPage>
    );
  }
  return (
    <ServerForm
      settings={settings.data}
      onSaved={() =>
        queryClient.invalidateQueries({ queryKey: ["admin", "server"] })
      }
    />
  );
}

function ServerForm({
  settings,
  onSaved,
}: {
  settings: ServerSettings;
  onSaved: () => Promise<unknown>;
}) {
  const [publicUrl, setPublicUrl] = useState(settings.public_url ?? "");
  const [proxies, setProxies] = useState(settings.trusted_proxies.join(", "));
  const [startAtLogin, setStartAtLogin] = useState(settings.start_at_login);
  const [saved, setSaved] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api<ServerSettings>("/admin/server", {
        method: "PUT",
        body: JSON.stringify({
          public_url: publicUrl || null,
          trusted_proxies: proxies
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          start_at_login: startAtLogin,
        }),
      });
      setSaved(true);
      setError(null);
      await onSaved();
    } catch (caught) {
      setError(caught);
    }
  }
  async function exportBackup() {
    setBackupBusy(true);
    setError(null);
    try {
      const blob = await apiBlob("/admin/data/export");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `feltnerai-backup-${new Date().toISOString().replaceAll(":", "-")}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setBackupMessage("Backup exported.");
    } catch (caught) {
      setError(caught);
    } finally {
      setBackupBusy(false);
    }
  }
  async function importBackup(file: File) {
    if (
      !confirm(
        "Importing this backup replaces every user, provider, model, chat, message, and server setting. FeltnerAI will restart. Continue?",
      )
    ) {
      return;
    }
    setBackupBusy(true);
    setError(null);
    setBackupMessage("");
    const body = new FormData();
    body.append("backup", file);
    try {
      const result = await api<ImportDataResponse>("/admin/data/import", {
        method: "POST",
        body,
      });
      setBackupMessage(result.message);
      setTimeout(() => window.location.reload(), 3000);
    } catch (caught) {
      setError(caught);
    } finally {
      setBackupBusy(false);
    }
  }
  return (
    <AdminPage
      title="Server"
      description="Public URL and trusted proxy settings used for external links and client-address handling."
    >
      <form
        className="panel grid max-w-2xl gap-4 rounded-2xl p-6"
        onSubmit={submit}
      >
        <Input
          label="Public URL"
          type="url"
          value={publicUrl}
          onChange={(e) => setPublicUrl(e.target.value)}
          placeholder="https://ai.example.com"
          hint="HTTPS is required except for localhost."
        />
        <Input
          label="Trusted proxy IPs"
          value={proxies}
          onChange={(e) => setProxies(e.target.value)}
          placeholder="10.0.0.2, 127.0.0.1"
          hint="Comma-separated exact IP addresses. Environment configuration takes effect at startup."
        />
        <Input
          label="Data location"
          value={settings.data_dir}
          readOnly
          hint="Database, encryption key, staged imports, and rollback data live here."
        />
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={startAtLogin}
            disabled={!settings.startup_supported}
            onChange={(event) => setStartAtLogin(event.target.checked)}
          />
          Open FeltnerAI Server when I sign in to Windows
        </label>
        {!settings.startup_supported && (
          <p className="text-sm text-[var(--muted)]">
            Start at login is available when the server is running on Windows.
          </p>
        )}
        {saved && (
          <p className="text-sm text-green-600">Server settings saved.</p>
        )}
        <ErrorNotice error={error} />
        <Button className="justify-self-start" type="submit">
          Save settings
        </Button>
      </form>
      <section className="panel mt-5 grid max-w-2xl gap-4 rounded-2xl p-6">
        <div>
          <h2 className="text-xl font-bold">Backup and restore</h2>
          <p className="text-sm text-[var(--muted)]">
            Exports include every account and chat plus provider credentials.
            Store backup ZIPs as secrets.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => void exportBackup()}
            disabled={backupBusy}
          >
            Export all data
          </Button>
          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-[var(--border)] px-4 py-2 font-semibold">
            Import backup ZIP
            <input
              className="sr-only"
              type="file"
              accept=".zip,application/zip"
              disabled={backupBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBackup(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {backupMessage && (
          <p className="text-sm text-green-600">{backupMessage}</p>
        )}
      </section>
    </AdminPage>
  );
}
