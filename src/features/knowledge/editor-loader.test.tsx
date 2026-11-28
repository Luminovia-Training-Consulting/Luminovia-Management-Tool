import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { emptyDocument } from "./content";
import { KnowledgeEditor } from "./editor-loader";

const state = vi.hoisted(() => ({ online: false, load: vi.fn() }));
vi.mock("../../lib/online", () => ({ useOnline: () => state.online }));
vi.mock("./knowledge-editor", () => {
  state.load();
  return { KnowledgeEditor: () => <input aria-label="Draft" /> };
});

it("does not download the unavailable writer offline and retains a mounted draft on disconnect", async () => {
  function editor() {
    return <KnowledgeEditor label="Draft" value={emptyDocument} />;
  }
  const { rerender } = render(editor());
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(state.load).not.toHaveBeenCalled();

  state.online = true;
  rerender(editor());
  const input = await screen.findByRole("textbox", { name: "Draft" });
  await userEvent.type(input, "Retained draft");
  expect(state.load).toHaveBeenCalledOnce();

  state.online = false;
  rerender(editor());
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
  expect(input).toHaveValue("Retained draft");
});
