import type {
  Message as AgentMessage,
  ToolCall as AgentToolCall,
  ToolDef as AgentToolDef,
} from "../agent/types";
import type {
  ApiError,
  Chat,
  GenerateRequest,
  Message,
  SessionResponse,
  StreamEvent,
} from "./generated";

type RuntimeConfig = {
  baseUrl: string;
  bearerToken: string | null;
  csrfToken: string | null;
};

const runtime: RuntimeConfig = {
  baseUrl: "",
  bearerToken: null,
  // Persist in localStorage so the token survives the browser being closed and
  // reopened while the session cookie is still valid.
  csrfToken: localStorage.getItem("feltnerai.csrf"),
};

export function configureApi(config: Partial<RuntimeConfig>) {
  Object.assign(runtime, config);
  if (config.csrfToken === null) localStorage.removeItem("feltnerai.csrf");
  else if (config.csrfToken)
    localStorage.setItem("feltnerai.csrf", config.csrfToken);
}

export function apiBaseUrl() {
  return runtime.baseUrl;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "request_failed",
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("content-type")
  )
    headers.set("content-type", "application/json");
  if (runtime.bearerToken)
    headers.set("authorization", `Bearer ${runtime.bearerToken}`);
  if (runtime.csrfToken && !["GET", "HEAD"].includes(init.method ?? "GET")) {
    headers.set("x-csrf-token", runtime.csrfToken);
  }
  const response = await fetch(`${runtime.baseUrl}/api/v1${path}`, {
    ...init,
    headers,
    credentials: runtime.baseUrl ? "omit" : "include",
  });
  if (!response.ok) {
    let error: ApiError | undefined;
    try {
      error = (await response.json()) as ApiError;
    } catch {
      // The server may have returned a proxy or transport error page.
    }
    throw new ApiRequestError(
      error?.message ?? `Request failed (${response.status})`,
      response.status,
      error?.code,
    );
  }
  return response;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiBlob(
  path: string,
  init: RequestInit = {},
): Promise<Blob> {
  return (await request(path, init)).blob();
}

export async function login(
  loginName: string,
  password: string,
  portal: boolean,
): Promise<SessionResponse> {
  const session = await api<SessionResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ login: loginName, password, portal }),
  });
  configureApi({
    bearerToken: session.bearer_token,
    csrfToken: session.csrf_token,
  });
  return session;
}

export async function streamGeneration(
  chatId: string,
  request: GenerateRequest,
  regenerate: boolean,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const headers = new Headers({ "content-type": "application/json" });
  if (runtime.bearerToken)
    headers.set("authorization", `Bearer ${runtime.bearerToken}`);
  if (runtime.csrfToken) headers.set("x-csrf-token", runtime.csrfToken);
  const response = await fetch(
    `${runtime.baseUrl}/api/v1/chats/${chatId}/${regenerate ? "regenerate" : "generate"}`,
    {
      method: "POST",
      headers,
      credentials: runtime.baseUrl ? "omit" : "include",
      body: JSON.stringify(request),
    },
  );
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => null);
    throw new ApiRequestError(
      error?.message ?? "Generation failed.",
      response.status,
      error?.code,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as StreamEvent);
    }
  }
}

/**
 * Stream a single agent turn through `POST /api/v1/agent/completions`, forward
 * text deltas to `onText`, and return the assembled assistant message
 * (content + any tool calls). Tool-call deltas are accumulated by `index`, the
 * same way the upstream OpenAI stream emits them.
 */
export async function streamAgentCompletion(
  modelId: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  temperature: number,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<AgentMessage> {
  const headers = new Headers({ "content-type": "application/json" });
  if (runtime.bearerToken)
    headers.set("authorization", `Bearer ${runtime.bearerToken}`);
  if (runtime.csrfToken) headers.set("x-csrf-token", runtime.csrfToken);
  const body: Record<string, unknown> = {
    model_id: modelId,
    messages,
    temperature,
  };
  if (tools.length) body.tools = tools;

  const response = await fetch(`${runtime.baseUrl}/api/v1/agent/completions`, {
    method: "POST",
    headers,
    credentials: runtime.baseUrl ? "omit" : "include",
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => null);
    throw new ApiRequestError(
      error?.message ?? `Model request failed (${response.status}).`,
      response.status,
      error?.code,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const calls: { id: string; name: string; args: string }[] = [];

  let done = false;
  while (!done) {
    const read = await reader.read();
    if (read.done) break;
    buffer += decoder.decode(read.value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        done = true;
        break;
      }
      if (!data) continue;
      let chunk: AgentChatChunk;
      try {
        chunk = JSON.parse(data) as AgentChatChunk;
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        onText(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const index = tc.index ?? 0;
        while (calls.length <= index)
          calls.push({ id: "", name: "", args: "" });
        const slot = calls[index]!;
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
    }
  }

  const toolCalls: AgentToolCall[] = calls
    .filter((call) => call.name)
    .map((call) => ({
      id:
        call.id ||
        `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "function",
      function: { name: call.name, arguments: call.args.trim() || "{}" },
    }));

  return {
    role: "assistant",
    content: content || undefined,
    tool_calls: toolCalls.length ? toolCalls : undefined,
  };
}

interface AgentChatChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
}

export const chatApi = {
  list: () => api<Chat[]>("/chats"),
  create: (modelId?: string | null) =>
    api<Chat>("/chats", {
      method: "POST",
      body: JSON.stringify({ model_id: modelId ?? null }),
    }),
  update: (id: string, input: { title?: string; model_id?: string | null }) =>
    api<Chat>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  delete: (id: string) => api<void>(`/chats/${id}`, { method: "DELETE" }),
  messages: (id: string) => api<Message[]>(`/chats/${id}/messages`),
  stop: (id: string) => api<void>(`/chats/${id}/stop`, { method: "POST" }),
};
