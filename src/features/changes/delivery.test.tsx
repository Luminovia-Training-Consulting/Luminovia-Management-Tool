import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { csvText } from "../../lib/csv";
import i18n from "../../lib/i18n";
import { DeliveryPage } from "./delivery";
import type { DeliverySession } from "./delivery-schema";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  download: vi.fn(),
  roles: ["lecturer"],
  online: true,
}));
vi.mock("../../lib/csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/csv")>()),
  downloadCsv: state.download,
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: state.rpc,
    from: () => ({
      select: () => ({
        eq: () => response(state.roles.map((role) => ({ role }))),
      }),
    }),
  }),
}));
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
function mount(path = `/delivery?session=${session}`) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <DeliveryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  await i18n.changeLanguage("en");
  item = { ...initial };
  state.roles = ["lecturer"];
  state.online = true;
  state.download.mockReset();
  state.rpc.mockReset();
  state.rpc.mockImplementation((name: string) => {
    if (name === "get_my_permissions") return response([]);
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

it("downloads a fresh authorized page with exact times, stable codes and escaped cells", async () => {
  const user = userEvent.setup();
  state.roles.push("client");
  const respond = state.rpc.getMockImplementation()!;
  const secondPageId = "ed000000-0000-4000-8000-000000000031";
  const firstPage = { ...item, status: "confirmed" };
  const secondPage = {
    ...firstPage,
    session_id: secondPageId,
    title: "Fictional older session",
  };
  const refreshed = {
    ...secondPage,
    title: '=Fictional "course", revised',
    lecturer_name: "+Fictional name",
    submission: {
      ...submission,
      revision: 2,
      correction_reason: "Confidential correction",
    },
    invoice_id: "ed000000-0000-4000-8000-000000000034",
  };
  let refresh = false;
  state.rpc.mockImplementation(
    (name: string, args: { p_before_id?: string }) => {
      if (name !== "delivery_sessions") return respond(name);
      if (args.p_before_id === session)
        return response({
          items: [refresh ? refreshed : secondPage],
          has_more: false,
        });
      return response({ items: [firstPage], has_more: true });
    },
  );
  mount("/delivery");
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "View" }),
    "customer",
  );
  await user.click(
    await screen.findByRole("button", { name: "More sessions" }),
  );
  expect(
    await screen.findByRole("link", { name: secondPage.title }),
  ).toBeVisible();
  refresh = true;
  await user.click(
    screen.getByRole("button", { name: "Download this page as CSV" }),
  );
  await waitFor(() => expect(state.download).toHaveBeenCalledOnce());
  expect(state.rpc).toHaveBeenLastCalledWith("delivery_sessions", {
    p_scope: "customer",
    p_before_at: start,
    p_before_id: session,
    p_limit: 25,
  });
  const [[filename, rows]] = state.download.mock.calls;
  expect(filename).toBe("luminovia-delivery-evidence-customer.csv");
  expect(rows).toHaveLength(2);
  const csv = csvText(rows);
  expect(csv).toContain(
    `"'=Fictional ""course"", revised","'+Fictional name","${start}","${end}","Australia/Brisbane"`,
  );
  expect(csv).toContain('"119","completed","confirmed","2"');
  expect(csv).not.toContain("Fictional older session");
  expect(csv).not.toContain(firstPage.title);
  expect(csv).not.toContain("Confidential correction");
  expect(csv).not.toContain(submission.notes);
  expect(csv).not.toContain(refreshed.invoice_id);
});

it("discards the cached list if the current export read is denied", async () => {
  const user = userEvent.setup();
  const respond = state.rpc.getMockImplementation()!;
  let revoked = false;
  state.rpc.mockImplementation((name: string) => {
    if (name !== "delivery_sessions") return respond(name);
    return revoked
      ? response(null, { code: "42501" })
      : response({ items: [item], has_more: false });
  });
  mount("/delivery");
  const download = await screen.findByRole("button", {
    name: "Download this page as CSV",
  });
  revoked = true;
  await user.click(download);
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: item.title }),
  ).not.toBeInTheDocument();
  expect(state.download).not.toHaveBeenCalled();
});

it("does not download a delayed response after switching views", async () => {
  const user = userEvent.setup();
  state.roles.push("client");
  const respond = state.rpc.getMockImplementation()!;
  let delay = false;
  let resolve!: (result: { data: unknown; error: null }) => void;
  let signal: AbortSignal | undefined;
  const pending = new Promise<{ data: unknown; error: null }>((done) => {
    resolve = done;
  });
  const page = { items: [item], has_more: false };
  state.rpc.mockImplementation((name: string, args: { p_scope?: string }) => {
    if (name !== "delivery_sessions") return respond(name);
    if (args.p_scope === "customer")
      return response({ items: [], has_more: false });
    if (!delay) return response(page);
    return {
      abortSignal(value: AbortSignal) {
        signal = value;
        return pending;
      },
    };
  });
  mount("/delivery");
  const download = await screen.findByRole("button", {
    name: "Download this page as CSV",
  });
  delay = true;
  await user.click(download);
  expect(
    await screen.findByRole("button", { name: "Refreshing the current page" }),
  ).toBeDisabled();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "View" }),
    "customer",
  );
  expect(await screen.findByText("This view has no sessions.")).toBeVisible();
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve({ data: page, error: null }));
  expect(state.download).not.toHaveBeenCalled();
});

it("labels the export in German and disables it while offline", async () => {
  await i18n.changeLanguage("de");
  const respond = state.rpc.getMockImplementation()!;
  state.rpc.mockImplementation((name: string) =>
    name === "delivery_sessions"
      ? response({ items: [item], has_more: false })
      : respond(name),
  );
  state.online = false;
  mount("/delivery");
  expect(
    await screen.findByRole("button", {
      name: "Diese Seite als CSV herunterladen",
    }),
  ).toBeDisabled();
  expect(state.download).not.toHaveBeenCalled();
});
