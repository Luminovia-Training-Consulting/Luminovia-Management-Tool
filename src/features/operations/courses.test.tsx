/**
 * Protect actual course forms against timestamp truncation and false saves.
 * Fictional rows and controlled transport replies isolate the UI contract;
 * real database authorization and native/browser acceptance remain separate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import type { Topic } from "../../lib/types";
import { CoursesPage } from "./courses";
import type { ChangeCandidate } from "../changes/api";
import type { JobLifecycle } from "../jobs/lifecycle-api";
import {
  runsQuery,
  type BuildingBlock,
  type CourseRun,
  type Organisation,
  type Template,
} from "./data";

// Each cache belongs to a fictional manager; no service or account is contacted.
const actor = "fictional-course-manager";
const templateId = "c1000000-0000-4000-8000-000000000001";
const runId = "c2000000-0000-4000-8000-000000000001";
const jobId = "c2100000-0000-4000-8000-000000000001";
const claimId = "c2200000-0000-4000-8000-000000000001";
const companyId = "c2300000-0000-4000-8000-000000000001";
const job = { id: jobId, title: "Fictional active order", status: "published" };
const organisation: Organisation = {
  id: companyId,
  name: "Fictional company",
  country: null,
  time_zone: "Europe/Berlin",
  industry: "",
  city: "",
  tags: [],
  archived_at: null,
};
const protectedLifecycle: JobLifecycle = {
  version: 4,
  can_manage: true,
  can_edit: false,
  can_duplicate: true,
  claims: [],
};
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  accountRequest: vi.fn(),
  from: vi.fn(),
  online: true,
  tables: {} as Record<string, unknown[]>,
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-course-manager" } } }),
}));
vi.mock("../accounts/api", () => ({ accountRequest: state.accountRequest }));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ rpc: state.rpc, from: state.from }),
}));

const template: Template = {
  id: templateId,
  title: "Fictional Linux course",
  description: "Authored course description",
  syllabus: "Processes and files",
  prerequisites: "Basic shell use",
  archived_at: null,
  building_block_id: null,
  building_block_source_id: null,
  course_template_topics: [],
};
const run: CourseRun = {
  id: runId,
  template_id: templateId,
  organisation_id: null,
  time_zone: "Europe/Berlin",
  delivery_type: "online",
  venue: "Fictional classroom",
  published: false,
  archived_at: null,
  course_sessions: [
    {
      id: "c3000000-0000-4000-8000-000000000001",
      starts_at: "2030-04-01T07:00:00.000Z",
      ends_at: "2030-04-01T08:00:00.000Z",
    },
  ],
};
const clients: QueryClient[] = [];

/** Mount the production page with actor-scoped query data and real form/dialog state. */
function renderCourses({
  permissions = ["courses.manage"],
  templates = [template],
  runs = [] as CourseRun[],
  blocks = [] as BuildingBlock[],
  topics = [] as Topic[],
  organisations = [] as Organisation[],
  lifecycle = protectedLifecycle,
  changeCandidates = [] as ChangeCandidate[],
} = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  state.tables = {
    course_templates: templates,
    course_runs: runs,
    organisations,
    building_blocks: blocks,
    topics,
  };
  for (const [name, value] of [
    ["templates", templates],
    ["runs", runs],
    ["organisations", organisations],
    ["building-blocks", blocks],
  ] as const)
    client.setQueryData(["operations", name, actor], value);
  client.setQueryData(["permissions", actor], permissions);
  client.setQueryData(["topics"], topics);
  for (const run of runs)
    for (const job of run.jobs ?? [])
      client.setQueryData(["job-lifecycle", actor, job.id], lifecycle);
  client.setQueryData(["changeable-assignments", actor], changeCandidates);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CoursesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** Open a genuine new-run dialog through its visible management control. */
async function newRun(useExistingTemplate = true) {
  await userEvent.click(screen.getByRole("button", { name: "Kurs anlegen" }));
  const dialog = screen.getByRole("dialog", { name: "Kurs anlegen" });
  if (useExistingTemplate)
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Kursvorlage"),
      templateId,
    );
  return dialog;
}

/** Change only the requested row's minute inputs, keeping React Hook Form ownership. */
function interval(dialog: HTMLElement, start: string, end: string, index = 1) {
  fireEvent.change(
    within(dialog).getByLabelText(`Beginn ${index}`, { exact: true }),
    {
      target: { value: start },
    },
  );
  fireEvent.change(
    within(dialog).getByLabelText(`Ende ${index}`, { exact: true }),
    {
      target: { value: end },
    },
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("de");
  state.online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => state.online);
  state.rpc.mockReset();
  state.rpc.mockImplementation((name: string) => {
    if (name === "job_lifecycle")
      return {
        abortSignal: async () => ({ data: protectedLifecycle, error: null }),
      };
    if (name === "changeable_assignments")
      return { abortSignal: async () => ({ data: [], error: null }) };
    return Promise.resolve({ data: runId, error: null });
  });
  state.accountRequest.mockReset().mockImplementation(async (path: string) => {
    if (path === "deletions/access") return { can_admin: false, kinds: [] };
    if (path === "deletions/operations") return { items: [] };
    throw new Error("Unexpected account request");
  });
  state.from.mockReset();
  state.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      order: () => query,
      range: (from: number, to: number) => ({
        abortSignal: async () => ({
          data: structuredClone(
            (state.tables[table] ?? []).slice(from, to + 1),
          ),
          error: null,
        }),
      }),
    };
    return query;
  });
});

afterEach(() => {
  // Release observers and the online-state override; no retries survive a case.
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

it("filters the visible course list by time without requiring administrative permission", async () => {
  const user = userEvent.setup();
  const now = Date.now();
  const span = (before: number, after: number) => [
    {
      id: run.course_sessions[0].id,
      starts_at: new Date(now + before * 60_000).toISOString(),
      ends_at: new Date(now + after * 60_000).toISOString(),
    },
  ];
  const fixtures = [
    { title: "Fictional ongoing course", sessions: span(-10, 10) },
    { title: "Fictional upcoming course", sessions: span(10, 20) },
    { title: "Fictional past course", sessions: span(-20, -10) },
  ];
  renderCourses({
    permissions: [],
    templates: fixtures.map(({ title }, index) => ({
      ...template,
      id: `template-${index}`,
      title,
    })),
    runs: fixtures.map(({ sessions }, index) => ({
      ...run,
      id: `run-${index}`,
      template_id: `template-${index}`,
      course_sessions: sessions,
    })),
  });

  const period = await screen.findByRole("combobox", {
    name: "Kurse nach Zeitraum filtern",
  });
  expect(screen.getByRole("link", { name: "Meine Kurse" })).toHaveAttribute(
    "href",
    "/learning",
  );
  for (const [index, option] of [
    "current",
    "upcoming",
    "completed",
  ].entries()) {
    await user.selectOptions(period, option);
    expect(
      screen.getByRole("heading", { name: fixtures[index].title }),
    ).toBeVisible();
    for (const [other, fixture] of fixtures.entries()) {
      if (other !== index)
        expect(
          screen.queryByRole("heading", { name: fixture.title }),
        ).toBeNull();
    }
  }
});

it("explains the catalogue tabs and the Linux example where the user plans a run", async () => {
  const user = userEvent.setup();
  renderCourses({
    blocks: [
      {
        id: "fictional-linux-block",
        provider: "Fictional",
        code: "LINUX-DEMO",
        title: "Fictional Linux block",
        description: "Shell practice",
        syllabus: "Commands and permissions",
        prerequisites: "",
        duration_days: 1,
        duration_hours: 7,
        theory_percent: null,
        practice_percent: null,
        notes: "",
        default_template_id: templateId,
        building_block_sources: [],
      },
    ],
  });
  await user.click(
    screen.getByText(
      "Wie hängen Durchführungen, Vorlagen und Kursbausteine zusammen?",
    ),
  );
  expect(screen.getByText("Beispiel „Linux – Praxistag“")).toBeVisible();
  expect(
    screen.getByText(/Hier stehen konkrete Kurse mit Terminen/),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Vorlagen" }));
  expect(
    screen.getByText(/Hier speicherst du wiederverwendbare Kursinhalte/),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Kursbausteine" }));
  expect(
    screen.getByText(/Hier findest du vorbereitete Inhalte mit Quellenangaben/),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Durchführung planen: LINUX-DEMO" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Kurs anlegen" });
  expect(within(dialog).getByLabelText("Kursvorlage")).toHaveValue(templateId);
});

it("opens the exact course schedule from a blocked deletion and focuses its dates", async () => {
  const user = userEvent.setup();
  state.accountRequest.mockImplementation(async (path: string) => {
    if (path === "deletions/access")
      return { can_admin: true, kinds: ["course_run"] };
    if (path === "deletions/operations") return { items: [] };
    if (path === "deletions/preview")
      return {
        plan_id: "fictional-preview",
        kind: "course_run",
        id: runId,
        label: template.title,
        counts: { "public.course_runs": 1 },
        blockers: [
          { code: "referenced", kind: "public.course_sessions", count: 1 },
        ],
        can_confirm: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    throw new Error("Deletion must stay blocked");
  });
  renderCourses({ runs: [{ ...run, published: true }] });
  await user.click(
    await screen.findByRole("button", {
      name: `Endgültig löschen: ${template.title}`,
    }),
  );
  expect(await screen.findByText(/Löschung derzeit gesperrt/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Jetzt unwiderruflich löschen" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Zu den Kursterminen" }));
  const editor = within(
    await screen.findByRole("dialog", { name: "Bearbeiten" }),
  );
  const dates = editor.getByRole("group", { name: "Termine" });
  await waitFor(() => expect(dates).toHaveFocus());
  expect(within(dates).getByLabelText("Beginn 1")).toHaveValue(
    "2030-04-01T09:00",
  );
  expect(state.rpc).not.toHaveBeenCalledWith(
    "save_course_run",
    expect.anything(),
  );
});

it("saves only reusable fields from the shared form without requiring dates", async () => {
  const topics = [
    {
      id: "c4000000-0000-4000-8000-000000000001",
      kind: "topic",
      label_de: "Netzwerke",
      label_en: "Networks",
    },
    {
      id: "c4000000-0000-4000-8000-000000000002",
      kind: "tool",
      label_de: "Wireshark",
      label_en: "Wireshark",
    },
    {
      id: "c4000000-0000-4000-8000-000000000003",
      kind: "language",
      label_de: "Python",
      label_en: "Python",
    },
  ];
  renderCourses({ templates: [], topics });
  const dialog = await newRun(false);
  for (const [name, topic] of [
    ["Themen", topics[0]],
    ["Tools", topics[1]],
    ["Programmiersprachen", topics[2]],
  ] as const) {
    const group = within(dialog).getByRole("group", { name });
    await userEvent.click(
      within(group).getByRole("checkbox", { name: topic.label_de }),
    );
  }
  await userEvent.type(
    within(dialog).getByLabelText("Titel", { exact: true }),
    "Fictional spreadsheet",
  );
  await userEvent.type(
    within(dialog).getByLabelText("Ort / Zugangslink"),
    "Private classroom",
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Als Vorlage speichern" }),
  );
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(state.rpc.mock.calls).toEqual([
    [
      "save_course_template",
      {
        p_id: null,
        p_payload: {
          title: "Fictional spreadsheet",
          description: "",
          syllabus: "",
          prerequisites: "",
          topic_ids: topics.map((topic) => topic.id),
          archived: false,
        },
      },
    ],
  ]);
});

it("publishes a new run with its confirmed reusable content and retries a failed run without duplicating the template", async () => {
  renderCourses({ templates: [] });
  state.rpc
    .mockResolvedValueOnce({ data: templateId, error: null })
    .mockResolvedValueOnce({
      data: null,
      error: new Error("temporary run failure"),
    })
    .mockResolvedValueOnce({ data: runId, error: null });
  const dialog = await newRun(false);
  await userEvent.type(
    within(dialog).getByLabelText("Titel", { exact: true }),
    "Fictional training",
  );
  interval(dialog, "2030-04-01T09:00", "2030-04-01T10:00");
  const publish = within(dialog).getByRole("button", {
    name: /^Veröffentlichen$/,
  });
  await userEvent.click(publish);
  await within(dialog).findByText(
    /Die Kursinhalte wurden als Vorlage gespeichert/,
  );
  await userEvent.click(publish);
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(state.rpc.mock.calls.map(([name]) => name)).toEqual([
    "save_course_template",
    "save_course_run",
    "save_course_run",
  ]);
  expect(state.rpc.mock.calls[2][1]).toMatchObject({
    p_id: null,
    p_payload: { template_id: templateId, published: true },
  });
});

describe("course form failure and confirmation boundaries", () => {
  it.each([
    ["nonexistent Berlin time", "2030-03-31T02:30", "2030-03-31T04:00"],
    ["ambiguous Berlin time", "2030-10-27T02:30", "2030-10-27T04:00"],
    ["reversed interval", "2030-04-01T11:00", "2030-04-01T10:00"],
    ["zero-length interval", "2030-04-01T11:00", "2030-04-01T11:00"],
  ])(
    "refuses %s before sending any course mutation",
    async (_name, start, end) => {
      renderCourses();
      const dialog = await newRun();
      interval(dialog, start, end);
      await userEvent.click(
        within(dialog).getByRole("button", {
          name: /^(Speichern|Entwurf speichern)$/,
        }),
      );
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "Beginn und Ende müssen eindeutig sein.",
      );
      expect(
        within(dialog).getByLabelText("Beginn 1", { exact: true }),
      ).toHaveValue(start);
      expect(
        within(dialog).getByLabelText("Ende 1", { exact: true }),
      ).toHaveValue(end);
      expect(
        screen.queryByText("Gespeichert.", { exact: true }),
      ).not.toBeInTheDocument();
      expect(state.rpc).not.toHaveBeenCalled();
    },
  );

  it("validates every session before submitting an all-or-nothing run", async () => {
    renderCourses();
    const dialog = await newRun();
    interval(dialog, "2030-03-30T09:00", "2030-03-30T10:00");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Termin ergänzen" }),
    );
    interval(dialog, "2030-03-31T02:30", "2030-03-31T04:00", 2);
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await within(dialog).findByRole("alert");
    expect(state.rpc).not.toHaveBeenCalled();
    expect(
      within(dialog).getByLabelText("Beginn 1", { exact: true }),
    ).toHaveValue("2030-03-30T09:00");
    interval(dialog, "2030-04-01T09:00", "2030-04-01T10:00", 2);
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("save_course_run", {
      p_id: null,
      p_payload: {
        template_id: templateId,
        organisation_id: "",
        time_zone: "Europe/Berlin",
        delivery_type: "online",
        venue: "",
        published: false,
        archived: false,
        sessions: [
          {
            starts_at: "2030-03-30T08:00:00.000Z",
            ends_at: "2030-03-30T09:00:00.000Z",
          },
          {
            starts_at: "2030-04-01T07:00:00.000Z",
            ends_at: "2030-04-01T08:00:00.000Z",
          },
        ],
      },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("preserves already entered instants when the draft zone is changed", async () => {
    renderCourses();
    const editor = await newRun();
    const dialog = within(editor);
    interval(editor, "2030-04-01T09:00", "2030-04-01T10:00");
    await userEvent.selectOptions(dialog.getByLabelText("Zeitzone"), "UTC");
    expect(dialog.getByLabelText("Beginn 1")).toHaveValue("2030-04-01T07:00");
    expect(dialog.getByLabelText("Ende 1")).toHaveValue("2030-04-01T08:00");
    await userEvent.click(
      dialog.getByRole("button", { name: "Entwurf speichern" }),
    );
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: null,
      p_payload: expect.objectContaining({
        time_zone: "UTC",
        sessions: [
          {
            starts_at: "2030-04-01T07:00:00.000Z",
            ends_at: "2030-04-01T08:00:00.000Z",
          },
        ],
      }),
    });
  });

  it("marks the missing session endpoint without falsely confirming a saved course", async () => {
    renderCourses();
    const dialog = await newRun();
    fireEvent.change(
      within(dialog).getByLabelText("Beginn 1", { exact: true }),
      { target: { value: "2030-04-01T09:00" } },
    );
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText("Ende 1", { exact: true }),
      ).toHaveAttribute("aria-invalid", "true"),
    );
    expect(
      screen.queryByText("Gespeichert.", { exact: true }),
    ).not.toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [
      "course_locked",
      "Der verknüpfte Auftrag hat sich geändert oder schützt diese Angaben.",
    ],
    [
      "courses.manage permission required",
      "Die Änderung konnte nicht gespeichert werden.",
    ],
    [
      "Invalid or overlapping sessions",
      "Die Änderung konnte nicht gespeichert werden.",
    ],
  ])(
    "retains edits and the exact existing run when the server refuses %s",
    async (message, notice) => {
      state.rpc.mockResolvedValue({
        data: null,
        error: {
          message,
          code:
            message === "courses.manage permission required"
              ? "42501"
              : "22023",
        },
      });
      renderCourses({ runs: [run] });
      await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
      const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
      fireEvent.change(within(dialog).getByLabelText("Ort / Zugangslink"), {
        target: { value: "Edited fictional classroom" },
      });
      await userEvent.click(
        within(dialog).getByRole("button", {
          name: /^(Speichern|Entwurf speichern)$/,
        }),
      );
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        notice,
      );
      expect(within(dialog).getByLabelText("Ort / Zugangslink")).toHaveValue(
        "Edited fictional classroom",
      );
      expect(
        within(dialog).getByLabelText("Beginn 1", { exact: true }),
      ).toHaveValue("2030-04-01T09:00");
      expect(
        screen.queryByText("Gespeichert.", { exact: true }),
      ).not.toBeInTheDocument();
      expect(state.from).not.toHaveBeenCalled();
      const rejected = structuredClone(state.rpc.mock.calls[0]);
      state.rpc.mockImplementation((name: string) => {
        if (name === "job_lifecycle")
          return {
            abortSignal: async () => ({
              data: protectedLifecycle,
              error: null,
            }),
          };
        if (name === "changeable_assignments")
          return { abortSignal: async () => ({ data: [], error: null }) };
        return Promise.resolve({ data: runId, error: null });
      });
      await userEvent.click(
        within(dialog).getByRole("button", {
          name: /^(Speichern|Entwurf speichern)$/,
        }),
      );
      await screen.findByText("Gespeichert.", { exact: true });
      expect(state.rpc.mock.calls[1]).toEqual(rejected);
      expect(rejected).toEqual([
        "save_course_run",
        expect.objectContaining({ p_id: runId }),
      ]);
    },
  );

  it("waits for online confirmation, disables repeat submission and preserves an uncertain network failure for retry", async () => {
    let reject: (error: Error) => void = () => {
      throw new Error("uninitialised");
    };
    state.rpc.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    renderCourses();
    const dialog = await newRun();
    interval(dialog, "2030-04-01T09:00", "2030-04-01T10:00");
    const save = within(dialog).getByRole("button", {
      name: /^(Speichern|Entwurf speichern)$/,
    });
    await userEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(dialog).toBeInTheDocument();
    expect(
      screen.queryByText("Gespeichert.", { exact: true }),
    ).not.toBeInTheDocument();
    await userEvent.click(save);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Fictional disconnected response")));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Die Änderung konnte nicht gespeichert werden.",
    );
    expect(save).toBeEnabled();
    expect(
      within(dialog).getByLabelText("Beginn 1", { exact: true }),
    ).toHaveValue("2030-04-01T09:00");
  });

  it("disables offline writes and retains the partially completed course draft", async () => {
    renderCourses();
    const dialog = await newRun();
    interval(dialog, "2030-04-01T09:00", "2030-04-01T10:00");
    act(() => {
      state.online = false;
      window.dispatchEvent(new Event("offline"));
    });
    const save = within(dialog).getByRole("button", {
      name: /^(Speichern|Entwurf speichern)$/,
    });
    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(state.rpc).not.toHaveBeenCalled();
    act(() => {
      state.online = true;
      window.dispatchEvent(new Event("online"));
    });
    expect(save).toBeEnabled();
    expect(
      within(dialog).getByLabelText("Beginn 1", { exact: true }),
    ).toHaveValue("2030-04-01T09:00");
  });

  it("shows published course information without management actions to an ordinary lecturer", () => {
    renderCourses({ permissions: [], runs: [{ ...run, published: true }] });
    expect(screen.getByText(template.title, { exact: true })).toBeVisible();
    for (const name of [
      "Kurs anlegen",
      "Durchführung anlegen",
      "Vorlage anlegen",
      "Bearbeiten",
      "Veröffentlichung zurücknehmen",
      "Sicher kopieren",
    ])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Auftrag daraus erstellen" }),
    ).not.toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses an empty template title and retains a server-rejected authored template", async () => {
    renderCourses();
    const dialog = await newRun(false);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Als Vorlage speichern" }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText("Titel", { exact: true }),
      ).toHaveAttribute("aria-invalid", "true"),
    );
    expect(state.rpc).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Titel", { exact: true }), {
      target: { value: "  Authored course draft  " },
    });
    fireEvent.change(
      within(dialog).getByLabelText("Lehrplan", { exact: true }),
      { target: { value: "Keep authored commands and examples." } },
    );
    state.rpc.mockResolvedValue({
      data: null,
      error: { message: "courses.manage permission required", code: "42501" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Als Vorlage speichern",
      }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Die Änderung konnte nicht gespeichert werden.",
    );
    expect(
      within(dialog).getByLabelText("Lehrplan", { exact: true }),
    ).toHaveValue("Keep authored commands and examples.");
    expect(state.rpc).toHaveBeenCalledWith("save_course_template", {
      p_id: null,
      p_payload: {
        title: "Authored course draft",
        description: "",
        syllabus: "Keep authored commands and examples.",
        prerequisites: "",
        topic_ids: [],
        archived: false,
      },
    });
    expect(
      screen.queryByText("Gespeichert.", { exact: true }),
    ).not.toBeInTheDocument();
  });

  it("shows an active order on an unpublished run and saves the run venue without changing its source sessions", async () => {
    renderCourses({ runs: [{ ...run, jobs: [job] }] });
    expect(await screen.findByText("Aktiver Auftrag")).toBeVisible();
    expect(
      screen.queryByText("Entwurf", { exact: true }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = within(screen.getByRole("dialog", { name: "Bearbeiten" }));
    expect(
      dialog.getByRole("link", { name: "Auftrag öffnen: " + job.title }),
    ).toHaveAttribute("href", "/jobs/" + job.id);
    expect(dialog.queryByLabelText("Beginn 1")).not.toBeInTheDocument();
    expect(dialog.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText("Ort / Zugangslink"), {
      target: { value: "Updated course venue" },
    });
    await userEvent.click(dialog.getByRole("button", { name: "Speichern" }));
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: run.id,
      p_payload: expect.objectContaining({
        venue: "Updated course venue",
        template_id: run.template_id,
        published: false,
        sessions: [
          expect.objectContaining({
            starts_at: run.course_sessions[0].starts_at,
          }),
        ],
      }),
    });
  });

  it("offers the authorized amendment for a confirmed assignment and keeps its schedule out of direct edit controls", async () => {
    const candidate: ChangeCandidate = {
      claim_id: claimId,
      title: job.title,
      lecturer_name: "Fictional lecturer",
      time_zone: run.time_zone,
      can_price: false,
      commissioned: false,
      schedule_editable: true,
      current: {
        claim_id: claimId,
        job_id: job.id,
        course_run_id: run.id,
        lecturer_id: "c2400000-0000-4000-8000-000000000001",
        title: job.title,
        time_zone: run.time_zone,
        delivery_type: run.delivery_type,
        location: run.venue,
        scope: "",
        amount: null,
        total_amount: null,
        currency: null,
        rate_unit: null,
        terms: null,
        cancel: false,
        sessions: run.course_sessions,
      },
    };
    renderCourses({
      runs: [{ ...run, jobs: [{ ...job, status: "filled" }] }],
      changeCandidates: [candidate],
    });
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = within(screen.getByRole("dialog", { name: "Bearbeiten" }));
    expect(
      dialog.getByRole("link", { name: "Terminänderung vorschlagen" }),
    ).toHaveAttribute("href", `/changes?claim=${claimId}&new=1`);
    expect(dialog.getByLabelText("Ort / Zugangslink")).toBeEnabled();
    expect(dialog.queryByLabelText("Beginn 1")).not.toBeInTheDocument();
  });

  it("submits permitted linked course changes together with the reviewed offer version", async () => {
    const nextTemplateId = "c1000000-0000-4000-8000-000000000002";
    renderCourses({
      runs: [{ ...run, jobs: [{ ...job, status: "draft" }] }],
      templates: [
        template,
        { ...template, id: nextTemplateId, title: "Replacement template" },
      ],
      organisations: [organisation],
      lifecycle: {
        ...protectedLifecycle,
        can_edit: true,
        can_edit_course_details: true,
        can_edit_schedule: true,
        can_reassign_company: true,
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const editor = screen.getByRole("dialog", { name: "Bearbeiten" });
    const dialog = within(editor);
    await userEvent.selectOptions(
      dialog.getByLabelText("Kursvorlage"),
      nextTemplateId,
    );
    await userEvent.selectOptions(
      dialog.getByLabelText("Organisation"),
      companyId,
    );
    await userEvent.selectOptions(
      dialog.getByLabelText("Durchführung"),
      "onsite",
    );
    await userEvent.selectOptions(dialog.getByLabelText("Zeitzone"), "UTC");
    expect(dialog.getByLabelText("Beginn 1")).toHaveValue("2030-04-01T07:00");
    interval(editor, "2030-04-01T08:00", "2030-04-01T09:00");
    await userEvent.click(dialog.getByRole("button", { name: "Speichern" }));
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: run.id,
      p_payload: expect.objectContaining({
        template_id: nextTemplateId,
        organisation_id: companyId,
        delivery_type: "onsite",
        time_zone: "UTC",
        sessions: [
          {
            starts_at: "2030-04-01T08:00:00.000Z",
            ends_at: "2030-04-01T09:00:00.000Z",
          },
        ],
        expected_job_version: protectedLifecycle.version,
        job_request_id: expect.stringMatching(/^[a-f0-9-]{36}$/i),
      }),
    });
  });

  it("preserves exact pre-existing session instants when only the venue is edited", async () => {
    const preciseRun = {
      ...run,
      course_sessions: [
        {
          ...run.course_sessions[0],
          starts_at: "2030-04-01T07:00:37.123Z",
          ends_at: "2030-04-01T08:00:42.456Z",
        },
      ],
    };
    renderCourses({ runs: [preciseRun] });
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
    fireEvent.change(within(dialog).getByLabelText("Ort / Zugangslink"), {
      target: { value: "Another fictional venue" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: runId,
      p_payload: expect.objectContaining({
        venue: "Another fictional venue",
        sessions: [
          {
            starts_at: preciseRun.course_sessions[0].starts_at,
            ends_at: preciseRun.course_sessions[0].ends_at,
          },
        ],
      }),
    });
  });

  it.each([
    [
      "Beginn 1",
      "2030-04-01T09:15",
      "2030-04-01T07:15:00.000Z",
      "2030-04-01T08:00:42.456Z",
    ],
    [
      "Ende 1",
      "2030-04-01T10:15",
      "2030-04-01T07:00:37.123Z",
      "2030-04-01T08:15:00.000Z",
    ],
  ])(
    "changes only the explicitly edited %s endpoint and preserves its precise counterpart",
    async (label, input, start, end) => {
      renderCourses({
        runs: [
          {
            ...run,
            course_sessions: [
              {
                ...run.course_sessions[0],
                starts_at: "2030-04-01T07:00:37.123Z",
                ends_at: "2030-04-01T08:00:42.456Z",
              },
            ],
          },
        ],
      });
      await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
      const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
      fireEvent.change(within(dialog).getByLabelText(label, { exact: true }), {
        target: { value: input },
      });
      await userEvent.click(
        within(dialog).getByRole("button", {
          name: /^(Speichern|Entwurf speichern)$/,
        }),
      );
      await screen.findByText("Gespeichert.", { exact: true });
      expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
        p_id: runId,
        p_payload: expect.objectContaining({
          sessions: [{ starts_at: start, ends_at: end }],
        }),
      });
    },
  );

  it("retains the second row's exact instants when an earlier session is removed", async () => {
    const retained = {
      id: "c3000000-0000-4000-8000-000000000002",
      starts_at: "2030-04-02T07:30:23.123456Z",
      ends_at: "2030-04-02T08:30:45.654321Z",
    };
    renderCourses({
      runs: [{ ...run, course_sessions: [run.course_sessions[0], retained] }],
    });
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Entfernen 1" }),
    );
    expect(
      within(dialog).getByLabelText("Beginn 1", { exact: true }),
    ).toHaveValue("2030-04-02T09:30");
    expect(
      within(dialog).queryByLabelText("Beginn 2", { exact: true }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: runId,
      p_payload: expect.objectContaining({
        sessions: [
          { starts_at: retained.starts_at, ends_at: retained.ends_at },
        ],
      }),
    });
  });

  it("normalizes an appended row independently of a retained precise original", async () => {
    const original = {
      ...run.course_sessions[0],
      starts_at: "2030-04-01T07:00:37.123456Z",
      ends_at: "2030-04-01T08:00:42.654321Z",
    };
    renderCourses({ runs: [{ ...run, course_sessions: [original] }] });
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Termin ergänzen" }),
    );
    interval(dialog, "2030-04-02T09:00", "2030-04-02T10:00", 2);
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: runId,
      p_payload: expect.objectContaining({
        sessions: [
          { starts_at: original.starts_at, ends_at: original.ends_at },
          {
            starts_at: "2030-04-02T07:00:00.000Z",
            ends_at: "2030-04-02T08:00:00.000Z",
          },
        ],
      }),
    });
  });

  it("keeps known concrete instants across a DST fold even when both displayed minutes are equal", async () => {
    const original = {
      id: run.course_sessions[0].id,
      starts_at: "2030-10-27T00:30:37.123456Z",
      ends_at: "2030-10-27T01:30:42.654321Z",
    };
    renderCourses({ runs: [{ ...run, course_sessions: [original] }] });
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
    expect(
      within(dialog).getByLabelText("Beginn 1", { exact: true }),
    ).toHaveValue("2030-10-27T02:30");
    expect(
      within(dialog).getByLabelText("Ende 1", { exact: true }),
    ).toHaveValue("2030-10-27T02:30");
    fireEvent.change(within(dialog).getByLabelText("Ort / Zugangslink"), {
      target: { value: "A fictional amended venue" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: runId,
      p_payload: expect.objectContaining({
        sessions: [
          { starts_at: original.starts_at, ends_at: original.ends_at },
        ],
      }),
    });
  });

  it("keeps the exact first repeated hour when the display zone changes across an autumn clock change", async () => {
    renderCourses({
      runs: [
        {
          ...run,
          course_sessions: [
            {
              ...run.course_sessions[0],
              starts_at: "2030-10-27T00:30:37.123Z",
              ends_at: "2030-10-27T02:30:42.456Z",
            },
          ],
        },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
    fireEvent.change(within(dialog).getByLabelText("Zeitzone"), {
      target: { value: "Europe/Paris" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: run.id,
      p_payload: expect.objectContaining({
        time_zone: "Europe/Paris",
        sessions: [
          {
            starts_at: "2030-10-27T00:30:37.123Z",
            ends_at: "2030-10-27T02:30:42.456Z",
          },
        ],
      }),
    });
  });

  it("compares edited and preserved endpoints as instants when the original uses a different ISO offset", async () => {
    renderCourses({
      runs: [
        {
          ...run,
          course_sessions: [
            {
              ...run.course_sessions[0],
              starts_at: "2030-04-01T09:00:37.123+02:00",
              ends_at: "2030-04-01T08:00:42.456+00:00",
            },
          ],
        },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
    fireEvent.change(within(dialog).getByLabelText("Ende 1", { exact: true }), {
      target: { value: "2030-04-01T10:15" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: runId,
      p_payload: expect.objectContaining({
        sessions: [
          {
            starts_at: "2030-04-01T09:00:37.123+02:00",
            ends_at: "2030-04-01T08:15:00.000Z",
          },
        ],
      }),
    });
  });

  it("accepts an edited start exactly one PostgreSQL microsecond before its retained end", async () => {
    renderCourses({
      runs: [
        {
          ...run,
          course_sessions: [
            {
              ...run.course_sessions[0],
              starts_at: "2030-04-01T06:59:30.123456Z",
              ends_at: "2030-04-01T07:00:00.000001Z",
            },
          ],
        },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
    fireEvent.change(
      within(dialog).getByLabelText("Beginn 1", { exact: true }),
      { target: { value: "2030-04-01T09:00" } },
    );
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: runId,
      p_payload: expect.objectContaining({
        sessions: [
          {
            starts_at: "2030-04-01T07:00:00.000Z",
            ends_at: "2030-04-01T07:00:00.000001Z",
          },
        ],
      }),
    });
  });

  it.each([
    [
      "zero",
      "2030-04-01T06:59:30.123456Z",
      "2030-04-01T07:00:00.000000Z",
      "Beginn 1",
    ],
    [
      "negative by one microsecond",
      "2030-04-01T07:00:00.000001Z",
      "2030-04-01T07:01:30.123456Z",
      "Ende 1",
    ],
  ])(
    "rejects an edited interval that is %s even when JavaScript milliseconds tie",
    async (_label, start, end, field) => {
      renderCourses({
        runs: [
          {
            ...run,
            course_sessions: [
              { ...run.course_sessions[0], starts_at: start, ends_at: end },
            ],
          },
        ],
      });
      await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
      const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
      fireEvent.change(within(dialog).getByLabelText(field, { exact: true }), {
        target: { value: "2030-04-01T09:00" },
      });
      await userEvent.click(
        within(dialog).getByRole("button", {
          name: /^(Speichern|Entwurf speichern)$/,
        }),
      );
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "Beginn und Ende müssen eindeutig sein.",
      );
      expect(state.rpc).not.toHaveBeenCalled();
      expect(
        screen.queryByText("Gespeichert.", { exact: true }),
      ).not.toBeInTheDocument();
    },
  );

  it("treats regenerated planning rows as new minutes without inheriting the replaced session's hidden precision", async () => {
    const blockId = "c4000000-0000-4000-8000-000000000001";
    renderCourses({
      templates: [{ ...template, building_block_id: blockId }],
      runs: [
        {
          ...run,
          course_sessions: [
            {
              ...run.course_sessions[0],
              starts_at: "2030-04-01T07:00:37.123Z",
              ends_at: "2030-04-01T08:00:42.456Z",
            },
          ],
        },
      ],
      blocks: [
        {
          id: blockId,
          provider: "Fictional",
          code: "DEMO",
          title: "Fictional block",
          description: "Fictional curriculum",
          syllabus: "Fictional content",
          prerequisites: "",
          duration_days: 1,
          duration_hours: 1,
          theory_percent: null,
          practice_percent: null,
          notes: "",
          default_template_id: templateId,
          building_block_sources: [],
        },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog", { name: "Bearbeiten" });
    fireEvent.change(within(dialog).getByLabelText("Erster Unterrichtstag"), {
      target: { value: "2030-04-01" },
    });
    fireEvent.change(within(dialog).getByLabelText("Tägliches Ende"), {
      target: { value: "10:00" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "1 Werktagstermine erzeugen",
      }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /^(Speichern|Entwurf speichern)$/,
      }),
    );
    await screen.findByText("Gespeichert.", { exact: true });
    expect(state.rpc).toHaveBeenCalledWith("save_course_run", {
      p_id: runId,
      p_payload: expect.objectContaining({
        sessions: [
          {
            starts_at: "2030-04-01T07:00:00.000Z",
            ends_at: "2030-04-01T08:00:00.000Z",
          },
        ],
      }),
    });
  });
});

it("loads a course beyond the first thousand results within the actor scope", async () => {
  state.tables.course_runs = Array.from({ length: 1001 }, (_, index) => ({
    ...run,
    id: String(index),
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const result = await client.fetchQuery(runsQuery(actor));
  expect(result).toHaveLength(1001);
  expect(result.at(-1)?.id).toBe("1000");
  expect(state.from).toHaveBeenCalledTimes(5);
});
