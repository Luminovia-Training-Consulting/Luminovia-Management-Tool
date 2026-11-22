import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { DeliveryPage } from "./delivery";
import type { DeliverySession } from "./delivery-schema";

const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "ed000000-0000-4000-8000-000000000002" } },
  }),
}));

const session = "ed000000-0000-4000-8000-000000000021";
const start = "2026-01-04T22:01:12+00:00";
const end = "2026-01-05T00:00:00+00:00";
const submission = {
  id: "ed000000-0000-4000-8000-000000000024",
  revision: 1,
  outcome: "completed" as const,
  actual_start: start,
  actual_end: end,
  time_zone: "Australia/Brisbane",
  created_at: end,
  notes: "Original fictional report",
  correction_reason: "",
};
const initial: DeliverySession = {
  session_id: session,
  claim_id: "ed000000-0000-4000-8000-000000000022",
  job_id: "ed000000-0000-4000-8000-000000000023",
  course_run_id: null,
  title: "Fictional delivery session",
  lecturer_name: "Fictional lecturer",
  scheduled_start: start,
  scheduled_end: end,
  time_zone: submission.time_zone,
  status: "submitted",
  version: 2,
  actual_minutes: 119,
  scheduled_minutes: 119,
  draft: null,
  submission,
  invoice_id: null,
  can_edit: false,
  can_review: true,
  can_customer_confirm: false,
  customer_confirmed: false,
};
let item: DeliverySession, client: QueryClient;

function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/delivery?session=${session}`]}>
        <DeliveryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  await i18n.changeLanguage("en");
  item = { ...initial };
  state.online = true;
  state.rpc.mockReset();
  state.rpc.mockImplementation((name: string) => {
    if (name === "delivery_session") return response(item);
    if (name === "delivery_history")
      return response({
        submissions: [
          { ...submission, scheduled_start: start, scheduled_end: end },
        ],
        events: [],
      });
    return response(null, { code: "42501" });
  });
});
afterEach(() => {
  cleanup();
  client?.clear();
});

it("opens the exact notification session and requires a reason before reopening the reviewed version", async () => {
  const user = userEvent.setup();
  state.rpc
    .mockImplementationOnce(() => response(item))
    .mockImplementationOnce(() => response({ submissions: [], events: [] }));
  mount();
  expect(
    await screen.findByRole("heading", { name: item.title }),
  ).toBeVisible();
  const reopen = screen.getByRole("button", { name: "Request a correction" });
  expect(reopen).toBeDisabled();
  await user.type(
    screen.getByRole("textbox", { name: "Review reason" }),
    "Verify the actual time",
  );
  expect(reopen).toBeEnabled();
  await user.click(reopen);
  expect(state.rpc).toHaveBeenCalledWith("review_delivery", {
    p_session_id: session,
    p_expected_version: 2,
    p_request_id: expect.any(String),
    p_action: "request_correction",
    p_note: "Verify the actual time",
  });
  expect(
    await screen.findByText(
      "The change was not saved. Check the current evidence and try again.",
    ),
  ).toBeVisible();
});

it("lets a lecturer correct a reopened submission in German and preserves unchanged exact instants", async () => {
  await i18n.changeLanguage("de");
  const user = userEvent.setup();
  item = {
    ...item,
    can_review: false,
    can_edit: true,
    status: "correction_requested",
    version: 3,
  };
  const respond = state.rpc.getMockImplementation()!;
  state.rpc.mockImplementation((name: string, args: unknown) => {
    if (name === "save_delivery_draft") {
      item = {
        ...item,
        status: "draft",
        version: 4,
        draft: {
          outcome: submission.outcome,
          actual_start: submission.actual_start,
          actual_end: submission.actual_end,
          time_zone: submission.time_zone,
          notes: submission.notes,
          correction_reason: "Zeiten verglichen",
        },
      };
      return response(item);
    }
    return respond(name, args);
  });
  mount();
  expect(
    await screen.findByRole("heading", { name: "Leistungsnachweise" }),
  ).toBeVisible();
  expect(
    await screen.findByRole("textbox", { name: "Begründung der Korrektur" }),
  ).toBeRequired();
  expect(
    screen.queryByRole("button", { name: "Korrektur anfragen" }),
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "Begründung der Korrektur" }),
    "Zeiten verglichen",
  );
  await user.click(screen.getByRole("button", { name: "Entwurf speichern" }));
  expect(state.rpc).toHaveBeenCalledWith(
    "save_delivery_draft",
    expect.objectContaining({
      p_session_id: session,
      p_expected_version: 3,
      p_payload: expect.objectContaining({
        actual_start: start,
        actual_end: end,
        time_zone: "Australia/Brisbane",
        correction_reason: "Zeiten verglichen",
      }),
    }),
  );
  expect(
    await screen.findByRole("button", {
      name: "Gespeicherten Nachweis einreichen",
    }),
  ).toBeEnabled();
  await user.type(
    screen.getByRole("textbox", { name: "Notizen zum Unterricht" }),
    " Änderung",
  );
  expect(
    screen.getByRole("button", { name: "Gespeicherten Nachweis einreichen" }),
  ).toBeDisabled();
  expect(screen.getByText("Original fictional report")).toBeVisible();
});

it("hides retained evidence if the server denies the exact session", async () => {
  state.rpc.mockImplementation(() => response(null, { code: "42501" }));
  mount();
  await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
  expect(screen.queryByText(initial.title)).not.toBeInTheDocument();
  expect(screen.queryByText(submission.notes)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Request a correction" }),
  ).not.toBeInTheDocument();
});
