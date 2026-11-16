/**
 * Vitest-Regressionen für berechtigte Auditansicht, explizite Filter-/Cursorwechsel und fehlgeschlagene Zugriffe. Lokale SDK-/DOM-Fixtures isolieren den Browservertrag; echte Datenbank-/API-Abnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { AdminAuditPage } from "./audit";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  actor: "audit-admin",
  allowed: true,
  online: true,
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../../lib/queries", () => ({
  profileQuery: (actor: string) => ({
    queryKey: ["profile", actor],
    queryFn: async () => ({ time_zone: "Europe/Berlin" }),
  }),
  permissionsQuery: (actor: string) => ({
    queryKey: ["permissions", actor],
    queryFn: async () => (state.allowed ? ["audit.read"] : []),
  }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw Error("offline");
  },
}));
const event = {
  id: "audit-one",
  actor_name: "Fictional actor <script>literal</script>",
  action: "job.lifecycle.published",
  resource_id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-11-15T10:00:00Z",
};
const data = {
  items: [event],
  has_more: false,
  next_cursor: null,
  from: "2026-11-01T00:00:00Z",
  to: "2026-11-16T00:00:00Z",
  actions: ["job.lifecycle.published", "taxonomy.created"],
};
const clients: QueryClient[] = [];
/** Bildet einen awaitbaren SDK-Response samt Kettenmethode nach, ohne einen echten Backendzugriff auszuführen. */
function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}
/** Mountet den echten Fachscreen mit isoliertem Cache und kontrollierten SDK-Antworten. */
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <AdminAuditPage />
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  state.actor = "audit-admin";
  state.allowed = true;
  state.online = true;
  state.rpc.mockReset();
  state.rpc.mockReturnValue(response(data));
  await i18n.changeLanguage("de");
});
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.restoreAllMocks();
});
describe("connected administration audit reader", () => {
  it("loads safe metadata as literal text and exposes no editing controls", async () => {
    const { container } = mount();
    expect(await screen.findByText(event.actor_name)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(event.resource_id)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
    expect(state.rpc.mock.calls).toHaveLength(1);
    expect(state.rpc).toHaveBeenCalledWith(
      "admin_audit_events",
      expect.objectContaining({
        p_limit: 40,
        p_before_at: null,
        p_before_id: null,
      }),
    );
  });
  it("never calls the audit API without the current capability", async () => {
    state.allowed = false;
    mount();
    expect(
      await screen.findByText(/Das Protokoll erfordert/),
    ).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("retains filter drafts through language changes and only submits on request", async () => {
    mount();
    await screen.findByText(event.actor_name);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Im Protokoll suchen"),
      "Fictional search",
    );
    await act(() => i18n.changeLanguage("en"));
    expect(screen.getByLabelText("Search audit trail")).toHaveValue(
      "Fictional search",
    );
    expect(state.rpc).toHaveBeenCalledTimes(1);
    await user.selectOptions(
      screen.getByLabelText("Action"),
      "taxonomy.created",
    );
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith(
        "admin_audit_events",
        expect.objectContaining({
          p_search: "Fictional search",
          p_action: "taxonomy.created",
          p_before_at: null,
        }),
      ),
    );
  });
  it("uses the actual returned tuple cursor and disables an exhausted page", async () => {
    const cursor = { at: event.created_at, id: event.id };
    state.rpc.mockImplementation((_name, args) =>
      response(
        args.p_before_id
          ? {
              ...data,
              items: [{ ...event, id: "older", actor_name: "Older actor" }],
            }
          : { ...data, has_more: true, next_cursor: cursor },
      ),
    );
    mount();
    await screen.findByText(event.actor_name);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ältere Seite" }));
    expect(await screen.findByText("Older actor")).toBeInTheDocument();
    expect(state.rpc).toHaveBeenLastCalledWith(
      "admin_audit_events",
      expect.objectContaining({
        p_before_at: cursor.at,
        p_before_id: cursor.id,
        p_from: data.from,
        p_to: data.to,
      }),
    );
    expect(screen.getByRole("button", { name: "Ältere Seite" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Neuere Seite" }));
    expect(await screen.findByText(event.actor_name)).toBeInTheDocument();
  });
  it("waits for a real filter response and redacts stale rows after server access denial", async () => {
    mount();
    await screen.findByText(event.actor_name);
    const user = userEvent.setup();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    state.rpc.mockReturnValue(
      Object.assign(pending, {
        abortSignal() {
          return this;
        },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Aktualisieren" }));
    expect(
      screen.getByRole("button", { name: "Aktualisieren" }),
    ).toBeDisabled();
    await act(() =>
      finish({
        data: null,
        error: { code: "42501", message: "Account access revoked" },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText(event.actor_name)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
  it("rejects oversized date windows locally and disables offline requests", async () => {
    const view = mount();
    await screen.findByText(event.actor_name);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Von"));
    await user.type(screen.getByLabelText("Von"), "2020-01-01");
    await user.click(screen.getByRole("button", { name: "Filter anwenden" }));
    expect(
      await screen.findByText(/höchstens 93 Kalendertagen/),
    ).toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledTimes(1);
    state.online = false;
    view.rerender(
      <QueryClientProvider client={clients[0]}>
        <AdminAuditPage />
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Filter anwenden" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Aktualisieren" }),
    ).toBeDisabled();
  });
});
