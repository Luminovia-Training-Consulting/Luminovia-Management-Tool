/** Mocked component/adapter regressions for support. Real authentication, PostgreSQL, scanner and browser acceptance are exercised by the separate isolated integration suites. */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { SupportDeskPage } from "./support";
import { newTicketSchema, supportError } from "./api";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  online: true,
  actor: "11111111-1111-4111-8111-111111111111",
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw Error("offline");
  },
}));
vi.mock("../files/api", () => ({
  acceptedFiles: ".pdf,.txt",
  saveDownload: vi.fn(),
  uploadDocument: vi.fn(),
}));
const id = "22222222-2222-4222-8222-222222222222";
const context = {
  can_manage: false,
  staff: [],
  report: [],
  courses: [],
  claims: [],
  organisations: [],
};
const ticket = {
  id,
  title: "Fictional <script>literal</script>",
  description: "Expected a fictional page",
  category: "technical",
  status: "open",
  priority: "normal",
  version: 1,
  requester_name: "Fictional Lecturer",
  assigned_name: null,
  assigned_to: null,
  created_at: "2026-11-16T01:00:00Z",
  updated_at: "2026-11-16T01:00:00Z",
  mine: true,
  can_manage: false,
  can_reopen: false,
  course_run_id: null,
  claim_id: null,
  organisation_id: null,
  resolved_at: null,
  closed_at: null,
  messages: [],
  events: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      actor_name: "Fictional Lecturer",
      action: "created",
      reason: "",
      previous_status: null,
      new_status: null,
      created_at: "2026-11-16T01:00:00Z",
    },
  ],
  attachments: [],
};
let activeTicket = ticket;
let activeContext = context;
const clients: QueryClient[] = [];

function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}

function mount(path = `/support/${id}`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const element = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="support" element={<SupportDeskPage />} />
          <Route path="support/:id" element={<SupportDeskPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(element()), client, element };
}

beforeEach(async () => {
  state.online = true;
  activeTicket = structuredClone(ticket);
  activeContext = structuredClone(context);
  state.rpc.mockReset();
  state.rpc.mockImplementation((name) =>
    response(
      name === "support_context"
        ? activeContext
        : name === "support_ticket"
          ? activeTicket
          : name === "support_tickets"
            ? { items: [], has_more: false, next_cursor: null }
            : id,
    ),
  );
  await i18n.changeLanguage("de");
});
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.restoreAllMocks();
});

describe("connected private support desk", () => {
  it("renders authored text literally and withholds staff-only actions from ordinary requesters", async () => {
    const { container } = mount();
    expect(
      await screen.findByRole("heading", { name: ticket.title }),
    ).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Interne Notiz speichern" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Status ändern" }),
    ).not.toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledWith("support_ticket", {
      p_ticket_id: id,
    });
  });
  it("keeps the reviewed version while another session updates the ticket and waits for server confirmation", async () => {
    const { client } = mount();
    await screen.findByRole("heading", { name: ticket.title });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Antwort senden" }));
    await user.type(screen.getByLabelText("Nachricht"), "A fictional reply");
    activeTicket = { ...activeTicket, version: 2 };
    await act(() =>
      client.invalidateQueries({
        queryKey: ["support-ticket", state.actor, id],
      }),
    );
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    state.rpc.mockImplementation((name) =>
      name === "update_support_ticket"
        ? pending
        : response(name === "support_context" ? activeContext : activeTicket),
    );
    await user.click(
      screen.getByRole("button", { name: "Antwort senden", hidden: false }),
    );
    expect(state.rpc).toHaveBeenCalledWith(
      "update_support_ticket",
      expect.objectContaining({
        p_expected_version: 1,
        p_action: "reply",
        p_payload: { body: "A fictional reply" },
      }),
    );
    expect(screen.getByLabelText("Nachricht")).toHaveValue("A fictional reply");
    await act(() =>
      finish({ data: null, error: { code: "40001", message: "stale" } }),
    );
    expect(
      await screen.findByText(/Dieses Ticket wurde geändert/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nachricht")).toHaveValue("A fictional reply");
  });
  it("never renders retained ticket contents after a current server denial", async () => {
    mount();
    await screen.findByRole("heading", { name: ticket.title });
    state.rpc.mockImplementation((name) =>
      name === "support_ticket"
        ? response(null, { code: "42501" })
        : response(activeContext),
    );
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "Bestätigten Stand neu laden" }),
      );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: ticket.title }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/keinen Zugriff/);
  });
  it("redacts previously loaded staff data immediately when context loses its capability", async () => {
    activeContext = { ...context, can_manage: true };
    activeTicket = {
      ...ticket,
      can_manage: true,
      messages: [
        {
          id,
          author_name: "Fictional Support",
          body: "Restricted staff text",
          internal: true,
          created_at: ticket.created_at,
        },
      ],
    } as typeof ticket;
    const { client } = mount();
    expect(
      await screen.findByText("Restricted staff text"),
    ).toBeInTheDocument();
    activeContext = context;
    await act(() =>
      client.invalidateQueries({ queryKey: ["support-context", state.actor] }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Restricted staff text"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/keinen Zugriff/);
  });
  it("retains ticket draft through language changes and does not navigate on an unconfirmed create", async () => {
    mount("/support");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Supportticket erstellen" }),
    );
    await user.type(screen.getByLabelText("Betreff"), "Fictional subject");
    await user.type(
      screen.getByLabelText("Problem und erwartetes Ergebnis"),
      "Fictional reproduction",
    );
    await act(() => i18n.changeLanguage("en"));
    expect(screen.getByLabelText("Subject")).toHaveValue("Fictional subject");
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    state.rpc.mockImplementation((name) =>
      name === "create_support_ticket" ? pending : response(activeContext),
    );
    await user.click(screen.getByRole("button", { name: "Submit ticket" }));
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
    expect(screen.getByLabelText("Subject")).toHaveValue("Fictional subject");
    await act(() => finish({ data: null, error: { code: "42501" } }));
    expect(
      await screen.findByText(/current account does not have access/),
    ).toBeInTheDocument();
  });
  it("disables business mutations and file transfers while offline", async () => {
    const view = mount();
    await screen.findByRole("heading", { name: ticket.title });
    state.online = false;
    view.rerender(view.element());
    expect(
      screen.getByRole("button", { name: "Antwort senden" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Geprüften Anhang hochladen" }),
    ).toBeDisabled();
    expect(
      state.rpc.mock.calls.some(([name]) => name === "update_support_ticket"),
    ).toBe(false);
  });
  it("validates payload types and reports conflicts without treating denials as successes", () => {
    const base = {
      title: "  fictional  ",
      description: "  expected  ",
      category: "general",
      course_run_id: "",
      claim_id: "",
      organisation_id: "",
    };
    expect(newTicketSchema.parse(base).title).toBe("fictional");
    expect(newTicketSchema.safeParse({ ...base, title: " " }).success).toBe(
      false,
    );
    expect(
      newTicketSchema.safeParse({ ...base, course_run_id: "forged" }).success,
    ).toBe(false);
    expect(supportError({ code: "40001" })).toBe("conflict");
    expect(supportError({ code: "42501" })).toBe("denied");
    expect(supportError({ code: "54000" })).toBe("rateLimit");
  });
});
