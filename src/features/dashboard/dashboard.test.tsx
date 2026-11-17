/**
 * Regressions for bounded personal previews, denied access, actor changes and shared query
 * observers. Controlled UI data do not replace native permission checks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { Dashboard } from "./dashboard";
import { DashboardWidgets } from "./widgets";
import { notificationPreviewQuery } from "../notifications/api";

const fake = vi.hoisted(() => ({
  actor: "dashboard-a",
  roles: ["lecturer"],
  tables: {} as Record<string, unknown>,
  rpcData: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
  calls: [] as { method: string; table: string; args: unknown[] }[],
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: fake.actor } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
vi.mock("../commercial/revenue", () => ({ FinancialSummaryCards: () => null }));
// Exercise the real lightweight card and its restricted-price contract without
// importing unrelated marketplace detail mutations into dashboard tests.
vi.mock("../jobs/jobs", async () => ({
  JobCard: (await import("../jobs/card")).JobCard,
}));

const clients: QueryClient[] = [];
/** Create an instant relative to test time so preview filtering is not tied to a fixed date. */
function ahead(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString();
}
/** Create a fictional offer with explicit variants for dashboard filtering/previews. */
function job(id: string, extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    description: "Fictional source",
    customer_name: "Fictional customer",
    delivery_type: "online",
    location: "",
    time_zone: "Europe/Berlin",
    amount: 100,
    total_amount: 100,
    currency: "EUR",
    rate_unit: "fixed_total",
    terms: "Fictional terms",
    terms_version: 1,
    requires_contract: false,
    capacity: 1,
    capacity_basis: "single_position",
    created_at: ahead(-1),
    confirmed_count: 0,
    open_positions: 1,
    title: `Fictional ${id}`,
    status: "published",
    claim_deadline: null,
    job_sessions: [],
    job_requirements: [],
    ...extra,
  };
}
beforeEach(async () => {
  await i18n.changeLanguage("de");
  fake.actor = "dashboard-a";
  fake.roles = ["lecturer"];
  fake.calls = [];
  fake.errors = {};
  fake.tables = {
    profiles: {
      id: fake.actor,
      display_name: "Fictional Ada",
      time_zone: "Australia/Brisbane",
    },
    jobs: [],
    job_claims: [],
    lecturer_topics: [],
    personal_events: [
      {
        id: "own-event",
        user_id: fake.actor,
        title: "My private preparation",
        starts_at: ahead(2),
        ends_at: ahead(2.1),
        time_zone: "Europe/Berlin",
      },
    ],
    documents: [
      {
        id: "file-a",
        original_name: "Fictional handout.txt",
        kind: "material",
        created_at: ahead(-1),
      },
    ],
  };
  fake.rpcData = {
    job_dashboard: {
      open_count: 0,
      assignment_count: 0,
      next_session_count: 0,
      matching: false,
      suggestions: [],
      next_assignments: [],
      management: null,
      as_of: ahead(0),
    },
    get_my_permissions: [],
    notification_inbox: {
      items: [
        {
          id: "6f1be4c1-9910-4f22-a3e0-d92b60bc8ee4",
          kind: "chat_message",
          title: "Fictional course update",
          href: "/chats?room=room-a",
          created_at: ahead(-1),
          read_at: null,
        },
      ],
      unread_count: 2,
      as_of: ahead(0),
    },
    chat_rooms_list: [
      { id: "room-a", title: "Fictional room", unread_count: 3 },
    ],
    contract_records: [
      {
        id: "pending",
        title: "Personal receipt pending",
        status: "active",
        effective_from: ahead(-4),
        expires_at: ahead(4),
        document_version_id: "version-a",
        sha256: "a".repeat(64),
        acknowledged_at: null,
      },
      {
        id: "read",
        title: "Already acknowledged",
        status: "active",
        effective_from: ahead(-4),
        expires_at: null,
        document_version_id: "version-b",
        sha256: "b".repeat(64),
        acknowledged_at: ahead(-1),
      },
      {
        id: "expired",
        title: "Expired contract",
        status: "expired",
        effective_from: ahead(-4),
        expires_at: ahead(-1),
        document_version_id: "version-c",
        sha256: "c".repeat(64),
        acknowledged_at: null,
      },
    ],
  };
  fake.rpc.mockReset().mockImplementation((name: string, args?: unknown) => {
    fake.calls.push({ method: "rpc", table: name, args: [args] });
    const builder = {
      abortSignal: () => builder,
      then: (resolve: (result: unknown) => unknown) =>
        Promise.resolve({
          data: name === "job_offers" ? fake.tables.jobs : fake.rpcData[name],
          error:
            fake.errors[name] ??
            (name === "job_offers" ? fake.errors.jobs : null),
        }).then(resolve),
    };
    return builder;
  });
  fake.from.mockReset().mockImplementation((table: string) => {
    fake.calls.push({ method: "from", table, args: [] });
    const builder: Record<string, unknown> = {};
    for (const method of [
      "select",
      "eq",
      "is",
      "gt",
      "lt",
      "order",
      "limit",
      "abortSignal",
      "maybeSingle",
    ])
      builder[method] = (...args: unknown[]) => {
        fake.calls.push({ method, table, args });
        return builder;
      };
    builder.then = (resolve: (result: unknown) => unknown) =>
      Promise.resolve({
        data:
          table === "user_roles"
            ? fake.roles.map((role) => ({ role }))
            : fake.tables[table],
        error: fake.errors[table] ?? null,
      }).then(resolve);
    return builder;
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
});
/** Observe the shell's actual inbox key to detect extra dashboard requests. */
function SharedShellObserver() {
  useQuery(notificationPreviewQuery(fake.actor));
  return null;
}
/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(onlyWidgets = false, sharedObserver = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 15000 } },
  });
  clients.push(client);
  const view = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {sharedObserver && <SharedShellObserver />}
        {onlyWidgets ? (
          <DashboardWidgets
            actor={fake.actor}
            zone="Europe/Berlin"
            staff={fake.roles.includes("lecturer")}
            clientAccount={fake.roles.includes("client")}
            jobCounts={
              (
                fake.rpcData.job_dashboard as {
                  management: {
                    drafts: number;
                    expired: number;
                    upcoming: number;
                  } | null;
                }
              ).management ?? undefined
            }
          />
        ) : (
          <Dashboard />
        )}
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(view());
  return { ...result, client, update: () => result.rerender(view()) };
}
const rpcCalls = (name: string) =>
  fake.calls.filter((call) => call.method === "rpc" && call.table === name);

describe("role-aware dashboard previews", () => {
  it("provides a named page-level heading", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Fictional",
    );
  });
  it("accepts a restricted suggestion without inventing a zero-price compensation", async () => {
    (fake.rpcData.job_dashboard as { suggestions: unknown[] }).suggestions = [
      job("restricted quote", { amount: null, total_amount: null }),
    ];
    setup();
    expect(await screen.findByText("Fictional restricted quote")).toBeVisible();
    expect(screen.getByText("Honorar geschützt")).toBeVisible();
    expect(screen.queryByText(/0,00/)).not.toBeInTheDocument();
    expect(rpcCalls("job_dashboard")).toHaveLength(1);
  });
  it("combines own calendar, messages, personal contract receipts and bounded clean metadata", async () => {
    fake.tables.personal_events = [
      ...(fake.tables.personal_events as unknown[]),
      {
        id: "other",
        user_id: "other-actor",
        title: "Foreign private appointment",
        starts_at: ahead(1),
        ends_at: ahead(1.1),
      },
    ];
    setup();
    expect(await screen.findByText("My private preparation")).toBeVisible();
    expect(await screen.findByText("Fictional handout.txt")).toHaveAttribute(
      "href",
      "/files?q=Fictional%20handout.txt",
    );
    expect(await screen.findByText("Personal receipt pending")).toBeVisible();
    expect(screen.queryByText("Already acknowledged")).not.toBeInTheDocument();
    expect(screen.queryByText("Expired contract")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Foreign private appointment"),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("2 ungelesene Meldungen")).toBeVisible();
    expect(await screen.findByText("3 ungelesene Nachrichten")).toBeVisible();
    expect(rpcCalls("contract_records")[0].args).toEqual([{ p_all: false }]);
    expect(fake.calls).toContainEqual({
      method: "eq",
      table: "personal_events",
      args: ["user_id", fake.actor],
    });
    expect(fake.calls).toContainEqual({
      method: "eq",
      table: "documents",
      args: ["status", "clean"],
    });
    for (const table of ["documents", "personal_events"])
      expect(fake.calls).toContainEqual({ method: "limit", table, args: [5] });
    expect(rpcCalls("commission_report")).toHaveLength(0);
  });
  it("a failed optional calendar does not hide the rest of the dashboard", async () => {
    fake.errors.personal_events = { code: "42501", message: "denied" };
    setup();
    const calendar = await screen.findByRole("region", {
      name: "Mein Kalender im Blick",
    });
    await waitFor(() =>
      expect(within(calendar).getByRole("alert")).toBeVisible(),
    );
    expect(await screen.findByText("Fictional handout.txt")).toBeVisible();
    expect(await screen.findByText("Fictional course update")).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Arbeitsbereich" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Dein Raum für gute Lehre."),
    ).not.toBeInTheDocument();
  });
  it("access errors hide retained file metadata instead of showing a stale private title", async () => {
    const { client } = setup();
    expect(await screen.findByText("Fictional handout.txt")).toBeVisible();
    fake.errors.documents = { code: "42501", message: "revoked" };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["documents", fake.actor] });
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Fictional handout.txt"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Fictional course update")).toBeVisible();
  });
  it.each(["client", "participant"])(
    "does not request lecturer jobs, claims, expertise or contracts for a pure %s",
    async (role) => {
      fake.roles = [role];
      fake.tables.documents = [];
      setup();
      expect(await screen.findByText("2 ungelesene Meldungen")).toBeVisible();
      expect(
        fake.calls.some(
          (call) =>
            call.method === "from" &&
            ["jobs", "job_claims", "lecturer_topics"].includes(call.table),
        ),
      ).toBe(false);
      expect(rpcCalls("contract_records")).toHaveLength(0);
      expect(rpcCalls("job_offers")).toHaveLength(0);
      expect(
        screen.queryByRole("region", {
          name: "Meine offenen Vertragsbestätigungen",
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Verwaltung: nächste Schritte" }),
      ).not.toBeInTheDocument();
    },
  );
  it("only management capability reveals authorized server aggregate follow-ups", async () => {
    fake.rpcData.get_my_permissions = ["jobs.manage"];
    (fake.rpcData.job_dashboard as { management: unknown }).management = {
      drafts: 1,
      expired: 1,
      upcoming: 1,
    };
    setup(true);
    const followups = await screen.findByRole("region", {
      name: "Verwaltung: nächste Schritte",
    });
    expect(
      within(followups).getByText("1 Auftragsentwurf prüfen"),
    ).toBeVisible();
    expect(
      within(followups).getByText(
        "1 offener Lehrauftrag mit Terminen in den nächsten 14 Tagen",
      ),
    ).toBeVisible();
    expect(
      within(followups).getByText("1 offener Auftrag mit abgelaufener Frist"),
    ).toBeVisible();
    expect(
      within(followups).getByRole("link", { name: "Aufträge verwalten" }),
    ).toHaveAttribute("href", "/admin");
    expect(
      rpcCalls("contract_records").every(
        (call) => JSON.stringify(call.args) === '[{"p_all":false}]',
      ),
    ).toBe(true);
  });
  it("renders authoritative matching suggestions without loading the full catalogue", async () => {
    fake.rpcData.job_dashboard = {
      open_count: 1057,
      assignment_count: 0,
      next_session_count: 0,
      matching: true,
      suggestions: [job("matched")],
      next_assignments: [],
      management: null,
      as_of: ahead(0),
    };
    setup();
    expect(await screen.findByText("Fictional matched")).toBeVisible();
    expect(rpcCalls("job_dashboard")).toHaveLength(1);
    expect(
      fake.calls.filter(
        (call) => call.method === "from" && call.table === "jobs",
      ),
    ).toHaveLength(0);
    expect(screen.getByText("1057", { exact: true })).toBeVisible();
    expect(screen.queryByText("Fictional unmatched")).not.toBeInTheDocument();
    expect(screen.queryByText("Fictional expired")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Passend zu deiner Expertise" }),
    ).toBeVisible();
  });
  it("shares the shell inbox fetch and does not create extra chat or preview polling", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    setup(true, true);
    expect(await screen.findByText("Fictional course update")).toBeVisible();
    expect(rpcCalls("notification_inbox")).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31000);
    });
    expect(rpcCalls("notification_inbox")).toHaveLength(2);
    expect(rpcCalls("chat_rooms_list")).toHaveLength(1);
    expect(
      fake.calls.filter(
        (call) => call.method === "from" && call.table === "documents",
      ),
    ).toHaveLength(1);
  });
  it("language changes preserve cached previews without extra metadata requests", async () => {
    setup(true);
    expect(await screen.findByText("Fictional handout.txt")).toBeVisible();
    const count = fake.calls.length;
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(
      screen.getByRole("region", { name: "Recently added files" }),
    ).toBeVisible();
    expect(screen.getByText("Fictional handout.txt")).toBeVisible();
    expect(fake.calls).toHaveLength(count);
  });
  it("an actor change hides the previous private preview immediately", async () => {
    const page = setup(true);
    expect(await screen.findByText("Fictional handout.txt")).toBeVisible();
    fake.actor = "dashboard-b";
    fake.tables.documents = [
      {
        id: "file-b",
        original_name: "Different actor handout.txt",
        kind: "material",
        created_at: ahead(-1),
      },
    ];
    fake.rpcData.notification_inbox = {
      items: [],
      unread_count: 0,
      as_of: ahead(0),
    };
    page.update();
    expect(screen.queryByText("Fictional handout.txt")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Fictional course update"),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("Different actor handout.txt"),
    ).toBeVisible();
  });
});
