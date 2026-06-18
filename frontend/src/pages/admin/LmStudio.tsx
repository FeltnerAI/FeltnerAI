import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleSlash,
  Cpu,
  Download,
  Play,
  RefreshCw,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type {
  LmStudioLoadRequest,
  LmStudioModel,
  LmStudioStatus,
} from "../../api/generated";
import { useFeedback } from "../../components/feedback";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Input,
  Modal,
  Spinner,
} from "../../components/ui";
import { AdminPage } from "./Users";

const STATUS_KEY = ["admin", "lmstudio"];

function formatBytes(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function AdminLmStudioPage() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const [loadTarget, setLoadTarget] = useState<LmStudioModel | null>(null);

  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => api<LmStudioStatus>("/admin/lmstudio/status"),
    refetchInterval: 6000,
  });

  const apply = (next: LmStudioStatus) =>
    queryClient.setQueryData(STATUS_KEY, next);

  const serverMutation = useMutation({
    mutationFn: (action: "start" | "stop") =>
      api<LmStudioStatus>("/admin/lmstudio/server", {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    onSuccess: (next, action) => {
      apply(next);
      toast(`LM Studio server ${action === "start" ? "started" : "stopped"}.`, "success");
    },
    onError: (error) => toast(String((error as Error).message), "error"),
  });

  const unloadMutation = useMutation({
    mutationFn: (model: string | null) =>
      api<LmStudioStatus>("/admin/lmstudio/models/unload", {
        method: "POST",
        body: JSON.stringify({ model }),
      }),
    onSuccess: (next, model) => {
      apply(next);
      toast(model ? "Model unloaded." : "All models unloaded.", "success");
    },
    onError: (error) => toast(String((error as Error).message), "error"),
  });

  const loadMutation = useMutation({
    mutationFn: (request: LmStudioLoadRequest) =>
      api<LmStudioStatus>("/admin/lmstudio/models/load", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    onSuccess: (next, request) => {
      apply(next);
      setLoadTarget(null);
      toast(`Loaded ${request.model}.`, "success");
    },
    onError: (error) => toast(String((error as Error).message), "error"),
  });

  const data = status.data;
  const busy =
    serverMutation.isPending || unloadMutation.isPending || loadMutation.isPending;

  return (
    <AdminPage
      title="LM Studio"
      description="Drive a local LM Studio installation through its CLI: start or stop the local server and load or unload models on demand. Nothing loads automatically."
    >
      <div className="mb-4 flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => void status.refetch()}
          disabled={status.isFetching}
        >
          {status.isFetching ? <Spinner size={16} /> : <RefreshCw size={16} />}
          Refresh
        </Button>
      </div>

      {!data ? (
        <div className="panel grid gap-3 rounded-2xl p-6">
          <div className="skeleton h-5 w-40" />
          <div className="skeleton h-3 w-full" />
          <div className="skeleton h-3 w-2/3" />
        </div>
      ) : !data.cli_available ? (
        <div className="card grid gap-3 rounded-2xl p-6">
          <div className="flex items-center gap-2 text-[var(--danger)]">
            <TriangleAlert size={18} />
            <strong>LM Studio CLI not found</strong>
          </div>
          <p className="text-sm text-[var(--muted)]">
            {data.message ??
              "Install LM Studio and ensure the `lms` command is available."}
          </p>
          <p className="text-sm text-[var(--muted)]">
            If `lms` is installed in a non-standard location, set its full path in{" "}
            <Link
              to="/admin/server"
              className="font-semibold text-[var(--accent)] underline"
            >
              Server settings
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="grid gap-5">
          {/* CLI + server status */}
          <section className="card grid gap-4 rounded-2xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-[image:var(--accent-grad)] text-[var(--accent-contrast)]">
                  <Cpu size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Local server</h2>
                  <p className="text-sm text-[var(--muted)]">
                    {data.server_running ? (
                      <>
                        Running
                        {data.server_url ? ` · ${data.server_url}` : ""}
                      </>
                    ) : (
                      "Stopped"
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={data.server_running ? "success" : "neutral"}>
                  {data.server_running ? "Online" : "Offline"}
                </Badge>
                {data.server_running ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => serverMutation.mutate("stop")}
                  >
                    <Square size={16} /> Stop server
                  </Button>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() => serverMutation.mutate("start")}
                  >
                    <Play size={16} /> Start server
                  </Button>
                )}
              </div>
            </div>
            <div className="text-xs text-[var(--muted)]">
              {data.version ? `lms ${data.version}` : "lms"}
              {data.cli_path ? ` · ${data.cli_path}` : ""}
            </div>
            {data.server_running && data.server_url && (
              <p className="text-xs text-[var(--muted)]">
                To chat with a loaded model, add a Provider pointing at{" "}
                <code className="rounded bg-[var(--muted)]/15 px-1.5 py-0.5">
                  {data.server_url}/v1
                </code>{" "}
                and configure its models — LM Studio control and the model
                registry stay separate.
              </p>
            )}
          </section>

          {/* Loaded models */}
          <section className="card grid gap-3 rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Loaded models</h2>
              {data.loaded.length > 0 && (
                <Button
                  variant="ghost"
                  className="text-[var(--muted)]"
                  disabled={busy}
                  onClick={() => unloadMutation.mutate(null)}
                >
                  <CircleSlash size={16} /> Unload all
                </Button>
              )}
            </div>
            {data.loaded.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No models are currently loaded into memory.
              </p>
            ) : (
              <ul className="grid gap-2">
                {data.loaded.map((model) => (
                  <ModelRow key={model.id} model={model}>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => unloadMutation.mutate(model.id)}
                    >
                      <Trash2 size={15} /> Unload
                    </Button>
                  </ModelRow>
                ))}
              </ul>
            )}
          </section>

          {/* Downloaded models */}
          <section className="card grid gap-3 rounded-2xl p-6">
            <h2 className="text-lg font-bold">Downloaded models</h2>
            {data.downloaded.length === 0 ? (
              <EmptyState title="Nothing downloaded">
                Download models in the LM Studio app, then refresh to load them
                here.
              </EmptyState>
            ) : (
              <ul className="grid gap-2">
                {data.downloaded.map((model) => {
                  const loaded = data.loaded.some(
                    (item) => item.id === model.id,
                  );
                  return (
                    <ModelRow key={model.id} model={model}>
                      {loaded ? (
                        <Badge tone="success">Loaded</Badge>
                      ) : (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setLoadTarget(model)}
                        >
                          <Download size={15} /> Load
                        </Button>
                      )}
                    </ModelRow>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      <ErrorNotice error={status.error} />

      <LoadModelModal
        model={loadTarget}
        pending={loadMutation.isPending}
        onOpenChange={(open) => !open && setLoadTarget(null)}
        onConfirm={(contextLength) =>
          loadTarget &&
          loadMutation.mutate({
            model: loadTarget.id,
            context_length: contextLength,
          })
        }
      />
    </AdminPage>
  );
}

function ModelRow({
  model,
  children,
}: {
  model: LmStudioModel;
  children: ReactNode;
}) {
  const size = formatBytes(model.size_bytes);
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-solid)]/40 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-semibold">
          {model.display_name ?? model.id}
        </p>
        <p className="truncate font-mono text-xs text-[var(--muted)]">
          {model.id}
          {size ? ` · ${size}` : ""}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

function LoadModelModal({
  model,
  pending,
  onOpenChange,
  onConfirm,
}: {
  model: LmStudioModel | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (contextLength: number | null) => void;
}) {
  const [contextLength, setContextLength] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number.parseInt(contextLength, 10);
    onConfirm(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  }
  return (
    <Modal
      open={Boolean(model)}
      onOpenChange={(open) => {
        if (!open) setContextLength("");
        onOpenChange(open);
      }}
      title={`Load ${model?.display_name ?? model?.id ?? "model"}`}
      description="The model is loaded into memory with LM Studio's defaults unless you override the context length."
    >
      <form className="grid gap-4" onSubmit={submit}>
        <Input
          label="Context length (optional)"
          type="number"
          min={1}
          value={contextLength}
          onChange={(event) => setContextLength(event.target.value)}
          placeholder="Use model default"
          hint="Leave blank to use LM Studio's default context length."
        />
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner size={16} /> : <Download size={16} />}
          Load model
        </Button>
      </form>
    </Modal>
  );
}
