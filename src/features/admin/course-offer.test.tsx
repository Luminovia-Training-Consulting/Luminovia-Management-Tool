/**
 * Regressions for referenced course offers, stable reviewed sources and retryable financial
 * inputs. SDK/DOM fixtures isolate the form; actual server/data acceptance remains separate.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
  scopedPricing: false,
  preview: {
    version: 3,
    audience: "marketplace",
    eligible: true,
    billable: true,
    ready: true,
  },
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "admin-actor" } } }),
}));
vi.mock("../operations/building-blocks", () => ({
  BuildingBlockReference: () => null,
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: (name: string, args?: Record<string, unknown>) => {
      const response = mock.rpc(name, args);
      return Object.assign(response, { abortSignal: () => response });
    },
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
  mock.scopedPricing = false;
  mock.preview = {
    version: 3,
    audience: "marketplace",
    eligible: true,
    billable: true,
    ready: true,
  };
  mock.rpc
    .mockReset()
    .mockImplementation(
      async (name: string, args?: Record<string, unknown>) => {
        if (name === "get_my_permissions")
          return { data: ["jobs.manage", "courses.manage"], error: null };
        if (name === "commission_access")
          return {
            data: {
              can_manage_gross: mock.gross,
              can_manage_own_course_pricing: mock.scopedPricing,
              ...(mock.gross
                ? {
                    regular_lecturer_percent: 31,
                    senior_lecturer_percent: 73,
                    policy_configured: true,
                    policy_version: 1,
                  }
                : {}),
            },
            error: null,
          };
        if (name === "course_offer_publication_preview")
          return { data: mock.preview, error: null };
        if (name === "job_lifecycle")
          return { data: { version: 3, claims: [] }, error: null };
        if (name === "manage_job_offer")
          return { data: args?.p_job_id, error: null };
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

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
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

it("creates two per-position allocations sharing the trusted schedule and a single request identity", async () => {
  const user = userEvent.setup();
  setup();
  await screen.findByRole("heading", { name: "Auftrag aus diesem Kurs" });
  expect(screen.getByRole("heading", { name: source.title })).toBeVisible();
  const title = screen.getByLabelText("Titel der Stellenanzeige");
  const description = screen.getByLabelText("Beschreibung der Stellenanzeige");
  expect(title).toHaveValue(source.title);
  expect(description).toHaveValue(source.description);
  await user.clear(title);
  await user.type(title, "Fictional listing title");
  await user.clear(description);
  await user.type(description, "Fictional listing copy");
  const positions = screen.getByRole("spinbutton", {
    name: "Dozierendenplätze",
  });
  await user.clear(positions);
  await user.type(positions, "2");
  await user.type(
    screen.getByLabelText("Konditionen (optional)"),
    "Agreed course teaching terms",
  );
  await user.selectOptions(screen.getByLabelText("Einheit"), "fixed_total");
  await user.selectOptions(screen.getByLabelText("Währung"), "USD");
  const total = screen.getByLabelText("Voller Auftragspreis gesamt");
  await user.clear(total);
  await user.type(total, "1000");
  let finishRefresh!: () => void;
  const refresh = new Promise<void>((resolve) => {
    finishRefresh = resolve;
  });
  const invalidation = vi
    .spyOn(cache, "invalidateQueries")
    .mockReturnValue(refresh);
  try {
    await user.click(
      screen.getByRole("button", { name: "Als Entwurf speichern" }),
    );
    expect(
      await screen.findByText(/Als Entwurf gespeichert\. Du kannst/),
    ).toBeVisible();
    const link = screen.getByRole("link", {
      name: "Entwurf öffnen",
    });
    expect(link).toHaveAttribute(
      "href",
      "/jobs/f4f59e7e-30c4-4599-80c3-f53341f45eb4",
    );
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["job-board"] });
  } finally {
    invalidation.mockRestore();
    finishRefresh();
  }
  const calls = mock.rpc.mock.calls.filter(
    ([name]) => name === "create_course_run_job",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toMatchObject({
    p_course_run_id: source.course_run_id,
    p_payload: {
      source_revision: source.source_revision,
      title: "Fictional listing title",
      description: "Fictional listing copy",
      status: "draft",
      gross_amount: 1000,
      gross_total_amount: 1000,
      currency: "USD",
      capacity: 2,
    },
  });
  expect(calls[0][1].p_payload).not.toHaveProperty("sessions");
  expect(calls[0][1]).not.toHaveProperty("p_platform_percent");
  expect(calls[0][1].p_payload).not.toHaveProperty("customer_name");
  expect(
    screen.queryByRole("button", { name: "Als Entwurf speichern" }),
  ).not.toBeInTheDocument();
});

it("retains the reviewed source during background changes and shows a stale-preview rejection without losing fee input", async () => {
  const user = userEvent.setup();
  setup();
  await screen.findByRole("heading", { name: "Auftrag aus diesem Kurs" });
  await user.type(
    screen.getByLabelText("Konditionen (optional)"),
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
  await user.click(
    screen.getByRole("button", { name: "Als Entwurf speichern" }),
  );
  await screen.findByText(
    "Der Kurs wurde seit dieser Vorschau geändert. Prüfe den aktuellen Kurs und öffne sein Auftragsformular erneut.",
  );
  expect(total).toHaveValue(1400);
  expect(
    screen.queryByRole("link", { name: "Entwurf öffnen" }),
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
  await user.type(
    screen.getByLabelText("Konditionen (optional)"),
    "Management net offer",
  );
  await user.selectOptions(screen.getByLabelText("Einheit"), "fixed_total");
  const total = screen.getByLabelText("Gesamtvergütung");
  await user.clear(total);
  await user.type(total, "750");
  expect(screen.getByLabelText("Honorar")).toHaveValue(750);
  expect(
    screen.queryByLabelText(/Plattformanteil für diesen Auftrag/),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Als Entwurf speichern" }),
  );
  await waitFor(() =>
    expect(
      mock.rpc.mock.calls.some(([name]) => name === "create_course_run_job"),
    ).toBe(true),
  );
  const args = mock.rpc.mock.calls.find(
    ([name]) => name === "create_course_run_job",
  )![1];
  expect(args).not.toHaveProperty("p_platform_percent");
  expect(args.p_payload).toMatchObject({ amount: 750, total_amount: 750 });
  expect(args.p_payload).not.toHaveProperty("gross_amount");
  expect(args.p_payload).not.toHaveProperty("capacity");
});

it("saves a scoped management override and previews the lecturer fee and platform share", async () => {
  mock.gross = false;
  mock.scopedPricing = true;
  const user = userEvent.setup();
  setup();
  await screen.findByRole("heading", { name: "Auftrag aus diesem Kurs" });
  const rate = screen.getByRole("spinbutton", {
    name: "Plattformanteil für diesen Auftrag (%)",
  });
  await user.type(rate, "32.25");
  await user.selectOptions(screen.getByLabelText("Einheit"), "fixed_total");
  const gross = screen.getByLabelText("Voller Auftragspreis gesamt");
  await user.clear(gross);
  await user.type(gross, "1000");
  expect(screen.getByText(/677,50/)).toBeVisible();
  expect(screen.getByText(/322,50/)).toBeVisible();
  expect(screen.queryByText(/Standardanteil/)).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText("Konditionen (optional)"),
    "Explicit course terms",
  );
  await user.click(
    screen.getByRole("button", { name: "Als Entwurf speichern" }),
  );
  await screen.findByText(/Als Entwurf gespeichert\. Du kannst/);
  expect(mock.rpc).toHaveBeenCalledWith(
    "create_course_run_job",
    expect.objectContaining({
      p_platform_percent: 32.25,
      p_payload: expect.objectContaining({
        gross_amount: 1000,
        gross_total_amount: 1000,
      }),
    }),
  );
});

it("reviews a saved offer before publication and uses a fresh save key for a second offer", async () => {
  const user = userEvent.setup();
  setup();
  for (let attempt = 0; attempt < 2; attempt++) {
    await user.click(
      await screen.findByRole("button", {
        name: "Speichern und Ausschreibung prüfen",
      }),
    );
    await screen.findByRole("dialog", { name: "Ausschreibung prüfen" });
    await user.click(
      await screen.findByRole("button", {
        name: "In der Stellenbörse veröffentlichen",
      }),
    );
    await screen.findByText("Auftrag in der Stellenbörse veröffentlicht.");
    if (attempt === 0) {
      await user.click(
        screen.getByRole("button", {
          name: "Weiteren Auftrag für diesen Kurs erstellen",
        }),
      );
    }
  }
  const calls = mock.rpc.mock.calls.filter(
    ([name]) => name === "create_course_run_job",
  );
  expect(calls).toHaveLength(2);
  expect(calls[0][1].p_payload).toMatchObject({ terms: "", status: "draft" });
  expect(calls[1][1].p_client_id).not.toBe(calls[0][1].p_client_id);
});

it("saves a roster-only draft without prices and requires reviewing its eligibility", async () => {
  const user = userEvent.setup();
  mock.source.has_company_lecturers = true;
  mock.preview = {
    version: 8,
    audience: "company",
    eligible: false,
    billable: false,
    ready: true,
  };
  setup();
  await user.click(
    await screen.findByRole("checkbox", {
      name: "Nur für eigene Dozierende ausschreiben",
    }),
  );
  expect(
    screen.queryByLabelText("Voller Auftragspreis gesamt"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Gültiger Rahmenvertrag erforderlich"),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Speichern und Ausschreibung prüfen" }),
  );
  await screen.findByText(/Aktuell erfüllt keine Lehrkraft/);
  expect(
    screen.getByText("Kein Honorar und keine Rechnung im Portal"),
  ).toBeVisible();
  const create = mock.rpc.mock.calls.find(
    ([name]) => name === "create_course_run_job",
  )?.[1];
  expect(create?.p_payload).toMatchObject({
    own_lecturers_only: true,
    status: "draft",
  });
  expect(create?.p_payload).not.toHaveProperty("gross_amount");
  expect(create?.p_payload).not.toHaveProperty("requires_contract");
  expect(
    mock.rpc.mock.calls.some(([name]) => name === "manage_job_offer"),
  ).toBe(false);
  await user.click(
    screen.getByRole("button", {
      name: "Interne Ausschreibung veröffentlichen",
    }),
  );
  await screen.findByText("Interne Ausschreibung veröffentlicht.");
  expect(mock.rpc).toHaveBeenCalledWith(
    "manage_job_offer",
    expect.objectContaining({ p_expected_version: 8 }),
  );
});

it("opens the existing draft when another tab saved it first", async () => {
  const respond = mock.rpc.getMockImplementation()!;
  const draft = "f4f59e7e-30c4-4599-80c3-f53341f45eb4";
  mock.rpc.mockImplementation((name, args) =>
    name === "create_course_run_job"
      ? Promise.resolve({
          data: null,
          error: {
            message: "course_run_draft_exists",
            code: "23505",
            details: draft,
          },
        })
      : respond(name, args),
  );
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Als Entwurf speichern" }),
  );
  expect(
    await screen.findByRole("link", { name: "Entwurf öffnen" }),
  ).toHaveAttribute("href", `/jobs/${draft}`);
});

it("publishes the saved draft using its ID and version without creating another offer", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(
    await screen.findByRole("button", { name: "Als Entwurf speichern" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Ausschreibung prüfen" }),
  );
  await user.click(
    await screen.findByRole("button", {
      name: "In der Stellenbörse veröffentlichen",
    }),
  );
  await screen.findByText("Auftrag in der Stellenbörse veröffentlicht.");
  expect(
    mock.rpc.mock.calls.filter(([name]) => name === "create_course_run_job"),
  ).toHaveLength(1);
  expect(mock.rpc).toHaveBeenCalledWith(
    "manage_job_offer",
    expect.objectContaining({
      p_job_id: "f4f59e7e-30c4-4599-80c3-f53341f45eb4",
      p_action: "published",
      p_expected_version: 3,
      p_payload: {},
    }),
  );
});
