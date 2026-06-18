// The agent loop: drives the model through the FeltnerAI server, executes
// tools in the Tauri host, and talks to a `Frontend`. Ported from the
// FeltnerAI-Code engine, adapted so tool execution happens via Tauri commands
// and model streaming goes through the shared API client.

import { streamAgentCompletion } from "../api/client";
import { projectDoc, systemPrompt } from "./prompt";
import { definitions, fsTools, isMutating } from "./tools";
import type { Frontend, Message, Mode, PlanStep, ToolCall } from "./types";

const MAX_STEPS = 60;

export class Agent {
  private messages: Message[] = [];
  private plan: PlanStep[] = [];
  private doc: { name: string; content: string } | null = null;
  private abortController: AbortController | null = null;
  private stopped = false;

  private constructor(
    private modelId: string,
    private temperature: number,
    private frontend: Frontend,
    private cwd: string,
    private mode: Mode,
  ) {}

  static async create(
    modelId: string,
    temperature: number,
    frontend: Frontend,
    cwd: string,
    mode: Mode,
  ): Promise<Agent> {
    const agent = new Agent(modelId, temperature, frontend, cwd, mode);
    agent.doc = await projectDoc(cwd);
    agent.messages.push({ role: "system", content: agent.systemMessage() });
    return agent;
  }

  private systemMessage(): string {
    let text = systemPrompt(this.cwd, this.mode);
    if (this.doc) {
      text += `\n\n# Project guidance (from ${this.doc.name})\nThe workspace provides these instructions; follow them.\n\n${this.doc.content}`;
    }
    return text;
  }

  projectDocName(): string | null {
    return this.doc?.name ?? null;
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.messages[0] = { role: "system", content: this.systemMessage() };
  }

  setModel(modelId: string): void {
    this.modelId = modelId;
  }

  abort(): void {
    this.stopped = true;
    this.abortController?.abort();
  }

  async runTurn(input: string): Promise<void> {
    this.stopped = false;
    this.messages.push({ role: "user", content: input });

    for (let step = 0; step < MAX_STEPS; step++) {
      if (this.stopped) {
        await this.finishStopped();
        return;
      }

      let assistant: Message;
      try {
        assistant = await this.streamAssistant();
      } catch (error) {
        if (isAbortError(error)) {
          await this.finishStopped();
          return;
        }
        await this.frontend.event({ kind: "error", text: errorText(error) });
        return;
      }
      this.messages.push(assistant);

      const calls = assistant.tool_calls;
      if (!calls || calls.length === 0) {
        await this.frontend.event({ kind: "turn_complete" });
        return;
      }

      for (const call of calls) {
        const output = await this.runTool(call);
        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: output,
        });
        if (this.stopped) {
          await this.finishStopped();
          return;
        }
      }
    }

    await this.frontend.event({
      kind: "notice",
      text: "Reached the step limit for this turn.",
    });
    await this.frontend.event({ kind: "turn_complete" });
  }

  private async streamAssistant(): Promise<Message> {
    let full = "";
    const controller = new AbortController();
    this.abortController = controller;
    try {
      const message = await streamAgentCompletion(
        this.modelId,
        this.messages,
        definitions(),
        this.temperature,
        (text) => {
          if (controller.signal.aborted) return;
          full += text;
          void this.frontend.event({ kind: "assistant_delta", text });
        },
        controller.signal,
      );
      if (full)
        await this.frontend.event({ kind: "assistant_done", text: full });
      return message;
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  private async runTool(call: ToolCall): Promise<string> {
    const name = call.function.name;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}") as Record<
        string,
        unknown
      >;
    } catch {
      // leave args empty
    }

    if (this.mode === "plan" && isMutating(name)) {
      const output = `Refused: ${name} is not allowed in plan mode. Present a plan and ask the user to proceed.`;
      await this.frontend.event({
        kind: "tool_finished",
        id: call.id,
        name,
        ok: false,
        output,
      });
      return output;
    }

    await this.frontend.event({
      kind: "tool_started",
      id: call.id,
      name,
      summary: summarize(name, args),
    });

    if (this.mode === "approve" && isMutating(name)) {
      const approved = await this.frontend.approve({
        tool: name,
        title: summarize(name, args),
        detail: approvalDetail(name, args),
      });
      if (!approved) {
        const output = this.stopped
          ? "Stopped by the user."
          : "Denied by the user.";
        await this.frontend.event({
          kind: "tool_finished",
          id: call.id,
          name,
          ok: false,
          output,
        });
        return output;
      }
    }

    try {
      const output = await this.dispatch(name, args);
      await this.frontend.event({
        kind: "tool_finished",
        id: call.id,
        name,
        ok: true,
        output,
      });
      return output;
    } catch (error) {
      const output = `Error: ${errorText(error)}`;
      await this.frontend.event({
        kind: "tool_finished",
        id: call.id,
        name,
        ok: false,
        output,
      });
      return output;
    }
  }

  private async dispatch(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const str = (key: string): string | undefined =>
      typeof args[key] === "string" ? (args[key] as string) : undefined;
    const num = (key: string): number | undefined =>
      typeof args[key] === "number" ? (args[key] as number) : undefined;

    switch (name) {
      case "read_file":
        return fsTools.read_file(
          this.cwd,
          required(str("path"), "path"),
          num("offset"),
          num("limit"),
        );
      case "write_file":
        return fsTools.write_file(
          this.cwd,
          required(str("path"), "path"),
          str("content") ?? "",
        );
      case "edit_file":
        return fsTools.edit_file(
          this.cwd,
          required(str("old"), "old"),
          str("new") ?? "",
          required(str("path"), "path"),
        );
      case "list_files":
        return fsTools.list_files(this.cwd, str("path"));
      case "search":
        return fsTools.search(
          this.cwd,
          required(str("pattern"), "pattern"),
          str("path"),
        );
      case "run_command":
        return fsTools.run_command(
          this.cwd,
          required(str("command"), "command"),
        );
      case "update_plan": {
        this.plan = Array.isArray(args.steps) ? (args.steps as PlanStep[]) : [];
        await this.frontend.event({ kind: "plan_updated", steps: this.plan });
        return "Plan updated.";
      }
      case "ask_user": {
        const options = Array.isArray(args.options)
          ? (args.options as unknown[]).map(String)
          : [];
        const answer = await this.frontend.ask({
          prompt: required(str("question"), "question"),
          options,
        });
        return `The user answered: ${answer}`;
      }
      default:
        return `Unknown tool: ${name}`;
    }
  }

  private async finishStopped(): Promise<void> {
    await this.frontend.event({ kind: "notice", text: "Turn stopped." });
    await this.frontend.event({ kind: "turn_complete" });
  }
}

function required(value: string | undefined, name: string): string {
  if (value == null) throw new Error(`missing ${name}`);
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function summarize(name: string, args: Record<string, unknown>): string {
  const value = (key: string): string =>
    typeof args[key] === "string" ? (args[key] as string) : "";
  switch (name) {
    case "read_file":
      return `Read ${value("path")}`;
    case "write_file":
      return `Write ${value("path")}`;
    case "edit_file":
      return `Edit ${value("path")}`;
    case "list_files":
      return value("path") ? `List ${value("path")}` : "List files";
    case "search":
      return `Search /${value("pattern")}/`;
    case "run_command":
      return `Run \`${value("command")}\``;
    case "update_plan":
      return "Update plan";
    case "ask_user":
      return "Ask a question";
    default:
      return name;
  }
}

function approvalDetail(name: string, args: Record<string, unknown>): string {
  const value = (key: string): string =>
    typeof args[key] === "string" ? (args[key] as string) : "";
  switch (name) {
    case "run_command":
      return value("command");
    case "write_file":
      return `Overwrite ${value("path")}`;
    case "edit_file":
      return `Edit ${value("path")}`;
    default:
      return "";
  }
}
