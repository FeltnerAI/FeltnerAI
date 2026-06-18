import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  ListChecks,
  Send,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "../api/client";
import type { Model } from "../api/generated";
import { Agent } from "../agent/engine";
import type {
  AgentEvent,
  ApprovalRequest,
  Frontend,
  Mode,
  PlanStep,
  Question,
} from "../agent/types";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Modal,
  Select,
  Spinner,
} from "../components/ui";
import { useFeedback } from "../components/feedback";
import { isPortal, portal, type CodeProject } from "../portal";

const Markdown = lazy(() => import("../components/Markdown"));

const TEMPERATURE = 0.2;

const MODE_LABELS: Record<Mode, string> = {
  plan: "Plan",
  approve: "Approve",
  auto: "Auto",
};

type TranscriptItem =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string }
  | {
      kind: "tool";
      id: number;
      callId: string;
      name: string;
      summary: string;
      status: "running" | "ok" | "error";
      output: string;
    }
  | { kind: "notice"; id: number; text: string }
  | { kind: "error"; id: number; text: string };

interface PendingApproval extends ApprovalRequest {
  resolve: (approved: boolean) => void;
}
interface PendingQuestion extends Question {
  resolve: (answer: string) => void;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function sameProjectPath(left: string, right: string): boolean {
  const clean = (path: string) => path.replace(/[\\/]+$/, "");
  const isWindows =
    typeof navigator !== "undefined" && /win/i.test(navigator.platform);
  return isWindows
    ? clean(left).toLocaleLowerCase() === clean(right).toLocaleLowerCase()
    : clean(left) === clean(right);
}

export function CodePage() {
  const { confirm } = useFeedback();
  const [projects, setProjects] = useState<CodeProject[]>([]);
  const [active, setActive] = useState<CodeProject | null>(null);
  const [error, setError] = useState<unknown>(null);

  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => api<Model[]>("/models"),
  });
  const [model, setModel] = useState<string>("");
  const selectedModel =
    model ||
    models.data?.find((entry) => entry.is_default)?.id ||
    models.data?.[0]?.id ||
    "";

  const [mode, setMode] = useState<Mode>("approve");
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [docName, setDocName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [cancelRequested, setCancelRequested] = useState(false);

  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [question, setQuestion] = useState<PendingQuestion | null>(null);

  const agentRef = useRef<Agent | null>(null);
  const counter = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextId = () => (counter.current += 1);

  // Load saved projects on mount.
  useEffect(() => {
    if (!isPortal) return;
    portal.listProjects().then(setProjects).catch(setError);
  }, []);

  // Auto-scroll the transcript as it grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript, streaming]);

  // The agent is recreated whenever the active project changes; mode and model
  // changes are pushed into the live agent so the conversation is preserved.
  useEffect(() => {
    agentRef.current = null;
    setTranscript([]);
    setStreaming("");
    setStatus("");
    setPlan([]);
    setDocName(null);
  }, [active?.id]);

  useEffect(() => {
    agentRef.current?.setMode(mode);
  }, [mode]);
  useEffect(() => {
    if (selectedModel) agentRef.current?.setModel(selectedModel);
  }, [selectedModel]);

  const frontend = useCallback(
    (): Frontend => ({
      event: (event: AgentEvent) => {
        switch (event.kind) {
          case "assistant_delta":
            setStatus("Responding…");
            setStreaming((current) => current + event.text);
            break;
          case "assistant_done":
            setStreaming("");
            setStatus("Thinking…");
            setTranscript((items) => [
              ...items,
              { kind: "assistant", id: nextId(), text: event.text },
            ]);
            break;
          case "tool_started":
            setStatus(event.summary);
            setTranscript((items) => [
              ...items,
              {
                kind: "tool",
                id: nextId(),
                callId: event.id,
                name: event.name,
                summary: event.summary,
                status: "running",
                output: "",
              },
            ]);
            break;
          case "tool_finished":
            setTranscript((items) =>
              items.map((item) =>
                item.kind === "tool" && item.callId === event.id
                  ? {
                      ...item,
                      status: event.ok ? "ok" : "error",
                      output: event.output,
                    }
                  : item,
              ),
            );
            setStatus("Thinking…");
            break;
          case "plan_updated":
            setPlan(event.steps);
            break;
          case "notice":
            setTranscript((items) => [
              ...items,
              { kind: "notice", id: nextId(), text: event.text },
            ]);
            break;
          case "error":
            setTranscript((items) => [
              ...items,
              { kind: "error", id: nextId(), text: event.text },
            ]);
            break;
          case "turn_complete":
            break;
        }
      },
      approve: (request: ApprovalRequest) =>
        new Promise<boolean>((resolve) => setApproval({ ...request, resolve })),
      ask: (request: Question) =>
        new Promise<string>((resolve) => setQuestion({ ...request, resolve })),
    }),
    [],
  );

  async function addProject() {
    if (busy) return;
    setError(null);
    try {
      const path = await portal.pickDirectory();
      if (!path) return;
      const existing = projects.find((project) =>
        sameProjectPath(project.path, path),
      );
      if (existing) {
        await selectProject(existing);
        return;
      }
      const project: CodeProject = {
        id: crypto.randomUUID(),
        name: basename(path),
        path,
        lastUsedAt: new Date().toISOString(),
      };
      setProjects(await portal.saveProject(project));
      setActive(project);
    } catch (caught) {
      setError(caught);
    }
  }

  async function removeProject(project: CodeProject) {
    if (busy) return;
    const ok = await confirm({
      title: `Remove "${project.name}"?`,
      message:
        "This only removes it from the project list; no files are deleted.",
      confirmText: "Remove",
      danger: true,
    });
    if (!ok) return;
    setProjects(await portal.deleteProject(project.id));
    if (active?.id === project.id) setActive(null);
  }

  async function selectProject(project: CodeProject) {
    if (busy) return;
    const updated = { ...project, lastUsedAt: new Date().toISOString() };
    setActive(updated);
    setProjects(await portal.saveProject(updated));
  }

  const stopRun = useCallback(() => {
    if (!busy) return;
    setCancelRequested(true);
    setStatus("Stopping…");
    approval?.resolve(false);
    question?.resolve("(stopped)");
    setApproval(null);
    setQuestion(null);
    agentRef.current?.abort();
  }, [approval, busy, question]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const input = draft.trim();
    if (!input || busy || !active || !selectedModel) return;
    setDraft("");
    setCancelRequested(false);
    setTranscript((items) => [
      ...items,
      { kind: "user", id: nextId(), text: input },
    ]);
    setBusy(true);
    setStatus("Thinking…");
    try {
      if (!agentRef.current) {
        agentRef.current = await Agent.create(
          selectedModel,
          TEMPERATURE,
          frontend(),
          active.path,
          mode,
        );
        setDocName(agentRef.current.projectDocName());
      }
      await agentRef.current.runTurn(input);
    } catch (caught) {
      setTranscript((items) => [
        ...items,
        {
          kind: "error",
          id: nextId(),
          text: caught instanceof Error ? caught.message : String(caught),
        },
      ]);
    } finally {
      setStreaming("");
      setStatus("");
      setBusy(false);
      setCancelRequested(false);
    }
  }

  if (!isPortal) {
    return (
      <EmptyState title="Coding agent">
        The coding agent runs in the FeltnerAI Portal desktop app, where it can
        read and edit files on your machine.
      </EmptyState>
    );
  }

  const modeOptions = (Object.keys(MODE_LABELS) as Mode[]).map((value) => ({
    value,
    label: `${MODE_LABELS[value]} mode`,
  }));

  return (
    <div className="flex h-screen">
      {/* Projects rail */}
      <aside className="panel flex w-64 shrink-0 flex-col border-y-0 border-l-0 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[0.68rem] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
            Projects
          </span>
          <button
            onClick={() => void addProject()}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-black/5 hover:text-current disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
            title={busy ? "Stop the current turn first" : "Add project folder"}
            aria-label="Add project folder"
          >
            <FolderPlus size={18} />
          </button>
        </div>
        <ErrorNotice error={error} />
        <div className="grid content-start gap-1 overflow-x-hidden overflow-y-auto">
          {projects.map((project) => (
            <div
              key={project.id}
              className={`group flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 transition ${
                active?.id === project.id
                  ? "bg-[image:var(--accent-grad)] text-[var(--accent-contrast)]"
                  : "text-[var(--muted)] hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
              }`}
            >
              <button
                onClick={() => void selectProject(project)}
                disabled={busy}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
              >
                <FolderOpen size={16} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">
                    {project.name}
                  </strong>
                  <span className="block truncate text-xs opacity-70">
                    {project.path}
                  </span>
                </span>
              </button>
              <button
                onClick={() => void removeProject(project)}
                disabled={busy}
                className="shrink-0 opacity-0 transition disabled:cursor-not-allowed disabled:opacity-40 group-hover:opacity-100"
                title="Remove project"
                aria-label={`Remove ${project.name}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!projects.length && (
            <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
              Add a folder to start coding.
            </p>
          )}
        </div>
      </aside>

      {/* Conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <EmptyState title="Choose a project">
            Pick a project folder on the left, then describe what you want done.
          </EmptyState>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] p-3">
              <div className="min-w-0 flex-1">
                <strong className="block truncate">{active.name}</strong>
                <span className="block truncate text-xs text-[var(--muted)]">
                  {active.path}
                  {docName && ` · ${docName}`}
                </span>
              </div>
              <Select
                label="Mode"
                value={mode}
                onValueChange={(value) => setMode(value as Mode)}
                options={modeOptions}
              />
              {!!models.data?.length && (
                <Select
                  label="Model"
                  value={selectedModel}
                  onValueChange={setModel}
                  options={models.data.map((entry) => ({
                    value: entry.id,
                    label: entry.display_name,
                  }))}
                />
              )}
            </header>

            {plan.length > 0 && <PlanPanel steps={plan} />}

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
              <div className="mx-auto grid max-w-3xl gap-3">
                {transcript.map((item) => (
                  <TranscriptRow key={item.id} item={item} />
                ))}
                {streaming && (
                  <div className="prose-message max-w-none">
                    <Suspense fallback={<span>{streaming}</span>}>
                      <Markdown>{streaming}</Markdown>
                    </Suspense>
                  </div>
                )}
                {busy && (
                  <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                    <Spinner size={15} />
                    <span className="truncate">{status || "Thinking…"}</span>
                  </div>
                )}
              </div>
            </div>

            <form
              onSubmit={(event) => void send(event)}
              className="border-t border-[var(--border)] p-3"
            >
              <div className="mx-auto flex max-w-3xl items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  placeholder={`Ask FeltnerAI Code to work in ${active.name}…`}
                  disabled={busy}
                  className="field max-h-40 min-h-12 flex-1 resize-y"
                />
                <Button
                  type={busy ? "button" : "submit"}
                  variant={busy ? "secondary" : "primary"}
                  disabled={
                    busy ? cancelRequested : !draft.trim() || !selectedModel
                  }
                  onClick={busy ? stopRun : undefined}
                >
                  {busy ? (
                    <>
                      <Square size={15} />{" "}
                      {cancelRequested ? "Stopping" : "Stop"}
                    </>
                  ) : (
                    <Send size={17} />
                  )}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>

      <ApprovalModal approval={approval} onClose={() => setApproval(null)} />
      <AskModal
        key={question?.prompt ?? "idle"}
        question={question}
        onClose={() => setQuestion(null)}
      />
    </div>
  );
}

function TranscriptRow({ item }: { item: TranscriptItem }) {
  if (item.kind === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl bg-[image:var(--accent-grad)] px-4 py-2.5 text-[var(--accent-contrast)]">
        {item.text}
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="prose-message max-w-none">
        <Suspense fallback={<span>{item.text}</span>}>
          <Markdown>{item.text}</Markdown>
        </Suspense>
      </div>
    );
  }
  if (item.kind === "tool") return <ToolCard item={item} />;
  if (item.kind === "notice") {
    return (
      <p className="text-center text-xs text-[var(--muted)]">{item.text}</p>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">
      {item.text}
    </div>
  );
}

function ToolCard({
  item,
}: {
  item: Extract<TranscriptItem, { kind: "tool" }>;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || item.status === "error";
  const tone =
    item.status === "ok"
      ? "success"
      : item.status === "error"
        ? "danger"
        : "neutral";
  return (
    <div className="card overflow-hidden rounded-xl">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Terminal size={15} className="text-[var(--muted)]" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {item.summary}
        </span>
        <Badge tone={tone}>
          {item.status === "running" ? "running…" : item.status}
        </Badge>
      </button>
      {expanded && item.output && (
        <pre className="max-h-72 overflow-auto border-t border-[var(--border)] bg-black/20 px-3 py-2 text-xs whitespace-pre-wrap">
          {item.output}
        </pre>
      )}
    </div>
  );
}

function PlanPanel({ steps }: { steps: PlanStep[] }) {
  return (
    <div className="border-b border-[var(--border)] px-4 py-2">
      <div className="mx-auto max-w-3xl">
        <div className="mb-1 flex items-center gap-2 text-xs font-bold tracking-wide text-[var(--muted)] uppercase">
          <ListChecks size={14} /> Plan
        </div>
        <ul className="grid gap-1 text-sm">
          {steps.map((step, index) => (
            <li key={index} className="flex items-center gap-2">
              <span
                className={
                  step.status === "done"
                    ? "text-emerald-500"
                    : step.status === "in_progress"
                      ? "text-[var(--accent)]"
                      : "text-[var(--muted)]"
                }
              >
                {step.status === "done"
                  ? "✓"
                  : step.status === "in_progress"
                    ? "▸"
                    : "○"}
              </span>
              <span
                className={
                  step.status === "done"
                    ? "text-[var(--muted)] line-through"
                    : ""
                }
              >
                {step.step}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ApprovalModal({
  approval,
  onClose,
}: {
  approval: PendingApproval | null;
  onClose: () => void;
}) {
  const decide = (approved: boolean) => {
    approval?.resolve(approved);
    onClose();
  };
  return (
    <Modal
      open={!!approval}
      onOpenChange={(open) => {
        if (!open) decide(false);
      }}
      title="Approve action"
      description={approval ? MODE_LABELS.approve + " mode" : undefined}
    >
      {approval && (
        <div className="grid gap-4">
          <div>
            <p className="font-semibold">{approval.title}</p>
            {approval.detail && (
              <pre className="mt-2 max-h-60 overflow-auto rounded-xl bg-black/20 p-3 text-xs whitespace-pre-wrap">
                {approval.detail}
              </pre>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => decide(false)}>
              Deny
            </Button>
            <Button onClick={() => decide(true)}>Approve</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AskModal({
  question,
  onClose,
}: {
  question: PendingQuestion | null;
  onClose: () => void;
}) {
  // A fresh instance is mounted per question (keyed by the parent), so the
  // initial empty value is always correct without an effect.
  const [text, setText] = useState("");
  const answer = (value: string) => {
    if (!value.trim()) return;
    question?.resolve(value.trim());
    onClose();
  };
  return (
    <Modal
      open={!!question}
      onOpenChange={(open) => {
        if (!open) {
          question?.resolve("(no answer)");
          onClose();
        }
      }}
      title="The agent has a question"
    >
      {question && (
        <div className="grid gap-4">
          <p className="font-medium whitespace-pre-wrap">{question.prompt}</p>
          {question.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => (
                <Button
                  key={option}
                  variant="secondary"
                  onClick={() => answer(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              answer(text);
            }}
          >
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={2}
              placeholder="Type an answer…"
              className="field flex-1 resize-y"
            />
            <Button type="submit" disabled={!text.trim()}>
              Send
            </Button>
          </form>
        </div>
      )}
    </Modal>
  );
}
