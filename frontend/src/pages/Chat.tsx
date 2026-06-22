import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquarePlus,
  MessagesSquare,
  PanelLeftClose,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api, chatApi, streamGeneration } from "@/api/client";
import type { Chat, Message, Model, StreamEvent } from "@/api/generated";
import { Thread } from "@/components/assistant-ui/thread";
import { Button, EdgeTab, EmptyState, ErrorNotice, Select } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { cn } from "@/lib/utils";

function wideViewport() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 1024px)").matches
  );
}

function toThreadMessage(message: Message): ThreadMessageLike {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      content: [{ type: "text", text: message.content }],
    };
  }
  return {
    id: message.id,
    role: "assistant",
    content: [{ type: "text", text: message.content }],
    status:
      message.status === "streaming"
        ? { type: "running" }
        : { type: "complete", reason: "stop" },
  };
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
  const [modelOverrides, setModelOverrides] = useState<Record<string, string>>(
    {},
  );
  const [streaming, setStreaming] = useState(false);
  const [streamedMessage, setStreamedMessage] = useState<Message | null>(null);
  const [error, setError] = useState<unknown>(null);

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

  async function send(content: string) {
    if (!chatId || !content.trim() || streaming) return;
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
      // Refetch first so the persisted message is in place, then drop the
      // streamed copy — avoids a one-frame gap where the bubble disappears.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", chatId] }),
        queryClient.invalidateQueries({ queryKey: ["chats"] }),
      ]);
      setStreamedMessage(null);
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
      await queryClient.invalidateQueries({ queryKey: ["messages", chatId] });
      setStreamedMessage(null);
    }
  }

  // Append the in-flight streamed message only while the persisted list does not
  // already contain it. Once the post-stream refetch lands, the real message
  // (same id) takes over seamlessly, so clearing `streamedMessage` afterwards
  // can't cause the bubble to blink out and re-animate.
  const baseMessages = messages.data ?? [];
  const renderedMessages =
    streamedMessage &&
    !baseMessages.some((message) => message.id === streamedMessage.id)
      ? [...baseMessages, streamedMessage]
      : baseMessages;

  const runtime = useExternalStoreRuntime<Message>({
    messages: renderedMessages,
    isRunning: streaming,
    convertMessage: toThreadMessage,
    onNew: async (message) => {
      const text = message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
      await send(text);
    },
    onReload: async () => {
      await regenerate();
    },
    onCancel: async () => {
      if (chatId) await chatApi.stop(chatId).catch(() => undefined);
    },
  });

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

  const hasModels = Boolean(models.data?.length);

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
        className={cn(
          "panel flex w-72 shrink-0 flex-col border-y-0 border-l-0 p-3 transition-transform duration-200 max-lg:fixed max-lg:inset-y-0 left-0 max-lg:z-30 md:left-64",
          sidebarOpen
            ? "max-lg:translate-x-0 lg:flex"
            : "max-lg:-translate-x-full lg:hidden",
        )}
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
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
              className={cn(
                "group flex items-center rounded-xl transition",
                chat.id === chatId
                  ? "bg-[image:var(--accent-grad)] text-primary-foreground shadow-[0_10px_28px_-16px_var(--glow)]"
                  : "hover:bg-accent",
              )}
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
        <header className="frosted-bar sticky top-0 z-[5] flex min-h-16 items-center gap-3 border-b border-border px-4">
          <h1 className="min-w-0 flex-1 truncate font-bold tracking-tight">
            {activeChat?.title ?? "Chats"}
          </h1>
          {hasModels && (
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
              options={(models.data ?? []).map((model) => ({
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
          <div className="min-h-0 flex-1">
            <AssistantRuntimeProvider runtime={runtime}>
              <Thread
                composerDisabled={!hasModels}
                placeholder={
                  hasModels
                    ? "Message…"
                    : "Ask an administrator to enable a model"
                }
                welcome={
                  <EmptyState title="What are you working on?">
                    Send a message to begin this conversation.
                  </EmptyState>
                }
                headerSlot={
                  error ? (
                    <div className="mx-auto w-full max-w-3xl px-5 pt-4">
                      <ErrorNotice error={error} />
                    </div>
                  ) : undefined
                }
              />
            </AssistantRuntimeProvider>
          </div>
        )}
      </section>
    </div>
  );
}
