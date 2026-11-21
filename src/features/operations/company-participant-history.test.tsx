import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CompanyParticipantHistory } from "./company-participant-history";
import { companyParticipantHistorySchema } from "./company-participant-schema";
import "./i18n";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

const requested = {
  id: "b1839644-0891-49cd-957e-a20a2da077e4",
  kind: "user_id_link_requested",
  occurred_at: "2026-11-21T12:14:29+10:00",
};
const confirmed = {
  id: "a1839644-0891-49cd-957e-a20a2da077e4",
  kind: "association_confirmed",
  occurred_at: "2026-11-21T12:15:29+10:00",
};

afterEach(() => {
  cleanup();
  rpc.mockReset();
});

async function openHistory(language = "en") {
  await i18n.changeLanguage(language);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CompanyParticipantHistory
        actor="fictional-actor"
        organisationId="fictional-company"
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

it("shows consent separately and passes the opaque cursor to load older requests", async () => {
  rpc.mockImplementation((_name, args) => ({
    abortSignal: async () => ({
      data: args.p_before_id
        ? { items: [requested], has_more: false }
        : { items: [confirmed], has_more: true },
      error: null,
    }),
  }));
  await openHistory();
  expect(await screen.findByText("Company link accepted")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load older entries" }));
  expect(await screen.findByText("Link by user ID requested")).toBeVisible();
  expect(rpc.mock.calls).toEqual([
    [
      "company_participant_history",
      {
        p_organisation_id: "fictional-company",
        p_before_at: null,
        p_before_id: null,
      },
    ],
    [
      "company_participant_history",
      {
        p_organisation_id: "fictional-company",
        p_before_at: confirmed.occurred_at,
        p_before_id: confirmed.id,
      },
    ],
  ]);
  expect(
    screen.queryByRole("button", { name: "Load older entries" }),
  ).toBeNull();
});

it("shows a German empty state for a company without requests", async () => {
  rpc.mockReturnValue({
    abortSignal: async () => ({
      data: { items: [], has_more: false },
      error: null,
    }),
  });
  await openHistory("de");
  expect(
    await screen.findByText(
      "Für dieses Unternehmen sind noch keine Aktionen erfasst.",
    ),
  ).toBeVisible();
});

it("rejects unexpected identity and delivery fields at the shared wire boundary", () => {
  for (const field of ["email", "target_user_id", "delivery_status"]) {
    const result = companyParticipantHistorySchema.safeParse({
      items: [{ ...requested, [field]: "fictional-private-value" }],
      has_more: false,
    });
    expect(result.success).toBe(false);
  }
});
