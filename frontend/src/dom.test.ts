import { describe, expect, it, vi } from "vitest";
import { scrollMessageIntoView } from "./dom";

describe("scrollMessageIntoView", () => {
  it("does not leak a browser-specific return value into a React effect", () => {
    const scrollIntoView = vi.fn(() => Promise.resolve());

    const result = scrollMessageIntoView({ scrollIntoView });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    expect(result).toBeUndefined();
  });
});
