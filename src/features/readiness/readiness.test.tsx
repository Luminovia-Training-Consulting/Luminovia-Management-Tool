import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CourseReadinessPage, DashboardReadinessWidget } from "./readiness";
import type { CourseReadiness } from "./api";
const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "e8000000-0000-4000-8000-000000000002" } },
  }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
const run = "e8000000-0000-4000-8000-000000000010",
  teacher = "e8000000-0000-4000-8000-000000000002",
  task = "e8000000-0000-4000-8000-000000000011";
function course(): CourseReadiness {
  return {
    id: run,
    title: "Fictional readiness course <script>literal</script>",
    organisation_name: "Fictional organisation",
    time_zone: "Europe/Berlin",
    delivery_type: "online",
    venue: "",
    meeting_url: "https://meeting.example.invalid/course",
    starts_at: "2039-01-01T08:00:00Z",
    ends_at: "2039-01-02T09:00:00Z",
    status: "attention_required",
    percentage: 75,
    applicable_count: 4,
    completed_count: 3,
    can_manage: true,
    can_acknowledge: true,
    settings: {
      version: 3,
      materials_required: false,
      customer_required: false,
      contact_required: false,
      agreement_required: false,
      instructions_required: true,
      instructions: "Fictional authored <script> text",
      instruction_version: 4,
      meeting_url: "https://meeting.example.invalid/course",
      preparation_deadline: null,
      sessions_confirmed: true,
    },
    checks: [
      {
        code: "instructions",
        applicable: true,
        complete: false,
        blocking: false,
        responsible: "lecturer",
        href: null,
      },
      {
        code: "materials",
        applicable: false,
        complete: false,
        blocking: false,
        responsible: "management",
        href: "/files",
      },
    ],
    tasks: [],
    lecturers: [
      { id: teacher, display_name: "Fictional teacher", acknowledged: false },
    ],
    responsible_people: [{ id: teacher, display_name: "Fictional teacher" }],
    documents: [],
    jobs: [],
    as_of: "2026-11-16T04:00:00Z",
  };
}
let data: CourseReadiness[];
const clients: QueryClient[] = [];
function response(value: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data: value, error }), {
    abortSignal() {
      return this;
    },
  });
}
function mount(path = `/readiness/${run}`, widget = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {widget ? (
          <DashboardReadinessWidget actor={teacher} />
        ) : (
          <Routes>
            <Route path="/readiness" element={<CourseReadinessPage />} />
            <Route path="/readiness/:id" element={<CourseReadinessPage />} />
          </Routes>
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  data = [course()];
  state.online = true;
  state.rpc.mockReset();
  state.rpc.mockImplementation((name) =>
    response(name === "course_readiness" ? structuredClone(data) : run),
  );
  await i18n.changeLanguage("de");
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
it("renders derived requirements as literal authored text and excludes inapplicable failures", async () => {
  const { container } = mount();
  expect(
    await screen.findByRole("heading", { name: data[0].title }),
  ).toBeVisible();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText("75 % bereit")).toBeVisible();
  expect(screen.getByText("Nicht erforderlich", { exact: true })).toBeVisible();
  expect(
    screen.getByText(data[0].settings.instructions, { exact: true }),
  ).toBeVisible();
  expect(state.rpc).toHaveBeenCalledWith("course_readiness", {
    p_course_run_id: run,
  });
  expect(screen.getByRole("link", { name: "Meeting öffnen" })).toHaveAttribute(
    "href",
    data[0].meeting_url,
  );
});
it("submits only the displayed instruction version and awaits a confirmed server mutation", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByRole("button", {
    name: "Diese Version gelesen und verstanden",
  });
  state.rpc.mockImplementation((name) => {
    if (name === "acknowledge_course_instructions") {
      data[0].lecturers[0].acknowledged = true;
      return response(run);
    }
    return response(structuredClone(data));
  });
  await user.click(
    screen.getByRole("button", {
      name: "Diese Version gelesen und verstanden",
    }),
  );
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith("acknowledge_course_instructions", {
      p_course_run_id: run,
      p_instruction_version: 4,
      p_request_id: expect.any(String),
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", {
        name: "Diese Version gelesen und verstanden",
      }),
    ).not.toBeInTheDocument(),
  );
});
it("a denied refresh removes retained private preparation instead of showing stale records", async () => {
  mount();
  await screen.findByText(data[0].settings.instructions, { exact: true });
  state.rpc.mockReturnValue(
    response(null, { code: "42501", message: "Access revoked" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Aktualisieren" }));
  await waitFor(() =>
    expect(
      screen.queryByText(data[0].settings.instructions, { exact: true }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("alert")).toBeVisible();
});
it("keeps an edited settings draft through language switching and converts its named time zone", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Konfiguration bearbeiten" }),
  );
  await user.clear(screen.getByRole("textbox", { name: "Kurshinweise" }));
  await user.type(
    screen.getByRole("textbox", { name: "Kurshinweise" }),
    "Fictional new authored instructions",
  );
  await user.type(
    screen.getByLabelText("Vorbereitungsfrist", { exact: true }),
    "2039-01-01T09:00",
  );
  await act(() => i18n.changeLanguage("en"));
  expect(
    screen.getByRole("textbox", { name: "Course instructions" }),
  ).toHaveValue("Fictional new authored instructions");
  await user.click(screen.getByRole("button", { name: "Save online" }));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "save_readiness_settings",
      expect.objectContaining({
        p_course_run_id: run,
        p_expected_version: 3,
        p_payload: expect.objectContaining({
          instructions: "Fictional new authored instructions",
          preparation_deadline: "2039-01-01T08:00:00.000Z",
        }),
      }),
    ),
  );
});
it("reuses the task creation request on an uncertain response instead of duplicating a task", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Aufgabe hinzufügen" }),
  );
  await user.type(
    screen.getByLabelText("Aufgabe", { exact: true }),
    "Fictional scoped task",
  );
  state.rpc.mockImplementation((name) =>
    name === "save_readiness_task"
      ? response(null, { message: "Uncertain network response" })
      : response(structuredClone(data)),
  );
  await user.click(screen.getByRole("button", { name: "Online speichern" }));
  await screen.findByText(/Die Änderung wurde nicht bestätigt/);
  await user.click(screen.getByRole("button", { name: "Online speichern" }));
  await waitFor(() =>
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "save_readiness_task"),
    ).toHaveLength(2),
  );
  const writes = state.rpc.mock.calls.filter(
    ([name]) => name === "save_readiness_task",
  );
  expect(writes[0][1].p_request_id).toBe(writes[1][1].p_request_id);
  expect(writes[0][1].p_payload).toEqual({
    title: "Fictional scoped task",
    responsible_user_id: teacher,
    required: true,
    due_at: null,
    archived: false,
  });
});
it("completes only a versioned permitted task and does not optimistically show completion", async () => {
  data[0].tasks = [
    {
      id: task,
      title: "Fictional assigned task",
      required: true,
      responsible_user_id: teacher,
      responsible_name: "Fictional teacher",
      due_at: null,
      completed_at: null,
      version: 8,
      can_complete: true,
    },
  ];
  mount();
  state.rpc.mockImplementation((name) =>
    name === "complete_readiness_task"
      ? response(null, { code: "40001", message: "stale" })
      : response(structuredClone(data)),
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Als erledigt bestätigen",
    }),
  );
  await screen.findByText(/Die Daten wurden zwischenzeitlich geändert/);
  expect(state.rpc).toHaveBeenCalledWith("complete_readiness_task", {
    p_task_id: task,
    p_completed: true,
    p_expected_version: 8,
    p_request_id: expect.any(String),
  });
  expect(
    screen.queryByRole("button", { name: "Erledigung zurücknehmen" }),
  ).not.toBeInTheDocument();
});
it("does not expose management controls to an assigned lecturer and disables online actions offline", async () => {
  data[0].can_manage = false;
  state.online = false;
  mount();
  await screen.findByRole("heading", { name: data[0].title });
  expect(
    screen.queryByRole("button", { name: "Konfiguration bearbeiten" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Aufgabe hinzufügen" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: "Diese Version gelesen und verstanden",
    }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeDisabled();
  expect(screen.getByText(/Du bist offline/)).toBeVisible();
});
it("filters the overview and offers honest empty and no-match states in both languages", async () => {
  mount("/readiness");
  await screen.findByRole("link", { name: data[0].title });
  await userEvent.selectOptions(
    screen.getByLabelText("Status filtern"),
    "ready",
  );
  expect(
    screen.getByText("Keine Kurse entsprechen diesen Filtern."),
  ).toBeVisible();
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByLabelText("Filter by status")).toHaveValue("ready");
  expect(screen.getByText("No courses match these filters.")).toBeVisible();
});
it("rejects invalid destinations and unsafe meeting links returned by malformed API data", async () => {
  data[0].meeting_url = "javascript:alert(1)";
  mount();
  await screen.findByRole("heading", { name: data[0].title });
  expect(
    screen.queryByRole("link", { name: "Meeting öffnen" }),
  ).not.toBeInTheDocument();
  data[0].checks[0].href = "//evil.example.invalid";
  await userEvent.click(screen.getByRole("button", { name: "Aktualisieren" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: data[0].title }),
    ).not.toBeInTheDocument(),
  );
});
it("the dashboard shares the live readiness projection and links to actual detail routes", async () => {
  mount("/readiness", true);
  expect(
    await screen.findByText("1 Kurse brauchen Vorbereitung"),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: data[0].title })).toHaveAttribute(
    "href",
    `/readiness/${run}`,
  );
  expect(state.rpc).toHaveBeenCalledWith("course_readiness", {
    p_course_run_id: null,
  });
});
