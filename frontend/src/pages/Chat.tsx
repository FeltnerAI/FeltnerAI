import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  Check,
  Copy,
  MessagesSquare,
  MessageSquarePlus,
  PanelLeftClose,
  Pencil,
  RefreshCw,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, chatApi, streamGeneration } from "../api/client";
import type { Chat, Message, Model, StreamEvent } from "../api/generated";
import { useFeedback } from "../components/feedback";
import {
  Button,
  EdgeTab,
  EmptyState,
  ErrorNotice,
  Select,
} from "../components/ui";
import { scrollMessageIntoView } from "../dom";

const Markdown = lazy(() => import("../components/Markdown"));

function wideViewport() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 1024px)").matches
  );
}

export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { confirm, prompt } = useFeedback();
  // Conversations rail: open by default on desktop, collapsed on phones.
  const [sidebarOpen, setSidebarOpen] = useState(wideViewport);
  const closeOnNarrow = () => {
    if (!wideViewport()) setSidebarOpen(false);
  };
  const [draft, setDraft] = useState("");
  const [modelOverrides, setModelOverrides] = useState<Record<string, string>>(
    {},
  );
  const [streaming, setStreaming] = useState(false);
  const [streamedMessage, setStreamedMessage] = useState<Message | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [atBottom, setAtBottom] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chats = useQuery({ queryKey: ["chats"], queryFn: chatApi.list });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => api<Model[]>("/models"),
  });
  const messages = useQuery({
    queryKey: ["messages", chatId],
    queryFn: () => chatApi.messages(chatId!),
    enabled: Boolean(chatId),
  });
  const activeChat = chats.data?.find((chat) => chat.id === chatId);
  const modelKey = chatId ?? "new";
  const selectedModel =
    modelOverrides[modelKey] ??
    activeChat?.model_id ??
    models.data?.find((model) => model.is_default)?.id ??
    models.data?.[0]?.id ??
    "";
  useEffect(() => {
    if (atBottom) scrollMessageIntoView(endRef.current);
  }, [messages.data, streamedMessage?.content, atBottom]);

  // Grow the composer with its content, up to a sensible cap.
  function resizeComposer() {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 192)}px`;
  }
  useEffect(resizeComposer, [draft]);

  function onScroll() {
    const node = scrollRef.current;
    if (!node) return;
    setAtBottom(
      node.scrollHeight - node.scrollTop - node.clientHeight < 80,
    );
  }

  const createChat = useMutation({
    mutationFn: () => chatApi.create(selectedModel || null),
    onSuccess: (chat) => {
      queryClient.setQueryData<Chat[]>(["chats"], (current = []) => [
        chat,
        ...current,
      ]);
      navigate(`/chats/${chat.id}`);
      closeOnNarrow();
    },
  });

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!chatId || !draft.trim() || streaming) return;
    const content = draft.trim();
    const userMessage: Message = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      role: "user",
      content,
      status: "complete",
      model_id: selectedModel || null,
      provider_name: null,
      model_name: null,
      created_at: new Date().toISOString(),
    };
    setDraft("");
    setError(null);
    setStreaming(true);
    setAtBottom(true);
    queryClient.setQueryData<Message[]>(
      ["messages", chatId],
      (current = []) => [...current, userMessage],
    );
    try {
      await runStream(
        chatId,
        {
          request_id: crypto.randomUUID(),
          content,
          model_id: selectedModel || null,
        },
        false,
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setStreaming(false);
      setStreamedMessage(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", chatId] }),
        queryClient.invalidateQueries({ queryKey: ["chats"] }),
      ]);
    }
  }

  async function regenerate() {
    if (!chatId || streaming) return;
    setError(null);
    setStreaming(true);
    queryClient.setQueryData<Message[]>(["messages", chatId], (current = []) =>
      current.slice(0, -1),
    );
    try {
      await runStream(
        chatId,
        {
          request_id: crypto.randomUUID(),
          content: "",
          model_id: selectedModel || null,
        },
        true,
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setStreaming(false);
      setStreamedMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["messages", chatId] });
    }
  }

  async function runStream(
    id: string,
    request: { request_id: string; content: string; model_id: string | null },
    regenerate: boolean,
  ) {
    await streamGeneration(id, request, regenerate, (event: StreamEvent) => {
      if (event.event === "started") {
        setStreamedMessage({
          id: event.message_id,
          chat_id: id,
          role: "assistant",
          content: "",
          status: "streaming",
          model_id: selectedModel || null,
          provider_name: null,
          model_name:
            models.data?.find((model) => model.id === selectedModel)
              ?.display_name ?? null,
          created_at: new Date().toISOString(),
        });
      } else if (event.event === "delta") {
        setStreamedMessage((current) =>
          current
            ? { ...current, content: current.content + event.content }
            : current,
        );
      } else if (event.event === "error") {
        setError(new Error(event.message));
      }
    });
  }

  async function remove(chat: Chat) {
    const ok = await confirm({
      title: `Delete “${chat.title}”?`,
      message: "This permanently deletes the conversation and all its messages.",
      confirmText: "Delete chat",
      danger: true,
    });
    if (!ok) return;
    await chatApi.delete(chat.id);
    await queryClient.invalidateQueries({ queryKey: ["chats"] });
    if (chat.id === chatId) navigate("/");
  }

  async function rename(chat: Chat) {
    const title = (
      await prompt({
        title: "Rename conversation",
        label: "Conversation title",
        defaultValue: chat.title,
        confirmText: "Rename",
      })
    )?.trim();
    if (!title) return;
    await chatApi.update(chat.id, { title });
    await queryClient.invalidateQueries({ queryKey: ["chats"] });
  }

  const renderedMessages = [
    ...(messages.data ?? []),
    ...(streamedMessage ? [streamedMessage] : []),
  ];
  return (
    <div className="flex h-screen min-h-[36rem] overflow-hidden">
      {/* Dim backdrop only while the rail overlays content (below desktop). */}
      {sidebarOpen && (
        <button
          className="fixed inset-0 z-20 bg-black/45 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close conversations"
        />
      )}
      <aside
        className={`panel flex w-72 shrink-0 flex-col border-y-0 border-l-0 p-3 transition-transform duration-200 max-lg:fixed max-lg:inset-y-0 left-0 max-lg:z-30 md:left-64 ${sidebarOpen ? "max-lg:translate-x-0 lg:flex" : "max-lg:-translate-x-full lg:hidden"}`}
      >
        <div className="mb-3 flex items-center gap-2">
          <Button
            className="flex-1"
            onClick={() => createChat.mutate()}
            disabled={createChat.isPending}
          >
            <MessageSquarePlus size={18} /> New chat
          </Button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
            aria-label="Collapse conversations"
            title="Collapse"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {chats.data?.map((chat) => (
            <div
              key={chat.id}
              className={`group flex items-center rounded-xl transition ${chat.id === chatId ? "bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] shadow-[0_10px_28px_-16px_var(--glow)]" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
            >
              <button
                className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm font-medium"
                onClick={() => {
                  navigate(`/chats/${chat.id}`);
                  closeOnNarrow();
                }}
              >
                {chat.title}
              </button>
              <button
                className="p-2 opacity-0 transition group-hover:opacity-70 hover:!opacity-100"
                onClick={() => void rename(chat)}
                aria-label={`Rename ${chat.title}`}
              >
                <Pencil size={14} />
              </button>
              <button
                className="p-2 opacity-0 transition group-hover:opacity-70 hover:!opacity-100"
                onClick={() => void remove(chat)}
                aria-label={`Delete ${chat.title}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>
      <section className="relative flex min-w-0 flex-1 flex-col">
        {/* Pull tab — reveals the conversations rail at every breakpoint. */}
        {!sidebarOpen && (
          <EdgeTab
            icon={MessagesSquare}
            label="Open conversations"
            onClick={() => setSidebarOpen(true)}
            className="absolute top-[58%] left-0"
          />
        )}
        <header className="frosted-bar sticky top-0 z-[5] flex min-h-16 items-center gap-3 border-b border-[var(--border)] px-4">
          <h1 className="min-w-0 flex-1 truncate font-bold tracking-tight">
            {activeChat?.title ?? "Chats"}
          </h1>
          {!!models.data?.length && (
            <Select
              className="max-w-[52vw] sm:max-w-none"
              label="Model"
              value={selectedModel}
              onValueChange={(value) => {
                setModelOverrides((current) => ({
                  ...current,
                  [modelKey]: value,
                }));
                if (chatId) void chatApi.update(chatId, { model_id: value });
              }}
              options={models.data.map((model) => ({
                value: model.id,
                label: `${model.display_name} · ${model.provider_name}`,
              }))}
            />
          )}
        </header>
        {!chatId ? (
          <EmptyState title="Start a conversation">
            <p>
              Choose an enabled model and create a chat. Your history stays on
              this server.
            </p>
            <Button className="mt-5" onClick={() => createChat.mutate()}>
              Create chat
            </Button>
          </EmptyState>
        ) : (
          <>
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <div className="mx-auto grid max-w-3xl gap-5 p-5 py-8">
                {renderedMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {!renderedMessages.length && (
                  <EmptyState title="What are you working on?">
                    Send a message to begin this conversation.
                  </EmptyState>
                )}
                <ErrorNotice error={error} />
                <div ref={endRef} />
              </div>
            </div>
            {!atBottom && (
              <button
                onClick={() => {
                  setAtBottom(true);
                  scrollMessageIntoView(endRef.current);
                }}
                className="panel-strong absolute right-6 bottom-28 z-10 grid h-10 w-10 place-items-center rounded-full"
                aria-label="Scroll to latest"
              >
                <ArrowDown size={18} />
              </button>
            )}
            <div className="frosted-bar border-t border-[var(--border)] p-4">
              <form
                onSubmit={send}
                className="mx-auto flex max-w-3xl items-end gap-2"
              >
                <textarea
                  ref={composerRef}
                  aria-label="Message"
                  className="field max-h-48 min-h-12 resize-none"
                  rows={1}
                  value={draft}
                  disabled={streaming}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={
                    models.data?.length
                      ? "Message…"
                      : "Ask an administrator to enable a model"
                  }
                />
                {streaming ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => chatApi.stop(chatId)}
                  >
                    <Square size={17} /> Stop
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={!draft.trim() || !models.data?.length}
                  >
                    <Send size={17} /> Send
                  </Button>
                )}
              </form>
              {!!messages.data?.length &&
                messages.data.at(-1)?.role === "assistant" &&
                !streaming && (
                  <div className="mx-auto mt-2 max-w-3xl text-right">
                    <Button variant="ghost" onClick={() => void regenerate()}>
                      <RefreshCw size={15} /> Regenerate
                    </Button>
                  </div>
                )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const text = message.content.replace(/^\s+/, "");

  function copy() {
    void navigator.clipboard?.writeText(message.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <article
      className={`message-in group relative rounded-2xl px-4 py-3.5 ${
        isUser
          ? "ml-auto max-w-[85%] bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] shadow-[0_14px_36px_-18px_var(--glow)]"
          : "panel mr-auto w-full"
      }`}
    >
      <div className="prose-message">
        {text ? (
          isUser ? (
            <span className="whitespace-pre-wrap">{text}</span>
          ) : (
            <Suspense
              fallback={<span className="whitespace-pre-wrap">{text}</span>}
            >
              <Markdown>{text}</Markdown>
            </Suspense>
          )
        ) : message.status === "streaming" ? (
          <span className="inline-flex gap-1 align-middle">
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current" />
          </span>
        ) : (
          ""
        )}
      </div>
      {!isUser && message.model_name && (
        <div className="mt-3 text-xs text-[var(--muted)]">
          {message.provider_name ? `${message.provider_name} · ` : ""}
          {message.model_name}
          {message.status !== "complete" ? ` · ${message.status}` : ""}
        </div>
      )}
      {!isUser && text && (
        <button
          onClick={copy}
          className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] opacity-0 transition hover:bg-black/5 hover:text-current group-hover:opacity-100 dark:hover:bg-white/10"
          aria-label="Copy message"
          title="Copy"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      )}
    </article>
  );
}
