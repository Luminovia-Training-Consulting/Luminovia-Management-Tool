/** Component authority, consent/version and privacy regressions; actual SQL/HTTP are separate. */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { EnquiriesPage } from "./enquiries";
import { enquirySessions } from "./api";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  online: true,
  allowed: true,
  actor: "11111111-1111-4111-8111-111111111111",
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../../lib/queries", () => ({
  permissionsQuery: (actor: string) => ({
    queryKey: ["permissions", actor],
    queryFn: async () =>
      state.allowed ? ["organisations.manage", "courses.manage"] : [],
  }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw Error("offline");
  },
}));
const id = "22222222-2222-4222-8222-222222222222";
const context = {
  organisations: [],
  templates: [],
  staff: [],
  can_convert: true,
};
const enquiry = {
  id,
  status: "received",
  responsible_id: null,
  organisation_id: null,
  course_run_id: null,
  version: 1,
  received_at: "2026-11-16T01:00:00Z",
  updated_at: "2026-11-16T01:00:00Z",
  payload: {
    company_name: "Fictional <script>safe text</script>",
    contact_name: "Fictional Contact",
    email: "fictional@example.invalid",
    phone: "",
    topic: "Fictional training",
    message: "Fictional authored requirements.",
    preferred_dates: "Next fictional month",
    duration: "Two days",
    delivery_type: "online",
    time_zone: "Europe/Berlin",
    locale: "en",
    privacy_notice_version: "fictional-privacy-v1",
    consent: true,
  },
  history: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      action: "received",
      reason: "",
      actor_name: null,
      created_at: "2026-11-16T01:00:00Z",
    },
  ],
};
let active = enquiry;
const clients: QueryClient[] = [];
function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}
function mount(path = `/enquiries/${id}`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const element = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="enquiries" element={<EnquiriesPage />} />
          <Route path="enquiries/:id" element={<EnquiriesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(element()), client, element };
}
beforeEach(async () => {
  state.allowed = true;
  state.online = true;
  active = structuredClone(enquiry);
  state.rpc.mockReset();
  state.rpc.mockImplementation((name) =>
    response(
      name === "enquiry_context"
        ? context
        : name === "enquiry_detail"
          ? active
          : name === "enquiry_inbox"
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
describe("private connected website enquiry management", () => {
  it("does not call private enquiry APIs without current customer-management permission", async () => {
    state.allowed = false;
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Auftraggeberverwaltung/,
    );
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("renders authored original values literally and opens a manual safe email draft only", async () => {
    const { container } = mount();
    expect(
      await screen.findByText(enquiry.payload.company_name, { selector: "dd" }),
    ).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    const link = screen.getByRole("link", { name: "E-Mail-Entwurf öffnen" });
    expect(link).toHaveAttribute(
      "href",
      "mailto:fictional%40example.invalid?subject=Fictional%20training",
    );
    expect(
      screen.getByText(/Portal versendet keine E-Mail/),
    ).toBeInTheDocument();
  });
  it("requires an explicit customer creation confirmation and never reports an unconfirmed mutation as success", async () => {
    mount();
    await screen.findByRole("heading", { name: enquiry.payload.topic });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Auftraggeber und Kontakt anlegen" }),
    );
    expect(
      state.rpc.mock.calls.some(([name]) => name === "manage_enquiry"),
    ).toBe(false);
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    state.rpc.mockImplementation((name) =>
      name === "manage_enquiry" ? pending : response(context),
    );
    await user.click(screen.getByRole("button", { name: "Bestätigen" }));
    expect(screen.getByRole("button", { name: "Bestätigen" })).toBeDisabled();
    expect(
      screen.queryByText("Der Server hat diese Aktion bestätigt."),
    ).not.toBeInTheDocument();
    await act(() => finish({ data: null, error: { code: "42501" } }));
    expect(await screen.findByText(/Anfragen erfordern/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("keeps the original reviewed version through a background refresh and preserves a rejected draft", async () => {
    const { client } = mount();
    await screen.findByRole("heading", { name: enquiry.payload.topic });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Verwaltungsnotiz ergänzen" }),
    );
    await user.type(
      screen.getByLabelText("Verwaltungsnotiz"),
      "Fictional clarification",
    );
    active = { ...active, version: 2 };
    await act(() =>
      client.invalidateQueries({
        queryKey: ["enquiry-detail", state.actor, id],
      }),
    );
    state.rpc.mockImplementation((name) =>
      name === "manage_enquiry"
        ? response(null, { code: "40001" })
        : response(active),
    );
    await user.click(screen.getByRole("button", { name: "Bestätigen" }));
    await screen.findByText(/zwischenzeitlich geändert/);
    expect(state.rpc).toHaveBeenCalledWith(
      "manage_enquiry",
      expect.objectContaining({
        p_expected_version: 1,
        p_action: "note",
        p_payload: { note: "Fictional clarification" },
      }),
    );
    expect(screen.getByLabelText("Verwaltungsnotiz")).toHaveValue(
      "Fictional clarification",
    );
  });
  it("retains search input across DE/EN changes and applies filters only on submission", async () => {
    mount("/enquiries");
    await screen.findByText(/Keine eingegangenen Anfragen/);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Unternehmen, Thema oder Kontakt-E-Mail suchen"),
      "Fictional search",
    );
    await act(() => i18n.changeLanguage("en"));
    expect(
      screen.getByLabelText("Search company, topic or contact email"),
    ).toHaveValue("Fictional search");
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "enquiry_inbox"),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith(
        "enquiry_inbox",
        expect.objectContaining({
          p_search: "Fictional search",
          p_before_id: null,
        }),
      ),
    );
  });
  it("removes private contact data after denial and disables offline mutation controls", async () => {
    const view = mount();
    await screen.findByText(enquiry.payload.email);
    state.online = false;
    view.rerender(view.element());
    expect(
      screen.getByRole("button", { name: "Auftraggeber und Kontakt anlegen" }),
    ).toBeDisabled();
    state.online = true;
    view.rerender(view.element());
    state.rpc.mockImplementation((name) =>
      name === "enquiry_detail"
        ? response(null, { code: "42501" })
        : response(context),
    );
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "Bestätigten Stand neu laden" }),
      );
    await waitFor(() =>
      expect(screen.queryByText(enquiry.payload.email)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Auftraggeberverwaltung/,
    );
  });
  it("normalises planning instants in the intended zone and rejects DST gaps, ambiguity and overlapping sessions", () => {
    expect(
      enquirySessions(
        [{ starts_at: "2027-07-01T09:00", ends_at: "2027-07-01T10:00" }],
        "Europe/Berlin",
      ),
    ).toEqual([
      {
        starts_at: "2027-07-01T07:00:00.000Z",
        ends_at: "2027-07-01T08:00:00.000Z",
      },
    ]);
    expect(
      enquirySessions(
        [{ starts_at: "2027-03-28T02:30", ends_at: "2027-03-28T04:00" }],
        "Europe/Berlin",
      ),
    ).toBeNull();
    expect(
      enquirySessions(
        [{ starts_at: "2027-10-31T02:30", ends_at: "2027-10-31T04:00" }],
        "Europe/Berlin",
      ),
    ).toBeNull();
    expect(
      enquirySessions(
        [
          { starts_at: "2027-07-01T09:00", ends_at: "2027-07-01T11:00" },
          { starts_at: "2027-07-01T10:00", ends_at: "2027-07-01T12:00" },
        ],
        "Europe/Berlin",
      ),
    ).toBeNull();
  });
});
