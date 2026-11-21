/** Mocked component/adapter regressions for replacements. Real authentication, PostgreSQL, scanner and browser acceptance are exercised by the separate isolated integration suites. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { ReplacementMarketplacePage } from "./replacements";
import { replacementRequestSchema } from "./api";

const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
const clients: QueryClient[] = [];
const id = "c936bc75-3d6b-466c-9610-cbda71380ab1";
const makeOffer = () => ({
  id,
  job_id: id,
  title: "Fictional replacement",
  time_zone: "Europe/Berlin",
  status: "open",
  mode: "open",
  emergency: false,
  version: 1,
  created_at: "2026-11-16T00:00:00Z",
  can_cancel: false,
  can_claim: true,
  reason: null,
  quote: {
    amount: 120,
    total_amount: 240,
    currency: "EUR",
    rate_unit: "per_day",
    terms: "Fictional agreed terms",
    terms_version: 1,
  },
  sessions: [
    { starts_at: "2040-01-02T08:00:00Z", ends_at: "2040-01-02T10:00:00Z" },
  ],
});

function setup(
  result: { status: string; claim_id?: string } = {
    status: "confirmed",
    claim_id: id,
  },
) {
  const offer = makeOffer();
  state.rpc.mockImplementation((name: string) => {
    const response =
      name === "replacement_marketplace"
        ? [offer]
        : name === "replacement_assignments"
          ? []
          : result;
    const promise = Promise.resolve({ data: response, error: null });
    return Object.assign(promise, { abortSignal: () => promise });
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReplacementMarketplacePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, offer };
}

afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  state.online = true;
  vi.clearAllMocks();
  await i18n.changeLanguage("de");
});
it("requires fresh consent after any quote/session changes and confirms only server success", async () => {
  const user = userEvent.setup(),
    { client, offer } = setup();
  const button = await screen.findByRole("button", {
    name: "Gesamten Block übernehmen",
  });
  expect(button).toBeDisabled();
  const consent = screen.getByRole("checkbox");
  await user.click(consent);
  expect(button).toBeEnabled();
  const updated = { ...offer, quote: { ...offer.quote, total_amount: 260 } };
  client.setQueryData(["replacements", "actor"], [updated]);
  await waitFor(() => expect(consent).not.toBeChecked());
  expect(button).toBeDisabled();
  await user.click(consent);
  await user.click(button);
  await screen.findByText(
    "Übernahme online bestätigt. Alle Termine sind zugeordnet.",
  );
  expect(state.rpc).toHaveBeenCalledWith(
    "claim_replacement",
    expect.objectContaining({
      p_offer_id: id,
      p_expected_version: 1,
      p_terms_version: 1,
      p_request_id: expect.any(String),
    }),
  );
});
it("never presents a rejected handover as confirmed and preserves the same retry identity", async () => {
  const user = userEvent.setup();
  setup({ status: "not_eligible" });
  await user.click(await screen.findByRole("checkbox"));
  const button = screen.getByRole("button", {
    name: "Gesamten Block übernehmen",
  });
  await user.click(button);
  await screen.findByText(/Eine Voraussetzung ist nicht mehr erfüllt/);
  expect(
    screen.queryByText(/Übernahme online bestätigt/),
  ).not.toBeInTheDocument();
  await user.click(button);
  await waitFor(() =>
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "claim_replacement"),
    ).toHaveLength(2),
  );
  const calls = state.rpc.mock.calls.filter(
    ([name]) => name === "claim_replacement",
  );
  expect(calls[0][1].p_request_id).toBe(calls[1][1].p_request_id);
});
it("hides protected content offline and supports English", async () => {
  state.online = false;
  await i18n.changeLanguage("en");
  setup();
  expect(
    await screen.findByRole("heading", { name: "Replacement marketplace" }),
  ).toBeVisible();
  expect(state.rpc).not.toHaveBeenCalled();
  expect(screen.queryByText("Fictional agreed terms")).not.toBeInTheDocument();
});
it("validates open and selected requests before sending mutations", () => {
  const values = {
    claim: id,
    reason: "Fictional replacement request",
    mode: "open",
    invited: [],
    emergency: false,
  };
  expect(replacementRequestSchema.safeParse(values).success).toBe(true);
  expect(
    replacementRequestSchema.safeParse({ ...values, mode: "selected" }).success,
  ).toBe(false);
  expect(
    replacementRequestSchema.safeParse({ ...values, invited: [id] }).success,
  ).toBe(false);
  expect(
    replacementRequestSchema.safeParse({ ...values, reason: " " }).success,
  ).toBe(false);
});
