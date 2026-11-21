import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditedCourseChat } from "./audited-course-chat";
import "./i18n";

const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => undefined,
}));
afterEach(() => {
  cleanup();
  fake.rpc.mockReset();
});

it("requires an explicit reason and follows the audited cursor using the accepted reason", async () => {
  fake.rpc
    .mockResolvedValueOnce({
      data: {
        items: [
          {
            id: "first",
            sender_name: "Fictional Teacher",
            body: "Fictional lesson",
            room_title: "Fictional room",
            created_at: "2026-11-20T01:00:00Z",
          },
        ],
        next_cursor: { id: "first", at: "2026-11-20T01:00:00Z" },
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { items: [], next_cursor: null },
      error: null,
    });
  render(
    <AuditedCourseChat
      organisation="fictional-company"
      course="fictional-run"
      zone="Europe/Berlin"
    />,
  );
  const user = userEvent.setup();
  const button = screen.getByRole("button", {
    name: /Kurschat prüfen|Inspect course chat/,
  });
  expect(button).toBeDisabled();
  expect(fake.rpc).not.toHaveBeenCalled();
  const input = screen.getByRole("textbox");
  await user.type(input, "Check a reported concern");
  await user.click(button);
  expect(await screen.findByText("Fictional lesson")).toBeVisible();
  await user.clear(input);
  await user.click(
    screen.getByRole("button", {
      name: /Ältere Nachrichten|Show older messages/,
    }),
  );
  expect(fake.rpc.mock.calls[1]).toEqual([
    "inspect_company_course_chat",
    {
      p_organisation_id: "fictional-company",
      p_run_id: "fictional-run",
      p_reason: "Check a reported concern",
      p_before_at: "2026-11-20T01:00:00Z",
      p_before_id: "first",
    },
  ]);
});
