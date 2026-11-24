/**
 * Regressions for authorized audit views, explicit filter/cursor changes and denied access.
 * Controlled responses test UI contracts; actual audit authorization is checked separately.
 */
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { AdminAuditPage } from "./audit";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  actor: "audit-admin",
  permissions: ["audit.read"],
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
    queryFn: async () => state.permissions,
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

/** Model an awaitable SDK response with its chain method; this fixture makes no backend request. */
function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}

/** Mount the real feature screen with an isolated cache and controlled SDK responses. */
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
  state.permissions = ["audit.read"];
  state.online = true;
  state.rpc.mockReset();
  state.rpc.mockReturnValue(response(data));
  await i18n.changeLanguage("de");
});
afterEach(async () => {
  cleanup();
  await Promise.all(clients.map((client) => client.cancelQueries()));
  for (const client of clients) client.clear();
  clients.length = 0;
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
  vi.restoreAllMocks();
});
describe("connected administration audit reader", () => {
  it("localises newly reviewed announcement and calendar filters without losing the selected action", async () => {
    state.rpc.mockReturnValue(
      response({
        ...data,
        actions: ["announcement.published", "calendar.global_publish"],
      }),
    );
    mount();
    expect(
      await screen.findByRole("option", {
        name: "Ankündigungen · announcement.published",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "Globale Termine · calendar.global_publish",
      }),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("Aktion"),
      "calendar.global_publish",
    );
    await user.click(screen.getByRole("button", { name: "Filter anwenden" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
    await act(() => i18n.changeLanguage("en"));
    expect(screen.getByLabelText("Action")).toHaveValue(
      "calendar.global_publish",
    );
    expect(
      screen.getByRole("option", {
        name: "Global events · calendar.global_publish",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "Announcements · announcement.published",
      }),
    ).toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledTimes(2);
  });
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
    state.permissions = [];
    mount();
    expect(
      await screen.findByText(/Das Protokoll erfordert/),
    ).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("allows management to read localized activity while hiding log deletion", async () => {
    state.permissions = ["audit.activity.read"];
    const action = "activity.organisation_contacts.deleted";
    state.rpc.mockReturnValue(
      response({
        ...data,
        can_clear: false,
        actions: [action],
        items: [{ ...event, action }],
      }),
    );
    mount();
    expect(
      await screen.findByRole("heading", {
        name: "Unternehmenskontakt gelöscht",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Protokoll leeren" }),
    ).not.toBeInTheDocument();
    await act(() => i18n.changeLanguage("en"));
    expect(
      screen.getByRole("heading", { name: "Company contact deleted" }),
    ).toBeInTheDocument();
  });
  it("requires explicit admin confirmation and refreshes the full log after clearing", async () => {
    const cursor = { at: event.created_at, id: event.id };
    let cleared = false;
    let finish!: () => void;
    const pending = new Promise((resolve) => {
      finish = () => {
        cleared = true;
        resolve({ data: { removed: 9 }, error: null });
      };
    });
    state.rpc.mockImplementation((name, args) => {
      if (name === "clear_administration_activity") return pending;
      return response({
        ...data,
        can_clear: true,
        items: cleared
          ? []
          : args.p_before_id
            ? [{ ...event, id: "older", actor_name: "Older actor" }]
            : [event],
        has_more: !cleared && !args.p_before_id,
        next_cursor: !cleared && !args.p_before_id ? cursor : null,
      });
    });
    mount();
    const user = userEvent.setup();
    await screen.findByText(event.actor_name);
    await user.selectOptions(
      screen.getByLabelText("Aktion"),
      "taxonomy.created",
    );
    await user.click(screen.getByRole("button", { name: "Filter anwenden" }));
    await screen.findByText(event.actor_name);
    await user.click(screen.getByRole("button", { name: "Ältere Seite" }));
    await screen.findByText("Older actor");
    const clearLog = screen.getByRole("button", { name: "Protokoll leeren" });
    await user.click(clearLog);
    let dialog = screen.getByRole("dialog", {
      name: "Gesamtes Protokoll leeren?",
    });
    expect(dialog).toHaveAccessibleDescription(
      /unabhängig von den gewählten Filtern/,
    );
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(state.rpc).not.toHaveBeenCalledWith(
      "clear_administration_activity",
      { p_confirm: true },
    );

    await user.click(clearLog);
    dialog = screen.getByRole("dialog", { name: "Gesamtes Protokoll leeren?" });
    await user.click(
      within(dialog).getByRole("button", { name: "Alle Einträge löschen" }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", {
          name: "Einträge werden gelöscht …",
        }),
      ).toBeDisabled(),
    );
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    expect(
      state.rpc.mock.calls.filter(
        ([rpc]) => rpc === "clear_administration_activity",
      ),
    ).toHaveLength(1);

    await act(() => finish());
    expect(
      await screen.findByText("9 Protokolleinträge gelöscht."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      await screen.findByText(/Keine passenden Verwaltungsereignisse/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Older actor")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neuere Seite" })).toBeDisabled();
    expect(screen.getByLabelText("Aktion")).toHaveValue("");
    expect(state.rpc).toHaveBeenLastCalledWith(
      "admin_audit_events",
      expect.objectContaining({
        p_action: "",
        p_before_at: null,
        p_before_id: null,
      }),
    );
  });
  it("reports a failed clear inside the confirmation and preserves the displayed history", async () => {
    state.rpc.mockImplementation((name) =>
      name === "clear_administration_activity"
        ? response(null, { code: "42501", message: "Permission changed" })
        : response({ ...data, can_clear: true }),
    );
    mount();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Protokoll leeren" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Alle Einträge löschen" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Das Leeren des Protokolls konnte nicht bestätigt werden.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(screen.getByText(event.actor_name)).toBeInTheDocument();
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
