import { invoke } from "@tauri-apps/api/core";
import type { ServerHandshake } from "./api/generated";

export const isPortal = Boolean(window.__TAURI_INTERNALS__);

export interface ServerProfile {
  id: string;
  serverUuid: string;
  name: string;
  url: string;
  allowInsecureHttp: boolean;
  lastUsedAt: string;
}

export interface CodeProject {
  id: string;
  name: string;
  path: string;
  lastUsedAt: string;
}

export const portal = {
  listProfiles: () => invoke<ServerProfile[]>("list_profiles"),
  saveProfile: (profile: ServerProfile) =>
    invoke<ServerProfile[]>("save_profile", { profile }),
  deleteProfile: (id: string, serverUuid: string) =>
    invoke<ServerProfile[]>("delete_profile", { id, serverUuid }),
  storeCredential: (serverUuid: string, token: string) =>
    invoke<boolean>("store_credential", { serverUuid, token }),
  loadCredential: (serverUuid: string) =>
    invoke<string | null>("load_credential", { serverUuid }),
  deleteCredential: (serverUuid: string) =>
    invoke<void>("delete_credential", { serverUuid }),

  // Coding-agent projects (working directories) and the native folder picker.
  listProjects: () => invoke<CodeProject[]>("list_projects"),
  saveProject: (project: CodeProject) =>
    invoke<CodeProject[]>("save_project", { project }),
  deleteProject: (id: string) => invoke<CodeProject[]>("delete_project", { id }),
  pickDirectory: () => invoke<string | null>("pick_directory"),

  // Sandboxed filesystem / shell tools, scoped to a project `root`.
  agentReadFile: (root: string, path: string, offset?: number, limit?: number) =>
    invoke<string>("agent_read_file", { root, path, offset, limit }),
  agentWriteFile: (root: string, path: string, content: string) =>
    invoke<string>("agent_write_file", { root, path, content }),
  agentEditFile: (root: string, path: string, oldStr: string, newStr: string) =>
    invoke<string>("agent_edit_file", { root, path, old: oldStr, new: newStr }),
  agentListFiles: (root: string, path?: string) =>
    invoke<string>("agent_list_files", { root, path }),
  agentSearch: (root: string, pattern: string, path?: string) =>
    invoke<string>("agent_search", { root, pattern, path }),
  agentRunCommand: (root: string, command: string) =>
    invoke<string>("agent_run_command", { root, command }),
};

export async function validateServer(
  rawUrl: string,
): Promise<{ url: string; handshake: ServerHandshake }> {
  const url = rawUrl.trim().replace(/\/+$/, "");
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Server URL must use HTTP or HTTPS.");
  const response = await fetch(`${url}/api/v1/server`);
  if (!response.ok)
    throw new Error(`The server handshake failed (${response.status}).`);
  const handshake = (await response.json()) as ServerHandshake;
  if (handshake.api_major !== 1) {
    throw new Error(
      `This Portal supports API v1, but the server requires API v${handshake.api_major}.`,
    );
  }
  if (!handshake.setup_complete)
    throw new Error(
      "Complete first-run setup in a browser before adding this server.",
    );
  return { url, handshake };
}
