// Core types for the coding agent. Ported from the FeltnerAI-Code engine and
// kept dependency-free so they can be imported anywhere (including the API
// client) without creating import cycles.

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Message {
  role: Role;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export type Mode = "plan" | "approve" | "auto";

export type PlanStatus = "pending" | "in_progress" | "done";

export interface PlanStep {
  step: string;
  status: PlanStatus;
}

export type AgentEvent =
  | { kind: "assistant_delta"; text: string }
  | { kind: "assistant_done"; text: string }
  | { kind: "tool_started"; id: string; name: string; summary: string }
  | { kind: "tool_finished"; id: string; name: string; ok: boolean; output: string }
  | { kind: "plan_updated"; steps: PlanStep[] }
  | { kind: "notice"; text: string }
  | { kind: "error"; text: string }
  | { kind: "turn_complete" };

export interface ApprovalRequest {
  tool: string;
  title: string;
  detail: string;
}

export interface Question {
  prompt: string;
  options: string[];
}

/** Implemented by the UI to render events and gather decisions. */
export interface Frontend {
  event(event: AgentEvent): void | Promise<void>;
  approve(request: ApprovalRequest): Promise<boolean>;
  ask(question: Question): Promise<string>;
}
