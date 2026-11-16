/**
 * Vitest-Regressionen für referenzierte Kursangebote, unveränderte überprüfte Quellen und wiederholbare finanzielle Eingaben. Lokale SDK-/DOM-Fixtures isolieren den Browservertrag; echte Datenbank-/API-Abnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AdminPage } from "./admin";
import i18n from "../../lib/i18n";
import type { CourseRunJobDefaults } from "../operations/building-blocks-api";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  source: {} as CourseRunJobDefaults,
  gross: true,
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "admin-actor" } } }),
}));
vi.mock("../operations/building-blocks", () => ({
  BuildingBlockReference: () => null,
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: mock.rpc,
    from: () => ({
      select: () => ({ order: async () => ({ data: [], error: null }) }),
    }),
  }),
}));
const source: CourseRunJobDefaults = {
  source_revision: "a".repeat(64),
  course_run_id: "e43c039f-f76f-4254-babd-a25b18fe2e69",
  template_id: "fd963f22-537d-4b7e-a9ca-99b1d9cb3f8a",
  building_block_id: null,
  building_block_source_id: null,
  title: "Reviewed course source",
  description: "Trusted course description",
  syllabus: "Trusted syllabus",
  prerequisites: "",
  organisation_id: "675267dc-84ab-4322-8c60-50e3cf39168e",
  customer_name: "Fictional academy",
  delivery_type: "online",
  location: "Fictional classroom",
  time_zone: "Europe/Berlin",
  topic_ids: [],
  sessions: [
    {
      source_course_session_id: "5ce17217-5c4e-4bdf-b76e-4c03d2ab03dd",
      starts_at: "2038-06-07T07:00:00Z",
      ends_at: "2038-06-07T13:00:00Z",
    },
  ],
};
let cache: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("de");
  mock.source = structuredClone(source);
  mock.gross = true;
  mock.rpc
    .mockReset()
    .mockImplementation(
      async (name: string, args?: Record<string, unknown>) => {
        if (name === "get_my_permissions")
          return { data: ["jobs.manage", "courses.manage"], error: null };
        if (name === "commission_access")
          return { data: { can_manage_gross: mock.gross }, error: null };
        if (name === "course_run_job_defaults")
          return { data: mock.source, error: null };
        if (name === "create_course_run_job")
          return (args?.p_payload as Record<string, unknown>)
            .source_revision === mock.source.source_revision
            ? { data: "f4f59e7e-30c4-4599-80c3-f53341f45eb4", error: null }
            : {
                data: null,
                error: { message: "course_run_source_changed", code: "22023" },
              };
        return { data: [], error: null };
      },
    );
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  cache.clear();
});
/** Rendert die zu prüfende Oberfläche mit lokalen Provider-/Routerfixtures und einem isolierten QueryClient. */
function setup() {
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter
        initialEntries={[`/admin?courseRun=${source.course_run_id}`]}
      >
        <AdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("creates a referenced offer from trusted course defaults using only financial terms and one request identity", async () => {
  const user = userEvent.setup();
  setup();
  await screen.findByRole("heading", { name: "Auftrag aus diesem Kurs" });
  expect(screen.getByRole("heading", { name: source.title })).toBeVisible();
  expect(screen.queryByLabelText("Titel")).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText("Konditionen"),
    "Agreed course teaching terms",
  );
  await user.selectOptions(screen.getByLabelText("Einheit"), "fixed_total");
  const total = screen.getByLabelText("Voller Auftragspreis gesamt");
  await user.clear(total);
  await user.type(total, "1000");
  await user.click(screen.getByRole("button", { name: "Stelle speichern" }));
  const link = await screen.findByRole("link", {
    name: "Erstellten Auftrag öffnen",
  });
  expect(link).toHaveAttribute(
    "href",
    "/jobs/f4f59e7e-30c4-4599-80c3-f53341f45eb4",
  );
  const calls = mock.rpc.mock.calls.filter(
    ([name]) => name === "create_course_run_job",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toMatchObject({
    p_course_run_id: source.course_run_id,
    p_platform_percent: 50,
    p_payload: {
      source_revision: source.source_revision,
      gross_amount: 1000,
      gross_total_amount: 1000,
    },
  });
  expect(calls[0][1].p_payload).not.toHaveProperty("sessions");
  expect(calls[0][1].p_payload).not.toHaveProperty("customer_name");
  expect(
    screen.getByRole("button", { name: "Stelle speichern" }),
  ).toBeDisabled();
});

it("retains the reviewed source during background changes and shows a stale-preview rejection without losing fee input", async () => {
  const user = userEvent.setup();
  setup();
  await screen.findByRole("heading", { name: "Auftrag aus diesem Kurs" });
  await user.type(
    screen.getByLabelText("Konditionen"),
    "Reviewed source terms",
  );
  const total = screen.getByLabelText("Voller Auftragspreis gesamt");
  await user.clear(total);
  await user.type(total, "1400");
  mock.source = {
    ...mock.source,
    title: "Changed remotely",
    source_revision: "b".repeat(64),
  };
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: ["operations", "run-job-defaults"],
    });
  });
  expect(screen.getByRole("heading", { name: source.title })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Stelle speichern" }));
  await screen.findByText(
    "Der Kurs wurde seit dieser Vorschau geändert. Prüfe den aktuellen Kurs und öffne sein Auftragsformular erneut.",
  );
  expect(total).toHaveValue(1400);
  expect(
    screen.queryByRole("link", { name: "Erstellten Auftrag öffnen" }),
  ).not.toBeInTheDocument();
  expect(
    mock.rpc.mock.calls.find(([name]) => name === "create_course_run_job")?.[1]
      .p_payload.source_revision,
  ).toBe(source.source_revision);
});

it("keeps fixed-total net offers consistent for management without submitting gross or a null commission parameter", async () => {
  mock.gross = false;
  const user = userEvent.setup();
  setup();
  await screen.findByRole("heading", { name: "Auftrag aus diesem Kurs" });
  await user.type(screen.getByLabelText("Konditionen"), "Management net offer");
  await user.selectOptions(screen.getByLabelText("Einheit"), "fixed_total");
  const total = screen.getByLabelText("Gesamtvergütung");
  await user.clear(total);
  await user.type(total, "750");
  expect(screen.getByLabelText("Honorar")).toHaveValue(750);
  await user.click(screen.getByRole("button", { name: "Stelle speichern" }));
  await waitFor(() =>
    expect(
      mock.rpc.mock.calls.some(([name]) => name === "create_course_run_job"),
    ).toBe(true),
  );
  const args = mock.rpc.mock.calls.find(
    ([name]) => name === "create_course_run_job",
  )![1];
  expect(args.p_platform_percent).toBe(50);
  expect(args.p_payload).toMatchObject({ amount: 750, total_amount: 750 });
  expect(args.p_payload).not.toHaveProperty("gross_amount");
});
