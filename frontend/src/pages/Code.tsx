import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import {
  FolderOpen,
  FolderPlus,
  ListChecks,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { api } from "@/api/client";
import type { Model } from "@/api/generated";
import { Agent } from "@/agent/engine";
import type {
  AgentEvent,
  ApprovalRequest,
  Frontend,
  Mode,
  PlanStep,
  Question,
} from "@/agent/types";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Thread } from "@/components/assistant-ui/thread";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { Button, EmptyState, ErrorNotice, Modal, Select } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { Textarea } from "@/components/ui/textarea";
import { isPortal, portal, type CodeProject } from "@/portal";
import { cn } from "@/lib/utils";

const TEMPERATURE = 0.2;

const MODE_LABELS: Record<Mode, string> = {
  plan: "Plan",
  approve: "Approve",
  auto: "Auto",
};

interface PendingApproval extends ApprovalRequest {
  resolve: (approved: boolean) => void;
}
interface PendingQuestion extends Question {
  resolve: (answer: string) => void;
}

const AGENT_PARTS: ComponentProps<typeof Thread>["parts"] = {
  Text: MarkdownText,
  tools: { Fallback: ToolFallback },
};

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
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [docName, setDocName] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);

  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [question, setQuestion] = useState<PendingQuestion | null>(null);

  const agentRef = useRef<Agent | null>(null);
  const counter = useRef(0);
  const nextId = () => `m${(counter.current += 1)}`;

  // Reset the conversation when the active project changes. This follows React's
  // "adjust state while rendering" pattern rather than an effect, so the cleared
  // transcript is rendered in the same pass the project switches.
  const [lastProjectId, setLastProjectId] = useState(active?.id);
  if (active?.id !== lastProjectId) {
    setLastProjectId(active?.id);
    agentRef.current = null;
    setMessages([]);
    setStreamingText("");
    setPlan([]);
    setDocName(null);
  }

  useEffect(() => {
    if (!isPortal) return;
    portal.listProjects().then(setProjects).catch(setError);
  }, []);

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
            setStreamingText((current) => current + event.text);
            break;
          case "assistant_done":
            setStreamingText("");
            setMessages((items) => [
              ...items,
              {
                id: nextId(),
                role: "assistant",
                content: [{ type: "text", text: event.text }],
              },
            ]);
            break;
          case "tool_started":
            setMessages((items) => [
              ...items,
              {
                id: event.id,
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: event.id,
                    toolName: event.name,
                    args: { summary: event.summary },
                  },
                ],
              },
            ]);
            break;
          case "tool_finished":
            setMessages((items) =>
              items.map((item) =>
                item.id === event.id
                  ? {
                      ...item,
                      content: [
                        {
                          type: "tool-call",
                          toolCallId: event.id,
                          toolName: event.name,
                          args: { summary: toolSummary(item) },
                          result: event.output,
                          isError: !event.ok,
                        },
                      ],
                    }
                  : item,
              ),
            );
            break;
          case "plan_updated":
            setPlan(event.steps);
            break;
          case "notice":
            setMessages((items) => [
              ...items,
              {
                id: nextId(),
                role: "system",
                content: [{ type: "text", text: event.text }],
              },
            ]);
            break;
          case "error":
            setError(new Error(event.text));
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
    approval?.resolve(false);
    question?.resolve("(stopped)");
    setApproval(null);
    setQuestion(null);
    agentRef.current?.abort();
  }, [approval, busy, question]);

  async function send(input: string) {
    const trimmed = input.trim();
    if (!trimmed || busy || !active || !selectedModel) return;
    setCancelRequested(false);
    setError(null);
    setMessages((items) => [
      ...items,
      { id: nextId(), role: "user", content: [{ type: "text", text: trimmed }] },
    ]);
    setBusy(true);
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
      await agentRef.current.runTurn(trimmed);
    } catch (caught) {
      setError(caught);
    } finally {
      setStreamingText("");
      setBusy(false);
      setCancelRequested(false);
    }
  }

  const runtimeMessages: ThreadMessageLike[] = [
    ...messages,
    ...(streamingText
      ? [
          {
            id: "__streaming",
            role: "assistant" as const,
            content: [{ type: "text" as const, text: streamingText }],
            status: { type: "running" as const },
          },
        ]
      : []),
  ];

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: runtimeMessages,
    isRunning: busy,
    convertMessage: (message) => message,
    onNew: async (message) => {
      const text = message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");
      await send(text);
    },
    onCancel: async () => stopRun(),
  });

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
          <span className="text-[0.68rem] font-bold tracking-[0.12em] text-muted-foreground uppercase">
            Projects
          </span>
          <button
            onClick={() => void addProject()}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
              className={cn(
                "group flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 transition",
                active?.id === project.id
                  ? "bg-[image:var(--accent-grad)] text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
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
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
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
            <header className="flex flex-wrap items-center gap-3 border-b border-border p-3">
              <div className="min-w-0 flex-1">
                <strong className="block truncate">{active.name}</strong>
                <span className="block truncate text-xs text-muted-foreground">
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

            <div className="min-h-0 flex-1">
              <AssistantRuntimeProvider runtime={runtime}>
                <Thread
                  parts={AGENT_PARTS}
                  composerDisabled={!selectedModel}
                  placeholder={`Ask FeltnerAI Code to work in ${active.name}…`}
                  welcome={
                    <EmptyState title="What should we build?">
                      Describe a task and FeltnerAI Code will plan, edit files,
                      and run commands in {active.name}.
                    </EmptyState>
                  }
                  headerSlot={
                    <div className="mx-auto w-full max-w-3xl px-5">
                      {plan.length > 0 && <PlanPanel steps={plan} />}
                      {error ? (
                        <div className="pt-4">
                          <ErrorNotice error={error} />
                        </div>
                      ) : null}
                    </div>
                  }
                />
              </AssistantRuntimeProvider>
            </div>
          </>
        )}
      </div>

      <ApprovalModal
        approval={approval}
        cancelRequested={cancelRequested}
        onClose={() => setApproval(null)}
      />
      <AskModal
        key={question?.prompt ?? "idle"}
        question={question}
        onClose={() => setQuestion(null)}
      />
    </div>
  );
}

function toolSummary(message: ThreadMessageLike): string {
  const part = Array.isArray(message.content) ? message.content[0] : undefined;
  if (part && typeof part === "object" && part.type === "tool-call") {
    const args = part.args as { summary?: string } | undefined;
    return args?.summary ?? part.toolName;
  }
  return "";
}

function PlanPanel({ steps }: { steps: PlanStep[] }) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-[var(--panel-solid)]/40 px-4 py-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
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
                    : "text-muted-foreground"
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
                  ? "text-muted-foreground line-through"
                  : ""
              }
            >
              {step.step}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApprovalModal({
  approval,
  cancelRequested,
  onClose,
}: {
  approval: PendingApproval | null;
  cancelRequested: boolean;
  onClose: () => void;
}) {
  const decide = (approved: boolean) => {
    approval?.resolve(approved);
    onClose();
  };
  return (
    <Modal
      open={!!approval && !cancelRequested}
      onOpenChange={(open) => {
        if (!open) decide(false);
      }}
      title="Approve action"
      description={`${MODE_LABELS.approve} mode`}
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
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={2}
              placeholder="Type an answer…"
              className="flex-1 resize-y"
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
