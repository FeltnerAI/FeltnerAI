import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Radio, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import type { ConnectionTestResponse, Provider } from "../../api/generated";
import { useFeedback } from "../../components/feedback";
import { Button, ErrorNotice, Input, Modal } from "../../components/ui";
import { AdminPage } from "./Users";

export function AdminProvidersPage() {
  const queryClient = useQueryClient();
  const { confirm, toast } = useFeedback();
  const providers = useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => api<Provider[]>("/admin/providers"),
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [result, setResult] = useState<ConnectionTestResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function test(provider: Provider) {
    try {
      setResult(
        await api<ConnectionTestResponse>(
          `/admin/providers/${provider.id}/test`,
          { method: "POST" },
        ),
      );
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }
  async function toggle(provider: Provider) {
    await api(`/admin/providers/${provider.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !provider.enabled }),
    });
    await queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
  }
  async function remove(provider: Provider) {
    const ok = await confirm({
      title: `Delete ${provider.name}?`,
      message: "This also removes every model configured under this provider.",
      confirmText: "Delete provider",
      danger: true,
    });
    if (!ok) return;
    await api(`/admin/providers/${provider.id}`, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
    toast(`Deleted ${provider.name}.`, "success");
  }
  return (
    <AdminPage
      title="Providers"
      description="Configure generic OpenAI-compatible upstreams. Credentials and secret headers are encrypted at rest."
    >
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus size={17} /> Add provider
        </Button>
      </div>
      <div className="grid gap-4">
        {providers.data?.map((provider) => (
          <article className="card rounded-2xl p-5" key={provider.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">{provider.name}</h2>
                <p className="text-sm text-[var(--muted)]">
                  {provider.base_url}
                </p>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {provider.has_api_key ? "API key stored" : "No API key"}
                  {provider.additional_header_names.length
                    ? ` · Headers: ${provider.additional_header_names.join(", ")}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void test(provider)}>
                  <Radio size={16} /> Test & discover
                </Button>
                <Button
                  variant={provider.enabled ? "secondary" : "primary"}
                  onClick={() => void toggle(provider)}
                >
                  {provider.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setEditing(provider)}
                  aria-label={`Edit ${provider.name}`}
                >
                  <Pencil size={16} />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void remove(provider)}
                  aria-label={`Delete ${provider.name}`}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {result && (
        <div
          className={`mt-4 rounded-xl p-4 ${result.ok ? "bg-green-500/10" : "bg-red-500/10"}`}
        >
          <strong>{result.message}</strong>
          {result.models.length > 0 && (
            <p className="mt-2 text-sm text-[var(--muted)]">
              {result.models.slice(0, 20).join(", ")}
              {result.models.length > 20 ? "…" : ""}
            </p>
          )}
        </div>
      )}
      <ErrorNotice error={error ?? providers.error} />
      <CreateProvider
        open={creating}
        onOpenChange={setCreating}
        onCreated={() =>
          queryClient.invalidateQueries({ queryKey: ["admin", "providers"] })
        }
      />
      <EditProvider
        provider={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onUpdated={() =>
          queryClient.invalidateQueries({ queryKey: ["admin", "providers"] })
        }
      />
    </AdminPage>
  );
}

function EditProvider({
  provider,
  onOpenChange,
  onUpdated,
}: {
  provider: Provider | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  return (
    <Modal
      open={Boolean(provider)}
      onOpenChange={onOpenChange}
      title={`Edit ${provider?.name ?? "provider"}`}
    >
      {provider && (
        <EditProviderForm
          key={provider.id}
          provider={provider}
          onUpdated={() => {
            onUpdated();
            onOpenChange(false);
          }}
        />
      )}
    </Modal>
  );
}

function EditProviderForm({
  provider,
  onUpdated,
}: {
  provider: Provider;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.base_url);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [headers, setHeaders] = useState("");
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const body: Record<string, unknown> = {
        name,
        base_url: baseUrl,
        clear_api_key: clearApiKey,
      };
      if (apiKey) body.api_key = apiKey;
      if (headers.trim()) body.additional_headers = JSON.parse(headers);
      await api<Provider>(`/admin/providers/${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onUpdated();
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Input
        label="Name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        label="Base URL"
        type="url"
        required
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.target.value)}
      />
      <Input
        label="Replacement API key"
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        hint="Leave blank to keep the stored key."
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={clearApiKey}
          onChange={(event) => setClearApiKey(event.target.checked)}
        />
        Remove the stored API key
      </label>
      <label className="grid gap-1.5 text-sm font-semibold">
        <span>Replace additional headers (JSON)</span>
        <textarea
          className="field min-h-28 font-mono text-sm font-normal"
          value={headers}
          onChange={(event) => setHeaders(event.target.value)}
          placeholder="Leave blank to keep existing secret headers"
        />
      </label>
      <ErrorNotice error={error} />
      <Button type="submit">Save provider</Button>
    </form>
  );
}

function CreateProvider({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    headers: "",
  });
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const headers = form.headers.trim() ? JSON.parse(form.headers) : {};
      await api<Provider>("/admin/providers", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          base_url: form.baseUrl,
          api_key: form.apiKey || null,
          additional_headers: headers,
          enabled: true,
        }),
      });
      onCreated();
      onOpenChange(false);
      setForm({ name: "", baseUrl: "", apiKey: "", headers: "" });
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add provider">
      <form className="grid gap-4" onSubmit={submit}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input
          label="OpenAI-compatible base URL"
          type="url"
          required
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
        />
        <Input
          label="API key (optional)"
          type="password"
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        />
        <label className="grid gap-1.5 text-sm font-semibold">
          <span>Additional headers (JSON)</span>
          <textarea
            className="field min-h-28 font-mono text-sm font-normal"
            value={form.headers}
            onChange={(e) => setForm({ ...form, headers: e.target.value })}
            placeholder={'{"X-Tenant-ID":"secret"}'}
          />
          <span className="text-xs font-normal text-[var(--muted)]">
            Authorization, cookies, host, proxy, and connection headers are
            rejected.
          </span>
        </label>
        <ErrorNotice error={error} />
        <Button type="submit">Add provider</Button>
      </form>
    </Modal>
  );
}
