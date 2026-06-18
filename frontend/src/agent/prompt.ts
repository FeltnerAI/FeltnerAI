// System prompt construction and project-doc loading. The prompt text is the
// FeltnerAI-Code prompt verbatim; the project doc is read through the Tauri
// host (the webview cannot read the disk directly).

import { portal } from "../portal";
import type { Mode } from "./types";

const PROJECT_DOCS = ["AGENTS.md", "FELTNER.md", "CLAUDE.md"];

export async function projectDoc(
  root: string,
): Promise<{ name: string; content: string } | null> {
  for (const name of PROJECT_DOCS) {
    try {
      const content = (await portal.agentReadFile(root, name)).trim();
      if (content) return { name, content: content.slice(0, 8000) };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function systemPrompt(cwd: string, mode: Mode): string {
  const platform =
    typeof navigator !== "undefined" && /win/i.test(navigator.platform)
      ? "win32"
      : typeof navigator !== "undefined" && /mac/i.test(navigator.platform)
        ? "darwin"
        : "linux";

  const modeLine =
    mode === "plan"
      ? "You are in PLAN MODE: the workspace is read-only. Do NOT call write_file, edit_file, or run_command. Investigate with read_file, list_files, and search, then present a plan with update_plan and use ask_user to confirm before any work would begin."
      : mode === "approve"
        ? "You are in APPROVE MODE: every file write and command runs only after the user approves it. Keep each change focused and explain it briefly first."
        : "You are in AUTO MODE: file writes and commands run without prompting. Be careful and verify your work as you go.";

  return `You are FeltnerAI Code, an expert software engineering agent that works directly in the user's repository.

Working directory: ${cwd}
Operating system: ${platform}

${modeLine}

How you work:
- Be concise and direct. Prefer doing over describing.
- For any non-trivial task, call update_plan first with a short ordered list of steps, then keep statuses current (pending → in_progress → done).
- Explore before editing: read relevant files and search the codebase so changes match existing style.
- Make small, verifiable changes. When you finish a unit of work, run the project's checks with run_command when appropriate.
- Use ask_user when requirements are ambiguous or a consequential decision is needed. Do not guess on consequential choices.
- Never invent file contents — read files before editing them. Use edit_file for targeted changes and write_file for new files.
- When done, give a short summary of what changed and how it was verified.

Tools: read_file, write_file, edit_file, list_files, search, run_command, update_plan, ask_user.`;
}
