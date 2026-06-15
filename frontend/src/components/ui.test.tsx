import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, Input, Modal } from "./ui";

describe("shared UI", () => {
  it("associates labels with inputs", () => {
    render(<Input label="Username" />);
    expect(screen.getByLabelText("Username")).toBeVisible();
  });

  it("supports keyboard-accessible modal dismissal", async () => {
    const change = vi.fn();
    render(
      <Modal open onOpenChange={change} title="Edit user">
        <Button>Save</Button>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Edit user" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(change).toHaveBeenCalledWith(false);
  });
});
