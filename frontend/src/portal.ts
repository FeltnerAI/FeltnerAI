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
