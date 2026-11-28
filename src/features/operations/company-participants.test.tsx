import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CompanyParticipantsPanel } from "./company-participants";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("./participant-placement-fields", () => ({
  ParticipantClassPicker: () => null,
}));

const organisationId = "56000000-0000-4000-8000-000000000001";
const roster = [
  {
    user_id: "56000000-0000-4000-8000-000000000002",
    luminovia_user_id: "LUM-DEMO-050",
    display_name: "Mara Müller",
    joined_at: "2026-09-01T08:00:00Z",
    company_reference: "REF-18",
    class_name: "Linux-Team",
    version: 1,
  },
  {
    user_id: "56000000-0000-4000-8000-000000000003",
    luminovia_user_id: "LUM-DEMO-060",
    display_name: "Kim Hoffmann",
    joined_at: "2026-09-01T08:00:00Z",
    company_reference: null,
    class_name: null,
    version: 1,
  },
];
let client: QueryClient;

afterEach(() => {
  cleanup();
  client?.clear();
  rpc.mockReset();
});

async function showRoster(rows = roster) {
  await i18n.changeLanguage("de");
  rpc.mockImplementation(async (name) => ({
    data:
      name === "company_participant_access"
        ? { organisation_id: organisationId, standard_enabled: true }
        : rows,
    error: null,
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CompanyParticipantsPanel actor="owner" organisationId={organisationId} />
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: "Teilnehmende" });
}

it("filters the authorised company roster by its existing fields and clears back to the same list", async () => {
  await showRoster();
  const user = userEvent.setup();
  const search = screen.getByRole("searchbox", { name: /^Teilnehmende nach/ });
  const mara = () => screen.queryByRole("article", { name: "Mara Müller" });
  const kim = () => screen.queryByRole("article", { name: "Kim Hoffmann" });

  for (const term of ["MÜLLER", " lum-demo-050 ", "ref-18", "linux-team"]) {
    await user.clear(search);
    await user.type(search, term);
    expect(mara()).toBeVisible();
    expect(kim()).not.toBeInTheDocument();
  }
  await user.clear(search);
  await user.type(search, "other company");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Keine passenden Einträge.",
  );
  expect(mara()).not.toBeInTheDocument();
  expect(kim()).not.toBeInTheDocument();
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByRole("status")).toHaveTextContent("No matching results.");
  await user.click(
    screen.getByRole("button", { name: "Clear participant search" }),
  );
  expect(search).toHaveFocus();
  expect(search).toHaveValue("");
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(rpc.mock.calls).toEqual([
    ["company_participant_access", { p_organisation_id: organisationId }],
    ["company_participants", { p_organisation_id: organisationId }],
  ]);
});

it("gives an empty company its own state and keeps invitation available", async () => {
  await showRoster([]);
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Noch keine aktiven Teilnehmenden verknüpft.",
  );
  expect(
    screen.getByRole("button", { name: "Teilnehmende Person einladen" }),
  ).toBeVisible();
});
