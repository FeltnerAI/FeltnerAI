import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ChevronDown, ChevronRight, Terminal } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/common";

// Renders an agent tool call (read_file, run_command, …) as a collapsible card.
// The engine packs a human summary into `args.summary` and the combined output
// into the tool result, so this single fallback covers every tool.
export const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
}) => {
  const [open, setOpen] = useState(false);
  const summary =
    (args as { summary?: string } | undefined)?.summary ?? toolName;
  const output = typeof result === "string" ? result : "";
  const isError = output.startsWith("Error:") || output.startsWith("Refused:");
  const running = result === undefined;
  const expanded = open || isError;
  const tone = running ? "neutral" : isError ? "danger" : "success";

  return (
    <div className="card my-2 overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Terminal size={15} className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{summary}</span>
        <Badge tone={tone}>{running ? "running…" : isError ? "error" : "ok"}</Badge>
      </button>
      {expanded && output && (
        <pre className="max-h-72 overflow-auto border-t border-border bg-black/20 px-3 py-2 text-xs whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  );
};
