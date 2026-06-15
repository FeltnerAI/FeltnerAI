import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import type { Model, Provider } from "../../api/generated";
import { Button, ErrorNotice, Input, Modal, Select } from "../../components/ui";
import { AdminPage } from "./Users";

export function AdminModelsPage() {
  const queryClient = useQueryClient();
  const models = useQuery({
    queryKey: ["admin", "models"],
    queryFn: () => api<Model[]>("/admin/models"),
  });
  const providers = useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => api<Provider[]>("/admin/providers"),
  });
  const [creating, setCreating] = useState(false);
  async function remove(model: Model) {
    if (
      !confirm(
        `Remove ${model.display_name}? Existing chat history keeps its snapshot.`,
      )
    )
      return;
    await api(`/admin/models/${model.id}`, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["admin", "models"] });
  }
  return (
    <AdminPage
      title="Models"
      description="Enable discovered or manually entered upstream models and select one global default."
    >
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => setCreating(true)}
          disabled={!providers.data?.length}
        >
          <Plus size={17} /> Configure model
        </Button>
      </div>
      <div className="panel overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="border-b border-[var(--border)] text-[var(--muted)]">
            <tr>
              <th className="p-4">Display name</th>
              <th>Upstream ID</th>
              <th>Provider</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {models.data?.map((model) => (
              <tr
                key={model.id}
                className="border-b border-[var(--border)] last:border-0"
              >
                <td className="p-4 font-bold">
                  {model.display_name}
                  {model.is_default && (
                    <span className="ml-2 rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs text-white">
                      Default
                    </span>
                  )}
                </td>
                <td className="font-mono text-xs">{model.upstream_id}</td>
                <td>{model.provider_name}</td>
                <td>{model.enabled ? "Enabled" : "Disabled"}</td>
                <td className="pr-3 text-right">
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${model.display_name}`}
                    onClick={() => void remove(model)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorNotice error={models.error ?? providers.error} />
      <ConfigureModel
        open={creating}
        onOpenChange={setCreating}
        providers={providers.data ?? []}
        onConfigured={() =>
          queryClient.invalidateQueries({ queryKey: ["admin", "models"] })
        }
      />
    </AdminPage>
  );
}

function ConfigureModel({
  open,
  onOpenChange,
  providers,
  onConfigured,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: Provider[];
  onConfigured: () => void;
}) {
  const [providerId, setProviderId] = useState("");
  const [upstreamId, setUpstreamId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [isDefault, setDefault] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const selected = providerId || providers[0]?.id || "";
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api<Model>(`/admin/providers/${selected}/models`, {
        method: "POST",
        body: JSON.stringify({
          upstream_id: upstreamId,
          display_name: displayName,
          enabled,
          is_default: isDefault,
        }),
      });
      onConfigured();
      onOpenChange(false);
      setUpstreamId("");
      setDisplayName("");
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Configure model">
      <form className="grid gap-4" onSubmit={submit}>
        <Select
          label="Provider"
          value={selected}
          onValueChange={setProviderId}
          options={providers.map((provider) => ({
            value: provider.id,
            label: provider.name,
          }))}
        />
        <Input
          label="Upstream model ID"
          required
          value={upstreamId}
          onChange={(e) => {
            setUpstreamId(e.target.value);
            if (!displayName) setDisplayName(e.target.value);
          }}
        />
        <Input
          label="Display name"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          Enabled for users
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setDefault(e.target.checked)}
          />{" "}
          Make global default
        </label>
        <ErrorNotice error={error} />
        <Button type="submit">Save model</Button>
      </form>
    </Modal>
  );
}
