// Tool definitions and dispatch. The JSON schemas are the FeltnerAI-Code set
// verbatim; the difference here is execution: filesystem and shell tools run in
// the Tauri host (sandboxed to the project root) via `portal`, while
// `update_plan` and `ask_user` resolve in-process against the `Frontend`.

import { portal } from "../portal";
import type { ToolDef } from "./types";

/** The set of tools exposed to the model. */
export function definitions(): ToolDef[] {
  return [
    tool(
      "read_file",
      "Read a UTF-8 text file. Optionally start at a 1-based line offset and limit lines.",
      {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path, relative to the working directory.",
          },
          offset: { type: "integer", description: "1-based line to start at." },
          limit: { type: "integer", description: "Maximum lines to return." },
        },
        required: ["path"],
      },
    ),
    tool(
      "write_file",
      "Create or overwrite a text file. Parent directories are created automatically.",
      {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    ),
    tool(
      "edit_file",
      "Replace an exact string in a file with a new string. The old string must occur exactly once.",
      {
        type: "object",
        properties: {
          path: { type: "string" },
          old: {
            type: "string",
            description: "Exact text to replace (must be unique in the file).",
          },
          new: { type: "string", description: "Replacement text." },
        },
        required: ["path", "old", "new"],
      },
    ),
    tool(
      "list_files",
      "List files under a directory (skips node_modules, .git, build output). Defaults to the working directory.",
      {
        type: "object",
        properties: { path: { type: "string" } },
      },
    ),
    tool(
      "search",
      "Search file contents with a regular expression. Returns matching lines as path:line: text.",
      {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: {
            type: "string",
            description: "Directory to search; defaults to the working directory.",
          },
        },
        required: ["pattern"],
      },
    ),
    tool(
      "run_command",
      "Run a shell command in the working directory and return its combined output. Requires approval unless auto-approved.",
      {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    ),
    tool(
      "update_plan",
      "Record or update the step-by-step plan. Use before starting non-trivial work.",
      {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                step: { type: "string" },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "done"],
                },
              },
              required: ["step", "status"],
            },
          },
        },
        required: ["steps"],
      },
    ),
    tool(
      "ask_user",
      "Ask the user a question and wait for their answer. Use when requirements are ambiguous.",
      {
        type: "object",
        properties: {
          question: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Optional suggested answers.",
          },
        },
        required: ["question"],
      },
    ),
  ];
}

function tool(name: string, description: string, parameters: unknown): ToolDef {
  return { type: "function", function: { name, description, parameters } };
}

export function isMutating(name: string): boolean {
  return name === "write_file" || name === "edit_file" || name === "run_command";
}

// Filesystem / shell tools execute in the Tauri host against the project root.
export const fsTools = {
  read_file: (root: string, path: string, offset?: number, limit?: number) =>
    portal.agentReadFile(root, path, offset, limit),
  write_file: (root: string, path: string, content: string) =>
    portal.agentWriteFile(root, path, content),
  edit_file: (root: string, oldStr: string, newStr: string, path: string) =>
    portal.agentEditFile(root, path, oldStr, newStr),
  list_files: (root: string, path?: string) => portal.agentListFiles(root, path),
  search: (root: string, pattern: string, path?: string) =>
    portal.agentSearch(root, pattern, path),
  run_command: (root: string, command: string) =>
    portal.agentRunCommand(root, command),
};
