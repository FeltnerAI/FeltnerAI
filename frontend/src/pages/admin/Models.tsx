import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import type { Model, Provider } from "../../api/generated";
import { useFeedback } from "../../components/feedback";
import {
  Badge,
  Button,
  ErrorNotice,
  Input,
  Modal,
  Select,
} from "../../components/ui";
import { AdminPage } from "./Users";

export function AdminModelsPage() {
  const queryClient = useQueryClient();
  const { confirm, toast } = useFeedback();
  const models = useQuery({
    queryKey: ["admin", "models"],
    queryFn: () => api<Model[]>("/admin/models"),
  });
  const providers = useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => api<Provider[]>("/admin/providers"),
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Model | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "models"] });

  async function toggleEnabled(model: Model) {
    await api<Model>(`/admin/models/${model.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !model.enabled }),
    });
    await invalidate();
  }

  async function remove(model: Model) {
    const ok = await confirm({
      title: `Remove ${model.display_name}?`,
      message: "Existing chat history keeps its snapshot of this model.",
      confirmText: "Remove model",
      danger: true,
    });
    if (!ok) return;
    await api(`/admin/models/${model.id}`, { method: "DELETE" });
    await invalidate();
    toast(`Removed ${model.display_name}.`, "success");
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
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="border-b border-[var(--border)] text-[var(--muted)]">
            <tr>
              <th className="p-4">Display name</th>
              <th>Upstream ID</th>
              <th>Provider</th>
              <th>Status</th>
              <th className="pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {models.data?.map((model) => (
              <tr
                key={model.id}
                className="border-b border-[var(--border)] transition last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
              >
                <td className="p-4 font-bold">
                  <span className="inline-flex items-center gap-2">
                    {model.display_name}
                    {model.is_default && <Badge tone="accent">Default</Badge>}
                  </span>
                </td>
                <td className="font-mono text-xs">{model.upstream_id}</td>
                <td>{model.provider_name}</td>
                <td>
                  <button
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${model.enabled ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-[var(--muted)]/15 text-[var(--muted)]"}`}
                    onClick={() => void toggleEnabled(model)}
                    aria-label={`${model.enabled ? "Disable" : "Enable"} ${model.display_name}`}
                  >
                    {model.enabled ? "Enabled" : "Disabled"}
                  </button>
                </td>
                <td className="pr-4">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${model.display_name}`}
                      onClick={() => setEditing(model)}
                    >
                      <Pencil size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${model.display_name}`}
                      onClick={() => void remove(model)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {models.data?.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="p-8 text-center text-[var(--muted)]"
                >
                  No models configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ErrorNotice error={models.error ?? providers.error} />
      <ConfigureModel
        open={creating}
        onOpenChange={setCreating}
        providers={providers.data ?? []}
        onSaved={() => {
          void invalidate();
          toast("Model configured.", "success");
        }}
      />
      <EditModel
        model={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => {
          void invalidate();
          toast("Model updated.", "success");
        }}
      />
    </AdminPage>
  );
}

function ConfigureModel({
  open,
  onOpenChange,
  providers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: Provider[];
  onSaved: () => void;
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
      onSaved();
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
        <ModelToggles
          enabled={enabled}
          setEnabled={setEnabled}
          isDefault={isDefault}
          setDefault={setDefault}
        />
        <ErrorNotice error={error} />
        <Button type="submit">Save model</Button>
      </form>
    </Modal>
  );
}

function EditModel({
  model,
  onOpenChange,
  onSaved,
}: {
  model: Model | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Modal
      open={Boolean(model)}
      onOpenChange={onOpenChange}
      title={`Edit ${model?.display_name ?? "model"}`}
      description={model ? `Provider: ${model.provider_name}` : undefined}
    >
      {model && (
        <EditModelForm
          key={model.id}
          model={model}
          onSaved={() => {
            onSaved();
            onOpenChange(false);
          }}
        />
      )}
    </Modal>
  );
}

function EditModelForm({
  model,
  onSaved,
}: {
  model: Model;
  onSaved: () => void;
}) {
  const [upstreamId, setUpstreamId] = useState(model.upstream_id);
  const [displayName, setDisplayName] = useState(model.display_name);
  const [enabled, setEnabled] = useState(model.enabled);
  const [isDefault, setDefault] = useState(model.is_default);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api<Model>(`/admin/models/${model.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          upstream_id: upstreamId,
          display_name: displayName,
          enabled,
          is_default: isDefault,
        }),
      });
      onSaved();
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Input
        label="Upstream model ID"
        required
        value={upstreamId}
        onChange={(e) => setUpstreamId(e.target.value)}
        hint="The model identifier sent to the provider."
      />
      <Input
        label="Display name"
        required
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <ModelToggles
        enabled={enabled}
        setEnabled={setEnabled}
        isDefault={isDefault}
        setDefault={setDefault}
      />
      <p className="text-xs text-[var(--muted)]">
        To move a model to a different provider, remove it and add it under the
        other provider.
      </p>
      <ErrorNotice error={error} />
      <Button type="submit">Save changes</Button>
    </form>
  );
}

function ModelToggles({
  enabled,
  setEnabled,
  isDefault,
  setDefault,
}: {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  isDefault: boolean;
  setDefault: (value: boolean) => void;
}) {
  return (
    <div className="grid gap-2">
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
    </div>
  );
}
