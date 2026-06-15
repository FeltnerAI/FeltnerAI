import { describe, expect, it, vi } from "vitest";
import { validateServer } from "./portal";

const handshake = {
  server_uuid: "018f0000-0000-7000-8000-000000000001",
  api_major: 1,
  version: "1.0.0",
  setup_complete: true,
  public_url: null,
  capabilities: {
    chat_streaming: true,
    portal_sessions: true,
    custom_branding: true,
  },
  branding: {
    server_name: "Test",
    accent_color: "#6d5dfc",
    logo_url: null,
    favicon_url: null,
    custom_css_url: null,
  },
};

describe("Portal server validation", () => {
  it("normalizes server URLs and accepts API v1", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(handshake)));
    const result = await validateServer("https://example.com/");
    expect(result.url).toBe("https://example.com");
  });

  it("rejects incompatible API versions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ...handshake, api_major: 2 })),
    );
    await expect(validateServer("https://example.com")).rejects.toThrow(
      "supports API v1",
    );
  });

  it("rejects servers that still need setup", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ...handshake, setup_complete: false }),
        ),
    );
    await expect(validateServer("https://example.com")).rejects.toThrow(
      "first-run setup",
    );
  });
});
