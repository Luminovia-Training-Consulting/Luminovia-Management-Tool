/**
 * Waitlist and recipient-consent regressions with isolated SDK/query fixtures.
 * Current quote refreshes must not reuse acknowledgement of an older deal;
 * native concurrency and permissions remain covered by separate database suites.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import {
  JobWaitlist,
  MyJobWaitlist,
  SubstitutionOffers,
} from "./lifecycle-extra";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  responses: {} as Record<string, unknown>,
}));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "replacement" } } }),
}));
let client: QueryClient;
const job = "1722aa1e-16be-4ca3-8064-fe81e49752ae";
const offer = () => ({
  id: "69da2ce7-1a76-45e0-b46f-fdbe5dde3561",
  job_id: job,
  original_claim_id: "6ed51acb-935b-44e2-bd87-fc8eb55d77a7",
  target_user_id: "a597a651-389e-45f8-acba-92c006d6d261",
  target_name: "Fictional substitute",
  proposer_name: "Fictional source",
  reason: "Fictional replacement request",
  quote_hash: "1".repeat(64),
  status: "pending",
  expires_at: "2047-06-01T08:00:00Z",
  created_at: "2047-05-01T08:00:00Z",
  accepted_claim_id: null,
  can_accept: true,
  can_withdraw: false,
  quote: {
    title: "Fictional immutable block",
    customer_name: "Fictional academy",
    time_zone: "Europe/Berlin",
    delivery_type: "online",
    location: "https://example.invalid/course",
    amount: 125,
    total_amount: 625,
    currency: "EUR",
    rate_unit: "per_day",
    terms: "Immutable reviewed fictional terms",
    terms_version: 1,
    requires_contract: false,
    sessions: [
      { starts_at: "2047-06-01T08:00:00Z", ends_at: "2047-06-01T14:00:00Z" },
    ],
  },
});
beforeEach(async () => {
  await i18n.changeLanguage("de");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fake.responses = {
    job_waitlist: {
      job_id: job,
      title: "Fictional full offer",
      joined: false,
      can_join: true,
      available: false,
    },
    job_substitutions: [offer()],
  };
  fake.rpc.mockReset().mockImplementation((name: string) => {
    const request = {
      abortSignal: () => request,
      then: (done: (value: unknown) => unknown) =>
        Promise.resolve(fake.responses[name]).then((data) =>
          done({ data, error: null }),
        ),
    };
    return request;
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  // The real offline event pauses SDK queries as well as disabling the UI.
  // Restore that global fixture state before another isolated case mounts.
  onlineManager.setOnline(true);
});
function mount(child: React.ReactNode) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{child}</MemoryRouter>
    </QueryClientProvider>,
  );
}

// Private offers retain only the actor's removable interest; their blank title
// is intentional redaction, not a broken API response or a navigation target.
const hiddenInterest = () => ({
  job_id: job,
  title: "",
  joined: true,
  can_join: false,
  available: false,
  joined_at: "2047-05-01T08:00:00Z",
});
const visibleInterest = () => ({
  ...hiddenInterest(),
  job_id: "d3a0753c-54dc-4c39-94fc-355209cb3077",
  title: "Fictional visible waitlist offer",
  available: true,
});
const hiddenLabel = "Derzeit nicht verfügbarer Auftrag";
const hiddenLeave = `Warteliste verlassen: ${hiddenLabel}`;

it("shows a bilingual removable hidden interest without exposing an empty or private job link", async () => {
  fake.responses.my_job_waitlist = [hiddenInterest(), visibleInterest()];
  const foreign = [
    { ...hiddenInterest(), title: "Other actor's private interest" },
  ];
  client.setQueryData(["my-job-waitlist", "another-actor"], foreign);
  mount(<MyJobWaitlist />);
  expect(await screen.findByText(hiddenLabel)).toBeVisible();
  expect(screen.queryByRole("link", { name: "" })).not.toBeInTheDocument();
  expect(document.querySelector(`a[href="/jobs/${job}"]`)).toBeNull();
  expect(
    screen.getByRole("link", { name: visibleInterest().title }),
  ).toHaveAttribute("href", `/jobs/${visibleInterest().job_id}`);
  expect(screen.getByRole("button", { name: hiddenLeave })).toBeEnabled();
  expect(
    screen.queryByText("Other actor's private interest"),
  ).not.toBeInTheDocument();
  const reads = fake.rpc.mock.calls.filter(
    ([name]) => name === "my_job_waitlist",
  ).length;
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByText("Currently unavailable job")).toBeVisible();
  expect(
    screen.getByRole("button", {
      name: "Leave waitlist: Currently unavailable job",
    }),
  ).toBeEnabled();
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "my_job_waitlist"),
  ).toHaveLength(reads);
  expect(client.getQueryData(["my-job-waitlist", "replacement"])).toEqual([
    hiddenInterest(),
    visibleInterest(),
  ]);
  expect(client.getQueryData(["my-job-waitlist", "another-actor"])).toEqual(
    foreign,
  );
});

it("withdraws exactly the hidden interest after server confirmation and scopes cache changes to its actor", async () => {
  fake.responses.my_job_waitlist = [hiddenInterest(), visibleInterest()];
  const foreign = [{ ...hiddenInterest(), title: "Foreign cached interest" }];
  client.setQueryData(["my-job-waitlist", "another-actor"], foreign);
  client.setQueryData(["job-waitlist", "another-actor", job], foreign[0]);
  mount(<MyJobWaitlist />);
  const leave = await screen.findByRole("button", { name: hiddenLeave });
  let resolve!: (value: unknown) => void;
  fake.responses.set_job_waitlist = new Promise((done) => {
    resolve = done;
  });
  await userEvent.click(leave);
  expect(leave).toBeDisabled();
  expect(screen.getByText(hiddenLabel)).toBeVisible();
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "set_job_waitlist"),
  ).toEqual([["set_job_waitlist", { p_job_id: job, p_join: false }]]);
  const receipt = {
    job_id: job,
    title: "",
    joined: false,
    can_join: false,
    available: false,
  };
  fake.responses.my_job_waitlist = [visibleInterest()];
  await act(async () => resolve(receipt));
  await waitFor(() =>
    expect(screen.queryByText(hiddenLabel)).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("link", { name: visibleInterest().title }),
  ).toBeVisible();
  expect(client.getQueryData(["job-waitlist", "replacement", job])).toEqual(
    receipt,
  );
  expect(client.getQueryData(["my-job-waitlist", "another-actor"])).toEqual(
    foreign,
  );
  expect(client.getQueryData(["job-waitlist", "another-actor", job])).toEqual(
    foreign[0],
  );
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "set_job_waitlist"),
  ).toHaveLength(1);
});

it("keeps a hidden interest removable when the server refuses its withdrawal", async () => {
  fake.responses.my_job_waitlist = [hiddenInterest()];
  mount(<MyJobWaitlist />);
  const leave = await screen.findByRole("button", { name: hiddenLeave });
  fake.rpc.mockImplementationOnce(() =>
    Promise.resolve({
      data: null,
      error: { code: "42501", message: "Fictional refusal" },
    }),
  );
  await userEvent.click(leave);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Die Änderung wurde nicht bestätigt.",
  );
  expect(screen.getByText(hiddenLabel)).toBeVisible();
  expect(leave).toBeEnabled();
  expect(client.getQueryData(["my-job-waitlist", "replacement"])).toEqual([
    hiddenInterest(),
  ]);
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "set_job_waitlist"),
  ).toHaveLength(1);
});

it("disables hidden-interest withdrawal offline without calling the mutation", async () => {
  fake.responses.my_job_waitlist = [hiddenInterest()];
  mount(<MyJobWaitlist />);
  const leave = await screen.findByRole("button", { name: hiddenLeave });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(leave).toBeDisabled();
  await userEvent.click(leave);
  expect(screen.getByText(hiddenLabel)).toBeVisible();
  expect(
    fake.rpc.mock.calls.some(([name]) => name === "set_job_waitlist"),
  ).toBe(false);
});

it("waitlist membership is shown only after the real server confirms and reserves nothing", async () => {
  const user = userEvent.setup();
  mount(<JobWaitlist jobId={job} />);
  const join = await screen.findByRole("button", {
    name: "Auf Warteliste setzen",
  });
  let resolve!: (value: unknown) => void;
  fake.responses.set_job_waitlist = new Promise((done) => {
    resolve = done;
  });
  await user.click(join);
  expect(join).toBeDisabled();
  expect(
    screen.queryByText("Du stehst auf der Warteliste."),
  ).not.toBeInTheDocument();
  expect(fake.rpc).toHaveBeenLastCalledWith("set_job_waitlist", {
    p_job_id: job,
    p_join: true,
  });
  await act(async () =>
    resolve({ ...(fake.responses.job_waitlist as object), joined: true }),
  );
  expect(
    await screen.findByText("Du stehst auf der Warteliste."),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Warteliste verlassen" }),
  ).toBeEnabled();
});

it("exact quoted terms need explicit consent and a conflicting response never announces confirmation", async () => {
  const user = userEvent.setup();
  mount(<SubstitutionOffers />);
  expect(
    await screen.findByText("Immutable reviewed fictional terms"),
  ).toBeVisible();
  const accept = screen.getByRole("button", {
    name: "Vertretung verbindlich übernehmen",
  });
  expect(accept).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", {
      name: "Ich akzeptiere diese Konditionen und sämtliche angezeigten Termine als zusammenhängenden Unterrichtsblock.",
    }),
  );
  let resolve!: (value: unknown) => void;
  fake.responses.respond_job_substitution = new Promise((done) => {
    resolve = done;
  });
  await user.click(accept);
  expect(accept).toBeDisabled();
  expect(
    screen.queryByText(/Die Vertretung ist verbindlich bestätigt/),
  ).not.toBeInTheDocument();
  expect(fake.rpc).toHaveBeenCalledWith(
    "respond_job_substitution",
    expect.objectContaining({
      p_offer_id: offer().id,
      p_quote_hash: offer().quote_hash,
      p_accept_terms: true,
      p_action: "accept",
    }),
  );
  await act(async () => resolve({ status: "conflict" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Es wurden keine Termine übertragen.",
  );
  expect(
    screen.queryByText(/Die Vertretung ist verbindlich bestätigt/),
  ).not.toBeInTheDocument();
});

/** Refresh the existing query observer rather than remounting the offer component. */
async function replaceCurrentOffer(updated: ReturnType<typeof offer>) {
  fake.responses.job_substitutions = [updated];
  await act(async () => {
    client.setQueryData(
      ["job-substitutions", "replacement", "inbox"],
      [updated],
    );
  });
}

it.each([
  [
    "rate",
    (value: ReturnType<typeof offer>) => ({
      ...value,
      quote: { ...value.quote, amount: 0 },
    }),
  ],
  [
    "total",
    (value: ReturnType<typeof offer>) => ({
      ...value,
      quote: { ...value.quote, total_amount: 725 },
    }),
  ],
  [
    "currency",
    (value: ReturnType<typeof offer>) => ({
      ...value,
      quote: { ...value.quote, currency: "AUD" },
    }),
  ],
  [
    "rate unit",
    (value: ReturnType<typeof offer>) => ({
      ...value,
      quote: { ...value.quote, rate_unit: "fixed_total" },
    }),
  ],
  [
    "terms text",
    (value: ReturnType<typeof offer>) => ({
      ...value,
      quote: { ...value.quote, terms: "Changed fictional terms" },
    }),
  ],
  [
    "terms version",
    (value: ReturnType<typeof offer>) => ({
      ...value,
      quote: { ...value.quote, terms_version: 2 },
    }),
  ],
  [
    "server quote hash",
    (value: ReturnType<typeof offer>) => ({
      ...value,
      quote_hash: "2".repeat(64),
    }),
  ],
  [
    "session",
    (value: ReturnType<typeof offer>) => ({
      ...value,
      quote: {
        ...value.quote,
        sessions: [
          { ...value.quote.sessions[0], ends_at: "2047-06-01T15:00:00Z" },
        ],
      },
    }),
  ],
  [
    "contract prerequisite",
    (value: ReturnType<typeof offer>) => ({
      ...value,
      quote: { ...value.quote, requires_contract: true },
    }),
  ],
  [
    "teaching location",
    (value: ReturnType<typeof offer>) => ({
      ...value,
      quote: { ...value.quote, location: "Changed fictional venue" },
    }),
  ],
] as const)(
  "requires fresh consent when the same substitution changes its %s",
  async (_label, change) => {
    const user = userEvent.setup();
    mount(<SubstitutionOffers />);
    await screen.findByText("Immutable reviewed fictional terms");
    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: "Vertretung verbindlich übernehmen" }),
    ).toBeEnabled();

    const changed = change(offer());
    await replaceCurrentOffer(changed);
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
    const accept = screen.getByRole("button", {
      name: "Vertretung verbindlich übernehmen",
    });
    expect(accept).toBeDisabled();
    await user.click(accept);
    expect(
      fake.rpc.mock.calls.some(([name]) => name === "respond_job_substitution"),
    ).toBe(false);

    // Returning to an older snapshot must not resurrect its former acknowledgement.
    await replaceCurrentOffer(offer());
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
    await replaceCurrentOffer(changed);
    await user.click(screen.getByRole("checkbox"));
    fake.responses.respond_job_substitution = { status: "conflict" };
    await user.click(
      screen.getByRole("button", { name: "Vertretung verbindlich übernehmen" }),
    );
    await waitFor(() =>
      expect(fake.rpc).toHaveBeenCalledWith(
        "respond_job_substitution",
        expect.objectContaining({
          p_offer_id: changed.id,
          p_quote_hash: changed.quote_hash,
          p_accept_terms: true,
        }),
      ),
    );
  },
);

it("preserves explicit substitution consent across an unchanged server refresh and UI language change", async () => {
  const user = userEvent.setup();
  mount(<SubstitutionOffers />);
  await screen.findByText("Immutable reviewed fictional terms");
  await user.click(screen.getByRole("checkbox"));
  await replaceCurrentOffer({
    ...offer(),
    quote: {
      ...offer().quote,
      sessions: offer().quote.sessions.map((item) => ({ ...item })),
    },
  });
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Accept substitution now" }),
  ).toBeEnabled();
  expect(
    fake.rpc.mock.calls.some(([name]) => name === "respond_job_substitution"),
  ).toBe(false);
});

it("a successful online response refreshes the immutable quote and survives a UI language change without refetch", async () => {
  const user = userEvent.setup();
  mount(<SubstitutionOffers />);
  await screen.findByText("Immutable reviewed fictional terms");
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  await user.click(
    screen.getByRole("checkbox", {
      name: "I accept these terms and all displayed sessions as one complete teaching block.",
    }),
  );
  fake.responses.respond_job_substitution = {
    status: "confirmed",
    claim_id: "bc8f023c-5f82-4b6f-8ea2-47daf8a210cb",
  };
  fake.responses.job_substitutions = [
    {
      ...offer(),
      status: "accepted",
      can_accept: false,
      accepted_claim_id: "bc8f023c-5f82-4b6f-8ea2-47daf8a210cb",
    },
  ];
  await user.click(
    screen.getByRole("button", { name: "Accept substitution now" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "The substitution is confirmed.",
    ),
  );
  expect(
    screen.queryByRole("button", { name: "Accept substitution now" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Immutable reviewed fictional terms")).toBeVisible();
});

it("shows operational history without another recipient's private price or a consent action", async () => {
  const sourceView = offer();
  fake.responses.job_substitutions = [
    {
      ...sourceView,
      quote_hash: null,
      can_accept: false,
      can_withdraw: true,
      quote: {
        ...sourceView.quote,
        amount: null,
        total_amount: null,
        currency: null,
        rate_unit: null,
        terms: null,
        terms_version: null,
      },
    },
  ];
  mount(<SubstitutionOffers jobId={job} />);
  expect(
    await screen.findByText(
      "Die persönlichen Konditionen sind nur für die angefragte Vertretung sichtbar.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText("Immutable reviewed fictional terms"),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Vertretung verbindlich übernehmen" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(
    screen.getByText(
      "Personal compensation is visible only to the proposed replacement.",
    ),
  ).toBeVisible();
});

it("reports a cancelled accepted receipt truthfully after a transport retry in both languages", async () => {
  const user = userEvent.setup();
  mount(<SubstitutionOffers />);
  await screen.findByText("Immutable reviewed fictional terms");
  await user.click(screen.getByRole("checkbox"));
  fake.responses.respond_job_substitution = {
    status: "cancelled",
    claim_id: "bc8f023c-5f82-4b6f-8ea2-47daf8a210cb",
  };
  fake.responses.job_substitutions = [
    { ...offer(), status: "accepted", can_accept: false },
  ];
  await user.click(
    screen.getByRole("button", { name: "Vertretung verbindlich übernehmen" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Die bestätigte Vertretung wurde inzwischen abgesagt. Es wurden keine Termine erneut reserviert.",
  );
  expect(
    screen.queryByText("Die Vertretung ist verbindlich bestätigt."),
  ).not.toBeInTheDocument();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The confirmed replacement has since been cancelled. No sessions were reserved again.",
  );
  expect(
    screen.queryByText("The substitution is confirmed."),
  ).not.toBeInTheDocument();
});
