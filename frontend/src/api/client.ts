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
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type"))
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
