/** Mocked component/adapter regressions for delivery. Real authentication, PostgreSQL, scanner and browser acceptance are exercised by the separate isolated integration suites. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { TeachingDelivery } from "./delivery";
import { deliveryKeys, type DeliverySession } from "./api";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "teacher" } } }),
}));
const row: DeliverySession = {
  session_id: "d6000000-0000-4000-8000-000000000001",
  claim_id: "d6000000-0000-4000-8000-000000000002",
  job_id: "d6000000-0000-4000-8000-000000000003",
  course_run_id: null,
  title: "Fictional course",
  lecturer_name: "Fictional teacher",
  scheduled_start: "2026-11-01T08:00:00Z",
  scheduled_end: "2026-11-01T09:00:00Z",
  time_zone: "Europe/Berlin",
  status: "missing",
  version: 0,
  draft: null,
  submission: null,
  scheduled_minutes: 60,
  actual_minutes: 0,
  invoice_id: null,
  can_edit: true,
  can_review: false,
  can_customer_confirm: false,
  customer_confirmed: false,
};
function show(item = row) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["permissions", "teacher"], []);
  client.setQueryData(["user-roles", "teacher"], ["lecturer"]);
  client.setQueryData([...deliveryKeys.all("teacher"), "sessions", "own"], {
    pages: [{ items: [item], has_more: false }],
    pageParams: [null],
  });
  client.setQueryData(
    [...deliveryKeys.all("teacher"), "session", item.session_id],
    item,
  );
  client.setQueryData(
    [...deliveryKeys.all("teacher"), "history", item.session_id],
    { submissions: [], events: [] },
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/delivery?session=${item.session_id}`]}>
        <TeachingDelivery />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  await i18n.changeLanguage("de");
});
it("renders persisted own sessions and hides ungranted review/customer controls", () => {
  show();
  expect(
    screen.getByRole("heading", { level: 1, name: "Unterrichtsnachweise" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Tatsächlicher Beginn")).toHaveValue(
    "2026-11-01T09:00",
  );
  expect(
    screen.queryByRole("button", { name: "Leistung bestätigen" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Verwaltungsübersicht" }),
  ).not.toBeInTheDocument();
});
it("keeps an edited draft from submitting stale stored values and requires online confirmation", async () => {
  const user = userEvent.setup();
  show({
    ...row,
    status: "draft",
    version: 1,
    draft: {
      outcome: "completed",
      actual_start: row.scheduled_start,
      actual_end: row.scheduled_end,
      time_zone: row.time_zone,
      notes: "Saved fictional draft",
      correction_reason: "",
    },
  });
  const submit = screen.getByRole("button", {
    name: "Unterrichtsnachweis einreichen",
  });
  expect(submit).toBeEnabled();
  await user.type(
    screen.getByLabelText("Hinweise zur Durchführung"),
    " unsaved change",
  );
  expect(submit).toBeDisabled();
  expect(rpc).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  window.dispatchEvent(new Event("offline"));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Entwurf speichern" }),
    ).toBeDisabled(),
  );
  expect(screen.getByText(/Online-Verbindung erforderlich/)).toBeVisible();
});
it("provides English status, labels and safe correction review without lecturer editing", async () => {
  await i18n.changeLanguage("en");
  show({
    ...row,
    status: "submitted",
    version: 2,
    can_edit: false,
    can_review: true,
    submission: {
      id: "d6000000-0000-4000-8000-000000000004",
      revision: 1,
      outcome: "partial",
      actual_start: row.scheduled_start,
      actual_end: row.scheduled_end,
      time_zone: row.time_zone,
      notes: "Fictional",
      correction_reason: "",
      created_at: row.scheduled_end,
    },
  });
  expect(
    screen.getByRole("heading", { level: 1, name: "Teaching delivery" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Confirm delivery" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Request correction" }),
  ).toBeDisabled();
  expect(screen.queryByLabelText("Actual start")).not.toBeInTheDocument();
  await userEvent.type(
    screen.getByLabelText("Explanation / feedback"),
    "Please clarify the delivery notes",
  );
  expect(
    screen.getByRole("button", { name: "Request correction" }),
  ).toBeEnabled();
});
