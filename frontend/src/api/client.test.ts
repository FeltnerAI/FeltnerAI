import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiBlob, configureApi, streamGeneration } from "./client";

describe("API client", () => {
  beforeEach(() =>
    configureApi({ baseUrl: "", bearerToken: null, csrfToken: null }),
  );

  it("parses normalized SSE events across chunks", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: started\ndata: {"event":"started","message_id":"m1"}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode('event: delta\ndata: {"event":"delta","content":"hel'),
        );
        controller.enqueue(
          encoder.encode(
            'lo"}\n\nevent: completed\ndata: {"event":"completed","message_id":"m1"}\n\n',
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );
    const events: string[] = [];
    await streamGeneration(
      "chat",
      { request_id: "request", content: "hi", model_id: null },
      false,
      (event) => events.push(event.event),
    );
    expect(events).toEqual(["started", "delta", "completed"]);
  });

  it("sends bearer credentials for Portal sessions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        'event: completed\ndata: {"event":"completed","message_id":"m1"}\n\n',
        {
          status: 200,
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    configureApi({ baseUrl: "https://server.example", bearerToken: "secret" });
    await streamGeneration(
      "chat",
      { request_id: "request", content: "hi", model_id: null },
      false,
      () => undefined,
    );
    expect(
      new Headers(fetchMock.mock.calls[0][1].headers).get("authorization"),
    ).toBe("Bearer secret");
  });

  it("downloads authenticated backup blobs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("backup", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    configureApi({ baseUrl: "https://server.example", bearerToken: "secret" });

    expect((await apiBlob("/admin/data/export")).size).toBe(6);
    expect(
      new Headers(fetchMock.mock.calls[0][1].headers).get("authorization"),
    ).toBe("Bearer secret");
  });

  it("lets the browser set multipart boundaries for imports", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"restart_required":true,"message":"Restarting"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = new FormData();
    body.append("backup", new Blob(["zip"]), "backup.zip");

    await api("/admin/data/import", { method: "POST", body });

    expect(
      new Headers(fetchMock.mock.calls[0][1].headers).has("content-type"),
    ).toBe(false);
  });
});
