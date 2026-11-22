import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  CalendarInvitationEditor,
  CalendarInvitationOverview,
} from "./invitations";
import type { GlobalEvent } from "./publications-schema";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: mock.rpc }) }));

const event: GlobalEvent = {
  id: "4d9f8ba3-58e2-402f-8ef6-dae10e49fa89",
  version: 4,
  title: "Fictional course opening",
  description: "",
  link_url: "",
  starts_at: "2060-02-08T08:00:00Z",
  ends_at: "2060-02-08T09:00:00Z",
  time_zone: "Europe/Berlin",
  archived_at: null,
  published: true,
  updated_at: "2060-02-01T08:00:00Z",
};
const code = "LV-0123-4567-89AB-CDEF-1234";
const query = (data: unknown) => ({
  abortSignal: async () => ({ data, error: null }),
});

function setup(subject: React.ReactNode) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/calendar#calendar-invitations"]}>
        {subject}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  mock.rpc.mockReset();
  await i18n.changeLanguage("de");
});

it("confirms a response only after submitting the exact displayed invitation revision", async () => {
  const invitation = {
    event_id: event.id,
    event_version: event.version,
    title: event.title,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    time_zone: event.time_zone,
    revision: 2,
    response: "pending",
  };
  mock.rpc.mockImplementation((name: string) => {
    if (name === "calendar_invitations")
      return query({ items: [invitation], next_cursor: null });
    invitation.response = "tentative";
    invitation.revision = 3;
    return Promise.resolve({ data: true, error: null });
  });

  setup(<CalendarInvitationOverview actor="recipient" />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Vorläufig zusagen" }),
  );
  expect(await screen.findByText("Antwort gespeichert.")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Vorläufig zusagen" }),
  ).toBeDisabled();
  expect(mock.rpc).toHaveBeenCalledWith("reply_calendar_invitation", {
    p_event_id: event.id,
    p_event_version: 4,
    p_expected_revision: 2,
    p_response: "tentative",
  });
});

it("uses the public account code to invite and the server revision to withdraw", async () => {
  let revision = 0;
  mock.rpc.mockImplementation((name: string) => {
    if (name === "calendar_invitations")
      return query(
        revision === 0
          ? []
          : [
              {
                user_code: code,
                name: "Fictional lecturer",
                revision,
                response: "pending",
                withdrawn: revision === 2,
              },
            ],
      );
    revision += 1;
    return Promise.resolve({ data: true, error: null });
  });

  await i18n.changeLanguage("en");
  setup(
    <CalendarInvitationEditor
      actor="manager"
      event={event}
      onClose={() => {}}
    />,
  );
  const user = userEvent.setup();
  const editor = screen.getByRole("dialog");
  const field = await within(editor).findByLabelText(
    "Recipient’s Luminovia ID",
  );
  await user.type(field, code.toLowerCase());
  await user.click(within(editor).getByRole("button", { name: "Invite" }));
  expect(await within(editor).findByText("Fictional lecturer")).toBeVisible();
  await user.click(
    within(editor).getByRole("button", { name: "Withdraw invitation" }),
  );
  expect(await within(editor).findByText("Withdrawn")).toBeVisible();
  expect(mock.rpc).toHaveBeenNthCalledWith(2, "set_calendar_invitation", {
    p_event_id: event.id,
    p_event_version: 4,
    p_user_code: code,
    p_expected_revision: 0,
    p_invited: true,
  });
  expect(mock.rpc).toHaveBeenCalledWith("set_calendar_invitation", {
    p_event_id: event.id,
    p_event_version: 4,
    p_user_code: code,
    p_expected_revision: 1,
    p_invited: false,
  });
});
