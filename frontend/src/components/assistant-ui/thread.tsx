import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { ArrowDown, Check, Copy, RefreshCw, Send, Square } from "lucide-react";
import { useMemo } from "react";
import type { ComponentProps, ReactNode } from "react";

import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { cn } from "@/lib/utils";

type PartsComponents = ComponentProps<
  typeof MessagePrimitive.Parts
>["components"];

const DEFAULT_PARTS: PartsComponents = { Text: MarkdownText };

export function Thread({
  welcome,
  placeholder = "Message…",
  composerDisabled = false,
  parts = DEFAULT_PARTS,
  headerSlot,
}: {
  welcome?: ReactNode;
  placeholder?: string;
  composerDisabled?: boolean;
  parts?: PartsComponents;
  /** Rendered pinned above the message list (e.g. the agent plan panel). */
  headerSlot?: ReactNode;
}) {
  // Build the message components map once per `parts` value. Recreating it on
  // every render gives `ThreadPrimitive.Messages` a new AssistantMessage type
  // each token, which remounts the whole bubble (replaying the entrance
  // animation and re-rendering markdown) and makes streaming flicker badly.
  const messageComponents = useMemo(
    () => ({
      UserMessage,
      AssistantMessage: (props: ComponentProps<typeof AssistantMessage>) => (
        <AssistantMessage {...props} parts={parts} />
      ),
    }),
    [parts],
  );

  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {headerSlot}
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-8">
          <ThreadPrimitive.Empty>
            {welcome ?? (
              <div className="grid flex-1 place-items-center py-16 text-center">
                <div className="max-w-md">
                  <h2 className="text-xl font-bold tracking-tight">
                    What are you working on?
                  </h2>
                  <p className="mt-2 text-muted-foreground">
                    Send a message to begin this conversation.
                  </p>
                </div>
              </div>
            )}
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages components={messageComponents} />
        </div>
      </ThreadPrimitive.Viewport>

      <div className="relative">
        <ThreadPrimitive.ScrollToBottom asChild>
          <button
            className="panel-strong absolute -top-14 right-6 z-10 grid h-10 w-10 place-items-center rounded-full disabled:invisible"
            aria-label="Scroll to latest"
          >
            <ArrowDown size={18} />
          </button>
        </ThreadPrimitive.ScrollToBottom>
        <Composer placeholder={placeholder} disabled={composerDisabled} />
      </div>
    </ThreadPrimitive.Root>
  );
}

function Composer({
  placeholder,
  disabled,
}: {
  placeholder: string;
  disabled: boolean;
}) {
  return (
    <div className="frosted-bar border-t border-border p-4">
      <ComposerPrimitive.Root className="mx-auto flex max-w-3xl items-end gap-2">
        <ComposerPrimitive.Input
          autoFocus
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Message"
          rows={1}
          className="field max-h-48 min-h-12 flex-1 resize-none"
        />
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send asChild>
            <button
              aria-label="Send"
              disabled={disabled}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-[image:var(--accent-grad)] px-4 font-semibold text-primary-foreground shadow-[0_10px_30px_-12px_var(--glow)] transition hover:brightness-110 disabled:opacity-50"
            >
              <Send size={17} /> Send
            </button>
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel asChild>
            <button
              aria-label="Stop"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--panel-strong)] px-4 font-semibold transition hover:border-[var(--accent)]"
            >
              <Square size={17} /> Stop
            </button>
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </ComposerPrimitive.Root>
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="message-in flex justify-end">
      <div className="ml-auto max-w-[85%] rounded-2xl bg-[image:var(--accent-grad)] px-4 py-3 text-primary-foreground shadow-[0_14px_36px_-18px_var(--glow)]">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage({ parts }: { parts?: PartsComponents }) {
  return (
    <MessagePrimitive.Root className="message-in group relative w-full">
      <div className="panel rounded-2xl px-4 py-3.5">
        <MessagePrimitive.Parts components={parts} />
        <MessagePrimitive.Error>
          <div className="mt-2 rounded-xl border border-destructive/35 bg-destructive/10 p-3 text-sm text-destructive">
            Something went wrong while generating a response.
          </div>
        </MessagePrimitive.Error>
      </div>
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className="mt-2 flex gap-1 text-muted-foreground"
      >
        <ActionBarPrimitive.Copy asChild>
          <ActionButton label="Copy">
            <MessagePrimitive.If copied>
              <Check size={15} />
            </MessagePrimitive.If>
            <MessagePrimitive.If copied={false}>
              <Copy size={15} />
            </MessagePrimitive.If>
          </ActionButton>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild>
          <ActionButton label="Regenerate">
            <RefreshCw size={15} />
          </ActionButton>
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function ActionButton({
  label,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg transition hover:bg-accent hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
