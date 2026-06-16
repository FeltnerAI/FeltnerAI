import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Menu,
  MessageSquarePlus,
  Pencil,
  Send,
  Square,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, chatApi, streamGeneration } from "../api/client";
import type { Chat, Message, Model, StreamEvent } from "../api/generated";
import { Button, EmptyState, ErrorNotice, Select } from "../components/ui";
import { scrollMessageIntoView } from "../dom";

export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [modelOverrides, setModelOverrides] = useState<Record<string, string>>(
    {},
  );
  const [streaming, setStreaming] = useState(false);
  const [streamedMessage, setStreamedMessage] = useState<Message | null>(null);
  const [error, setError] = useState<unknown>(null);
  const endRef = useRef<HTMLDivElement>(null);
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
    scrollMessageIntoView(endRef.current);
  }, [messages.data, streamedMessage?.content]);

  const createChat = useMutation({
    mutationFn: () => chatApi.create(selectedModel || null),
    onSuccess: (chat) => {
      queryClient.setQueryData<Chat[]>(["chats"], (current = []) => [
        chat,
        ...current,
      ]);
      navigate(`/chats/${chat.id}`);
      setSidebarOpen(false);
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
    if (!confirm(`Delete “${chat.title}” and all its messages?`)) return;
    await chatApi.delete(chat.id);
    await queryClient.invalidateQueries({ queryKey: ["chats"] });
    if (chat.id === chatId) navigate("/");
  }

  async function rename(chat: Chat) {
    const title = prompt("Conversation title", chat.title)?.trim();
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
      {sidebarOpen && (
        <button
          className="fixed inset-0 z-10 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close conversations"
        />
      )}
      <aside
        className={`panel fixed inset-y-0 left-0 z-20 flex w-72 flex-col border-y-0 border-l-0 p-3 transition-transform md:left-64 lg:static lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <Button
          onClick={() => createChat.mutate()}
          disabled={createChat.isPending}
        >
          <MessageSquarePlus size={18} /> New chat
        </Button>
        <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {chats.data?.map((chat) => (
            <div
              key={chat.id}
              className={`group flex items-center rounded-xl ${chat.id === chatId ? "bg-[var(--accent)] text-white" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
            >
              <button
                className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm font-medium"
                onClick={() => {
                  navigate(`/chats/${chat.id}`);
                  setSidebarOpen(false);
                }}
              >
                {chat.title}
              </button>
              <button
                className="p-2 opacity-60 hover:opacity-100"
                onClick={() => void rename(chat)}
                aria-label={`Rename ${chat.title}`}
              >
                <Pencil size={14} />
              </button>
              <button
                className="p-2 opacity-60 hover:opacity-100"
                onClick={() => void remove(chat)}
                aria-label={`Delete ${chat.title}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center gap-3 border-b border-[var(--border)] px-4 pl-16 md:pl-4">
          <Button
            variant="ghost"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open conversations"
          >
            <Menu size={18} />
          </Button>
          <h1 className="min-w-0 flex-1 truncate font-bold">
            {activeChat?.title ?? "Chats"}
          </h1>
          {!!models.data?.length && (
            <Select
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
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto grid max-w-3xl gap-5 p-5 py-8">
                {renderedMessages.map((message) => (
                  <article
                    key={message.id}
                    className={`rounded-2xl p-4 ${message.role === "user" ? "ml-auto max-w-[85%] bg-[var(--accent)] text-white" : "panel mr-auto w-full"}`}
                  >
                    <div className="prose-message">
                      {message.content.replace(/^\s+/, "") ||
                        (message.status === "streaming" ? "…" : "")}
                    </div>
                    {message.role === "assistant" && message.model_name && (
                      <div className="mt-3 text-xs text-[var(--muted)]">
                        {message.provider_name
                          ? `${message.provider_name} · `
                          : ""}
                        {message.model_name}
                        {message.status !== "complete"
                          ? ` · ${message.status}`
                          : ""}
                      </div>
                    )}
                  </article>
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
            <div className="border-t border-[var(--border)] p-4">
              <form
                onSubmit={send}
                className="mx-auto flex max-w-3xl items-end gap-2"
              >
                <textarea
                  aria-label="Message"
                  className="field max-h-48 min-h-12 resize-y"
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
