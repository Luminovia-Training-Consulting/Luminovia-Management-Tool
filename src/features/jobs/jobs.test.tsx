/**
 * Regressions for actual claim state, current-terms consent and safe retry identities. SDK/DOM
 * fixtures do not prove atomic server allocation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "../../lib/i18n";
import { JobDetail } from "./jobs";
import { JobDiscovery } from "./discovery";
import {
  filtersFromParams,
  jobDetailQuery,
  jobDiscoveryQuery,
} from "./discovery-api";
import { lifecycleQuery, type LifecycleClaim } from "./lifecycle-api";
import type { Job } from "../../lib/types";

vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "lecturer-a" } } }),
}));
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const failedDetailClients: QueryClient[] = [];
afterEach(async () => {
  cleanup();
  failedDetailClients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
  rpc.mockReset();
  await i18n.changeLanguage("de");
});
const job: Job & {
  created_at: string;
  confirmed_count: number;
  open_positions: number;
  capacity: number;
  capacity_basis: "single_position";
} = {
  created_at: "2026-01-01T00:00:00Z",
  confirmed_count: 0,
  open_positions: 1,
  capacity: 1,
  capacity_basis: "single_position",
  id: "job-a",
  title: "Python Block",
  description: "Example",
  customer_name: "Example Academy",
  delivery_type: "online",
  location: "Online",
  time_zone: "Europe/Berlin",
  status: "published",
  amount: 400,
  total_amount: 2000,
  currency: "EUR",
  rate_unit: "per_day",
  terms: "Version one",
  terms_version: 1,
  requires_contract: false,
  claim_deadline: null,
  job_sessions: [
    {
      id: "session1",
      job_id: "job-a",
      starts_at: "2027-01-01T08:00:00Z",
      ends_at: "2027-01-01T14:00:00Z",
    },
    {
      id: "session2",
      job_id: "job-a",
      starts_at: "2027-01-10T08:00:00Z",
      ends_at: "2027-01-10T14:00:00Z",
    },
  ],
  job_requirements: [],
};

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(
  route = "/jobs/job-a",
  list = false,
  overrides: Partial<
    Job & { dispatch_only: boolean; confirmed_count: number }
  > = {},
  roles = ["lecturer"],
) {
  const offer = { ...job, ...overrides };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["jobs", "detail", "lecturer-a", "job-a"], offer);
  client.setQueryData(["permissions", "lecturer-a"], []);
  client.setQueryData(["job-lifecycle", "lecturer-a", "job-a"], {
    version: 1,
    can_manage: false,
    can_edit: false,
    can_duplicate: false,
    claims: [],
  });
  client.setQueryData(["user-roles", "lecturer-a"], roles);
  client.setQueryData(["saved-job-views", "lecturer-a"], []);
  client.setQueryData(["job-substitutions", "lecturer-a", "inbox"], []);
  client.setQueryData(["my-job-waitlist", "lecturer-a"], []);
  if (list) {
    const parsed = filtersFromParams(
      new URL(route, "https://example.invalid").searchParams,
    );
    if (!parsed.success) throw new Error("Invalid fixture filters");
    client.setQueryData(
      jobDiscoveryQuery("lecturer-a", parsed.data, "lecturer").queryKey,
      {
        pages: [
          {
            items: parsed.data.from ? [] : [offer],
            has_more: false,
            next_cursor: null,
            as_of: new Date().toISOString(),
            filters: parsed.data,
          },
        ],
        pageParams: [null],
      },
    );
  }
  client.setQueryData(["topics"], []);
  client.setQueryData(["claims", "lecturer-a"], []);
  client.setQueryData(["profile", "lecturer-a"], {
    time_zone: "Europe/Berlin",
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route
            path={list ? "/jobs" : "/jobs/:id"}
            element={list ? <JobDiscovery /> : <JobDetail />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

it("opens description and coordinated course dates from the course action row", async () => {
  const courseId = "ee000000-0000-4000-8000-000000000010";
  const claimId = "ee000000-0000-4000-8000-000000000011";
  rpc.mockImplementation((name) => ({
    abortSignal: async () => ({
      data:
        name === "job_related_navigation"
          ? { course_id: courseId, rooms: [] }
          : null,
      error: null,
    }),
  }));
  const client = setup("/jobs/job-a", false, { status: "filled" }, ["admin"]);
  act(() => {
    client.setQueryData(["job-lifecycle", "lecturer-a", job.id], {
      can_manage: true,
      can_edit: false,
      can_edit_metadata: true,
      version: 2,
      claims: [
        {
          id: claimId,
          status: "confirmed",
          lecturer_name: "Example Lecturer",
          created_at: job.created_at,
          sessions: [],
          events: [],
        },
      ],
    });
    client.setQueryData(
      ["changeable-assignments", "lecturer-a"],
      [
        {
          claim_id: claimId,
          lecturer_name: "Example Lecturer",
          schedule_editable: true,
          shared_schedule_only: true,
          current: {
            ...job,
            job_id: job.id,
            course_run_id: courseId,
            sessions: job.job_sessions,
          },
        },
      ],
    );
  });
  const edit = await screen.findByRole("button", {
    name: "Auftrag bearbeiten",
  });
  expect(edit).toHaveClass("button-danger");
  const toolbar = within(edit.closest(".job-detail-toolbar")! as HTMLElement);
  expect(
    await toolbar.findByRole("link", { name: "Kursarbeitsraum öffnen" }),
  ).toBeVisible();
  expect(toolbar.getByText("Vergeben")).toBeVisible();
  expect(toolbar.getByText("Unternehmen: Example Academy")).toBeVisible();
  expect(toolbar.getByText("Dozierende: Example Lecturer")).toBeVisible();
  await userEvent.click(edit);
  const dialog = within(
    await screen.findByRole("dialog", { name: "Auftrag bearbeiten" }),
  );
  expect(
    dialog.getByRole("textbox", { name: "Auftragsbeschreibung" }),
  ).toHaveValue("Example");
  expect(await dialog.findByLabelText("Erster Tag")).toHaveValue("2027-01-01");
  expect(dialog.getByLabelText("Letzter Tag")).toHaveValue("2027-01-10");
  await userEvent.click(
    dialog.getByRole("link", { name: "Klasse und Dozentenzuweisung" }),
  );
  await waitFor(() =>
    expect(document.getElementById("job-allocation")).toHaveFocus(),
  );
});

describe("job detail labels from the actor-scoped lifecycle", () => {
  const lifecycleKey = lifecycleQuery("lecturer-a", job.id).queryKey;
  const currentClaim: LifecycleClaim = {
    id: "current-claim",
    lecturer_id: "lecturer-a",
    lecturer_name: "Alex Example",
    status: "confirmed",
    created_at: job.created_at,
    can_cancel: false,
    sessions: [],
    events: [],
  };
  const formerClaim: LifecycleClaim = {
    ...currentClaim,
    id: "former-claim",
    lecturer_id: "lecturer-former",
    lecturer_name: "Former Lecturer",
    status: "cancelled",
  };

  it("shows only confirmed lecturers for a partially staffed offer, then removes the label when no claim remains confirmed", async () => {
    await i18n.changeLanguage("en");
    const client = setup(
      "/jobs/job-a",
      false,
      { capacity: 3, capacity_basis: "per_position", confirmed_count: 2 },
      ["management"],
    );
    const state = {
      version: 2,
      can_manage: true,
      can_edit: false,
      can_duplicate: false,
      claims: [
        currentClaim,
        {
          ...currentClaim,
          id: "another-claim",
          lecturer_id: "lecturer-b",
          lecturer_name: "Sam Example",
        },
        formerClaim,
      ],
    };
    act(() => client.setQueryData(lifecycleKey, state));
    const toolbar = within(document.querySelector(".job-detail-toolbar")!);
    expect(toolbar.getByText("Company: Example Academy")).toBeVisible();
    expect(
      await toolbar.findByText("Lecturers: Alex Example and Sam Example"),
    ).toBeVisible();
    expect(toolbar.queryByText(/Former Lecturer/)).not.toBeInTheDocument();

    act(() =>
      client.setQueryData(lifecycleKey, { ...state, claims: [formerClaim] }),
    );
    await waitFor(() =>
      expect(toolbar.queryByText(/Lecturers?:/)).not.toBeInTheDocument(),
    );
    expect(toolbar.queryByText(/Former Lecturer/)).not.toBeInTheDocument();
  });

  it("does not render retained lecturer names after lifecycle access is denied", async () => {
    const client = setup("/jobs/job-a", false, {
      status: "filled",
      confirmed_count: 1,
    });
    act(() => {
      client.setQueryData(lifecycleKey, {
        version: 2,
        can_manage: false,
        can_edit: false,
        can_duplicate: false,
        claims: [currentClaim],
      });
    });
    const toolbar = within(document.querySelector(".job-detail-toolbar")!);
    expect(await toolbar.findByText("Dozierende: Alex Example")).toBeVisible();

    rpc.mockReturnValue({
      abortSignal: async () => ({ data: null, error: { code: "42501" } }),
    });
    await act(async () => client.invalidateQueries({ queryKey: lifecycleKey }));
    await waitFor(() =>
      expect(toolbar.queryByText(/Alex Example/)).not.toBeInTheDocument(),
    );
    expect(toolbar.getByText("Unternehmen: Example Academy")).toBeVisible();
  });
});

describe("safe marketplace interactions", () => {
  it.each(["management", "client", "participant", "admin", "owner"])(
    "withholds personal teaching actions from %s, even with a retained claim",
    async (role) => {
      const client = setup("/jobs/job-a", false, {}, [role]);
      expect(
        await screen.findByRole("heading", { name: "Python Block" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Auftrag übernehmen" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("checkbox", { name: "Konditionen akzeptieren" }),
      ).not.toBeInTheDocument();
      await act(async () =>
        client.setQueryData(
          ["claims", "lecturer-a"],
          [
            {
              ...job,
              id: "retained-claim",
              job_id: job.id,
              status: "confirmed",
              assignment_sessions: [],
            },
          ],
        ),
      );
      expect(
        screen.queryByRole("link", { name: "Rechnung einreichen" }),
      ).not.toBeInTheDocument();
    },
  );

  it("lets company lecturers accept an internal assignment without displaying a rate", async () => {
    const user = userEvent.setup();
    setup("/jobs/job-a", false, {
      company_internal: true,
      amount: null,
      total_amount: null,
    });
    expect(
      screen.getByText(/Interner Einsatz für eigene Dozierende/),
    ).toBeVisible();
    expect(screen.queryByText("Honorar geschützt")).not.toBeInTheDocument();
    const accept = screen.getByRole("button", { name: "Auftrag übernehmen" });
    expect(accept).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: "Konditionen akzeptieren" }),
    );
    expect(accept).toBeEnabled();
  });

  it("gives a mixed management and lecturer account teaching actions while its teaching role remains assigned", async () => {
    const client = setup("/jobs/job-a", false, {}, ["management", "lecturer"]);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("checkbox", { name: "Konditionen akzeptieren" }),
    );
    expect(
      screen.getByRole("button", { name: "Auftrag übernehmen" }),
    ).toBeEnabled();
    await act(async () =>
      client.setQueryData(["user-roles", "lecturer-a"], ["management"]),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Auftrag übernehmen" }),
      ).not.toBeInTheDocument(),
    );
    await act(async () =>
      client.setQueryData(
        ["user-roles", "lecturer-a"],
        ["management", "lecturer"],
      ),
    );
    expect(
      await screen.findByRole("checkbox", { name: "Konditionen akzeptieren" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Auftrag übernehmen" }),
    ).toBeDisabled();
  });

  it("disables a conflicting offer from confirmed assignment instants before consent", async () => {
    const user = userEvent.setup();
    const client = setup();
    await act(async () =>
      client.setQueryData(
        ["claims", "lecturer-a"],
        [
          {
            id: "confirmed-other",
            job_id: "other-job",
            status: "confirmed",
            assignment_sessions: [
              {
                id: "assigned-session",
                claim_id: "confirmed-other",
                starts_at: job.job_sessions[0].starts_at,
                ends_at: job.job_sessions[0].ends_at,
              },
            ],
          },
        ],
      ),
    );
    expect(
      await screen.findByText(
        "Mindestens ein Termin überschneidet sich mit deinem Kalender.",
      ),
    ).toBeVisible();
    await user.click(
      screen.getByRole("checkbox", { name: "Konditionen akzeptieren" }),
    );
    expect(
      screen.getByRole("button", { name: "Auftrag übernehmen" }),
    ).toBeDisabled();
    expect(rpc.mock.calls.some(([name]) => name === "claim_job")).toBe(false);
    await act(async () =>
      client.setQueryData(
        ["claims", "lecturer-a"],
        [
          {
            id: "released-other",
            job_id: "other-job",
            status: "confirmed",
            assignment_sessions: [
              {
                id: "released-session",
                claim_id: "released-other",
                starts_at: job.job_sessions[0].starts_at,
                ends_at: job.job_sessions[0].ends_at,
                released_at: "2026-11-17T00:00:00Z",
              },
            ],
          },
        ],
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Auftrag übernehmen" }),
      ).toBeEnabled(),
    );
  });

  it("retains the protected quote state in a paged discovery card", () => {
    setup("/jobs", true, { amount: null, total_amount: null });
    expect(screen.getByText("Honorar geschützt")).toBeVisible();
    expect(screen.queryByText("0,00 €")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Python Block" })).toBeVisible();
  });
  it("shows restricted compensation without turning an unavailable amount into a zero-price offer", async () => {
    const client = setup();
    await act(async () =>
      client.setQueryData(["jobs", "detail", "lecturer-a", "job-a"], {
        ...job,
        amount: null,
        total_amount: null,
      }),
    );
    expect(await screen.findByText("Honorar geschützt")).toBeVisible();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Konditionen akzeptieren" }),
    );
    expect(
      screen.getByRole("button", { name: "Auftrag übernehmen" }),
    ).toBeDisabled();
    expect(screen.queryByText(/0,00/)).not.toBeInTheDocument();
    expect(rpc.mock.calls.some(([name]) => name === "claim_job")).toBe(false);
  });
  it("requires new consent when an offer version changes during a refetch", async () => {
    const user = userEvent.setup();
    const client = setup();
    await user.click(
      screen.getByRole("checkbox", { name: "Konditionen akzeptieren" }),
    );
    expect(
      screen.getByRole("button", { name: "Auftrag übernehmen" }),
    ).toBeEnabled();
    await act(async () => {
      client.setQueryData(["jobs", "detail", "lecturer-a", "job-a"], {
        ...job,
        terms_version: 2,
        terms: "Updated terms",
      });
    });
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
    expect(
      screen.getByRole("button", { name: "Auftrag übernehmen" }),
    ).toBeDisabled();
    expect(
      rpc.mock.calls.filter(([name]) => name === "claim_job"),
    ).toHaveLength(0);
  });
  it.each([
    { amount: 301 },
    { total_amount: 1505 },
    { currency: "AUD" as const },
    { rate_unit: "per_hour" as const },
    { terms: "Revised assignment terms" },
  ])(
    "requires new consent when the displayed quote changes without a version change: %j",
    async (quote) => {
      const user = userEvent.setup();
      const client = setup();
      await user.click(
        screen.getByRole("checkbox", { name: "Konditionen akzeptieren" }),
      );
      expect(
        screen.getByRole("button", { name: "Auftrag übernehmen" }),
      ).toBeEnabled();
      await act(async () => {
        client.setQueryData(["jobs", "detail", "lecturer-a", "job-a"], {
          ...job,
          ...quote,
        });
      });
      await waitFor(() =>
        expect(screen.getByRole("checkbox")).not.toBeChecked(),
      );
      expect(
        screen.getByRole("button", { name: "Auftrag übernehmen" }),
      ).toBeDisabled();
      expect(
        rpc.mock.calls.filter(([name]) => name === "claim_job"),
      ).toHaveLength(0);
    },
  );
  it("renders the authorized empty session-range response without a catalogue preload", () => {
    setup("/jobs?from=2027-01-05&to=2027-01-06", true);
    expect(
      screen.getByText("Hier ist Raum für neue Möglichkeiten."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Python Block/ }),
    ).not.toBeInTheDocument();
  });
  it("renders the authorized combined text, currency and delivery result", () => {
    setup("/jobs?q=python&currency=EUR&delivery=online", true);
    expect(
      screen.getByRole("link", { name: "Python Block" }),
    ).toBeInTheDocument();
  });
});

// A filled offer may deny the general detail RPC while an independent reduced
// waitlist projection still permits registering interest. Exercise both actual
// query errors and retained cached detail, never a fabricated null-success DTO.
const filledJobId = "302ef67e-03ec-44fb-ad3a-f2397e7b81fd";

async function setupFailedDetail(
  error: unknown,
  cached = false,
  waitlistDenied = false,
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryOnMount: false, staleTime: Infinity },
    },
  });
  failedDetailClients.push(client);
  const waitlist = {
    job_id: filledJobId,
    title: "Fictional reduced filled offer",
    joined: false,
    can_join: true,
    available: false,
  };
  rpc.mockImplementation((name: string) => {
    const result =
      name === "job_detail"
        ? { data: null, error }
        : name === "job_waitlist"
          ? {
              data: waitlistDenied ? null : waitlist,
              error: waitlistDenied ? { code: "42501" } : null,
            }
          : {
              data: { ...waitlist, joined: true, can_join: false },
              error: null,
            };
    const request = {
      abortSignal: () => request,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result).then(resolve),
    };
    return request;
  });
  client.setQueryData(["permissions", "lecturer-a"], []);
  client.setQueryData(["user-roles", "lecturer-a"], ["lecturer"]);
  client.setQueryData(["topics"], []);
  client.setQueryData(["claims", "lecturer-a"], []);
  client.setQueryData(["profile", "lecturer-a"], {
    time_zone: "Europe/Berlin",
  });
  const options = jobDetailQuery("lecturer-a", filledJobId);
  if (cached)
    client.setQueryData(options.queryKey, {
      ...job,
      id: filledJobId,
      title: "PRIVATE retained detail title",
      description: "PRIVATE retained detail description",
      terms: "PRIVATE retained agreed terms",
    });
  await expect(client.fetchQuery({ ...options, staleTime: 0 })).rejects.toBe(
    error,
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/jobs/${filledJobId}`]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe("independent waitlist after a denied job detail", () => {
  it.each([false, true])(
    "offers the reduced filled-job waitlist after42501 without rendering private cached detail: cached=%s",
    async (cached) => {
      await setupFailedDetail(
        { code: "42501", message: "Job access denied" },
        cached,
      );
      const join = await screen.findByRole("button", {
        name: "Auf Warteliste setzen",
      });
      expect(screen.getByText("Fictional reduced filled offer")).toBeVisible();
      expect(screen.queryByText(/PRIVATE retained/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Auftrag übernehmen" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Erneut versuchen" }),
      ).not.toBeInTheDocument();
      await userEvent.click(join);
      expect(
        await screen.findByText("Du stehst auf der Warteliste."),
      ).toBeVisible();
      expect(
        rpc.mock.calls.filter(([name]) => name === "set_job_waitlist"),
      ).toEqual([
        ["set_job_waitlist", { p_job_id: filledJobId, p_join: true }],
      ]);
    },
  );

  it("keeps private or unknown waitlist denials generic after the detail is denied", async () => {
    const client = await setupFailedDetail({ code: "42501" }, true, true);
    await waitFor(() =>
      expect(
        client.getQueryState(["job-waitlist", "lecturer-a", filledJobId])
          ?.status,
      ).toBe("error"),
    );
    expect(screen.queryByText(/PRIVATE retained/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Fictional reduced filled offer"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Auf Warteliste setzen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Auftrag übernehmen" }),
    ).not.toBeInTheDocument();
    expect(
      rpc.mock.calls.filter(([name]) => name === "set_job_waitlist"),
    ).toHaveLength(0);
  });

  it.each([
    ["transport failure", new TypeError("Failed to fetch")],
    ["server failure", { code: "XX000", message: "Fictional server failure" }],
    [
      "expired authentication",
      { code: "PGRST301", message: "Fictional expired token" },
    ],
  ])(
    "retains retry ErrorState for %s without mounting a waitlist or stale detail",
    async (_label, error) => {
      await setupFailedDetail(error, true);
      const retry = screen.getByRole("button", { name: "Erneut versuchen" });
      expect(retry).toBeVisible();
      expect(screen.queryByText(/PRIVATE retained/)).not.toBeInTheDocument();
      expect(
        rpc.mock.calls.filter(([name]) => name === "job_waitlist"),
      ).toHaveLength(0);
      const reads = rpc.mock.calls.filter(
        ([name]) => name === "job_detail",
      ).length;
      await userEvent.click(retry);
      await waitFor(() =>
        expect(
          rpc.mock.calls.filter(([name]) => name === "job_detail"),
        ).toHaveLength(reads + 1),
      );
    },
  );
});

it("uses the scoped company detail without querying private material or rendering lecturer terms", async () => {
  setup(
    "/jobs/job-a",
    false,
    {
      dispatch_only: true,
      description: "Fictional company job summary",
      status: "filled",
      confirmed_count: 1,
    },
    ["client"],
  );
  expect(
    await screen.findByText("Fictional company job summary"),
  ).toBeVisible();
  const toolbar = within(document.querySelector(".job-detail-toolbar")!);
  expect(toolbar.getByText("Unternehmen: Example Academy")).toBeVisible();
  expect(toolbar.getByText("Vergeben")).toBeVisible();
  expect(toolbar.queryByText(/Dozierende:/)).not.toBeInTheDocument();
  expect(screen.queryByText("Version one")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /zurück/i })).toHaveAttribute(
    "href",
    "/client",
  );
  expect(rpc).not.toHaveBeenCalledWith(
    "job_related_navigation",
    expect.anything(),
  );
  expect(rpc).not.toHaveBeenCalledWith("job_briefing", expect.anything());
  expect(rpc).not.toHaveBeenCalledWith(
    "job_building_block_reference",
    expect.anything(),
  );
});
