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
import { CoursesPage } from "./courses";
import type { BuildingBlock, CourseRun, Template } from "./data";

// Each cache belongs to a fictional manager; no service or account is contacted.
const actor = "fictional-course-manager";
const templateId = "c1000000-0000-4000-8000-000000000001";
const runId = "c2000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  online: true,
  tables: {} as Record<string, unknown[]>,
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-course-manager" } } }),
}));
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
    organisations: [],
    building_blocks: blocks,
    topics: [],
  };
  for (const [name, value] of [
    ["templates", templates],
    ["runs", runs],
    ["organisations", []],
    ["building-blocks", blocks],
  ] as const)
    client.setQueryData(["operations", name, actor], value);
  client.setQueryData(["permissions", actor], permissions);
  client.setQueryData(["topics"], []);
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
async function newRun() {
  await userEvent.click(
    screen.getByRole("button", { name: "Durchführung anlegen" }),
  );
  return screen.getByRole("dialog", { name: "Durchführung anlegen" });
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
  state.rpc.mockResolvedValue({ data: runId, error: null });
  state.from.mockReset();
  state.from.mockImplementation((table: string) => ({
    select: () => ({
      order: async () => ({
        data: structuredClone(state.tables[table] ?? []),
        error: null,
      }),
    }),
  }));
});

afterEach(() => {
  // Release observers and the online-state override; no retries survive a case.
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
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
        within(dialog).getByRole("button", { name: "Speichern" }),
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
      within(dialog).getByRole("button", { name: "Speichern" }),
    );
    await within(dialog).findByRole("alert");
    expect(state.rpc).not.toHaveBeenCalled();
    expect(
      within(dialog).getByLabelText("Beginn 1", { exact: true }),
    ).toHaveValue("2030-03-30T09:00");
    interval(dialog, "2030-04-01T09:00", "2030-04-01T10:00", 2);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Speichern" }),
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

  it("keeps an invalid IANA zone visible and marks its input without making an RPC", async () => {
    renderCourses();
    const dialog = await newRun();
    interval(dialog, "2030-04-01T09:00", "2030-04-01T10:00");
    fireEvent.change(within(dialog).getByLabelText("Zeitzone"), {
      target: { value: "Fictional/Unknown" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Speichern" }),
    );
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Zeitzone")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(within(dialog).getByLabelText("Zeitzone")).toHaveValue(
      "Fictional/Unknown",
    );
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("marks the missing session endpoint without falsely confirming a saved course", async () => {
    renderCourses();
    const dialog = await newRun();
    fireEvent.change(
      within(dialog).getByLabelText("Beginn 1", { exact: true }),
      { target: { value: "2030-04-01T09:00" } },
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Speichern" }),
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
      "Diese Inhalte sind mit bestehenden Aufträgen verbunden und geschützt.",
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
        within(dialog).getByRole("button", { name: "Speichern" }),
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
      state.rpc.mockResolvedValue({ data: runId, error: null });
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Speichern" }),
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
    const save = within(dialog).getByRole("button", { name: "Speichern" });
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
    const save = within(dialog).getByRole("button", { name: "Speichern" });
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
    await userEvent.click(
      screen.getByRole("button", { name: "Vorlage anlegen" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Vorlage anlegen" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Speichern" }),
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
      within(dialog).getByRole("button", { name: "Speichern" }),
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
      within(dialog).getByRole("button", { name: "Speichern" }),
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
        within(dialog).getByRole("button", { name: "Speichern" }),
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
      within(dialog).getByRole("button", { name: "Speichern" }),
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
      within(dialog).getByRole("button", { name: "Speichern" }),
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
      within(dialog).getByRole("button", { name: "Speichern" }),
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

  it("rejects a newly chosen zone's ambiguous time instead of retaining an instant from the previous zone", async () => {
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
      within(dialog).getByRole("button", { name: "Speichern" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Beginn und Ende müssen eindeutig sein.",
    );
    expect(state.rpc).not.toHaveBeenCalled();
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
      within(dialog).getByRole("button", { name: "Speichern" }),
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
      within(dialog).getByRole("button", { name: "Speichern" }),
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
        within(dialog).getByRole("button", { name: "Speichern" }),
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
      within(dialog).getByRole("button", { name: "Speichern" }),
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
