/** Exercise the dedicated app entrance, route selection and revoked browser data. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../lib/i18n";
import type { CourseWorkspace } from "../features/learning/api";
import { App } from "./app";

const fake = vi.hoisted(() => ({
  installation: "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca",
  rpc: vi.fn(),
  from: vi.fn(),
  signOut: vi.fn(),
  profile: true,
  licence: "active",
  actor: "fictional-admin" as string | null,
  returnedInstallation: "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca",
  foreignCourse: false,
  registerAvailable: false,
  attendanceVersion: 0,
  examRequired: false,
  canCreateDraft: false,
  draftAttempts: 0,
  notificationRead: false,
  publication: null as { published: boolean; capacity: number | null } | null,
  publicationAttempts: 0,
  administration: false,
}));
vi.mock("../lib/installation-brand", async (load) => {
  const source = await load<typeof import("../lib/installation-brand")>();
  return {
    ...source,
    portalInternalEdition: false,
    installationBrand: {
      ...source.internalInstallationBrand,
      installationId: fake.installation,
      edition: "customer-managed",
      name: "Fictional Academy",
      shortName: "Fictional",
    },
  };
});
vi.mock("../features/auth/auth-context", () => ({
  useAuth: () => ({
    session: fake.actor && { user: { id: fake.actor } },
    loading: false,
    error: false,
  }),
}));
vi.mock("../features/learning/course-chat-live", () => ({
  useCourseChatLive: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  isConfigured: true,
  db: () => ({
    rpc: fake.rpc,
    from: fake.from,
    auth: { signOut: fake.signOut },
  }),
}));

const id = "52b7ddee-2166-485a-bcee-04d0eea958d1";
const sessionId = "455d72a6-0bd7-4a8e-b708-1c3128322c8e";
const learnerId = "62886692-0412-46e9-8401-ab3bc955b18d";
const start = new Date(Date.now() - 7_200_000).toISOString();
const end = new Date(Date.now() - 3_600_000).toISOString();
const session = {
  id: sessionId,
  starts_at: start,
  ends_at: end,
  attendance: null,
  minutes: null,
  version: 0,
  can_check_in: false,
  can_verify: true,
};
const workspace: CourseWorkspace = {
  id,
  title: "Fictional course room",
  description: "Protected course briefing",
  syllabus: "Workshop syllabus",
  time_zone: "Australia/Brisbane",
  venue: "",
  delivery_type: "online",
  ended: false,
  lms_enabled: true,
  access: {
    manager: true,
    teacher: false,
    learner: false,
    client: false,
    staff: true,
    lms_enabled: true,
  },
  meeting_link: {
    url: "https://meet.example.invalid/session",
    version: 2,
    can_edit: true,
  },
  contact: null,
  contact_options: [],
  settings_version: 0,
  exams: { required: false, version: null, can_edit: false, documents: [] },
  sessions: [],
  preparation: [],
  resources: [
    {
      id: "resource-a",
      name: "Scanned workbook.pdf",
      version: 1,
      version_id: id,
      sha256: "a".repeat(64),
      category: "material",
      can_remove: true,
      ownership_kind: "lecturer",
      audience: "all",
      acknowledged: false,
    },
  ],
  share_options: [],
  questions: [],
  notebook: null,
  feedback: null,
  feedback_summary: null,
  quiz: null,
  completion: null,
  roster: [],
  attendance_history: [],
  repeat_request: null,
};

function open(path = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const app = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(app());
  return { client, rerender: () => view.rerender(app()) };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  fake.profile = true;
  fake.licence = "active";
  fake.actor = "fictional-admin";
  fake.returnedInstallation = fake.installation;
  fake.foreignCourse = false;
  fake.registerAvailable = false;
  fake.attendanceVersion = 0;
  fake.examRequired = false;
  fake.canCreateDraft = false;
  fake.draftAttempts = 0;
  fake.notificationRead = false;
  fake.publication = null;
  fake.publicationAttempts = 0;
  fake.administration = false;
  fake.rpc.mockImplementation((name: string) => {
    let data: unknown;
    let error = null;
    switch (name) {
      case "installation_capabilities":
        data = {
          installation_id: fake.returnedInstallation,
          edition: "customer-managed",
          licence_status: fake.licence,
          customer_ready: false,
          lms_available: false,
          marketplace_available: false,
          company_premium_switch_available: false,
        };
        break;
      case "portal_access":
        if (!fake.profile) error = { code: "42501" };
        data = fake.profile;
        break;
      case "my_course_workspaces":
        data = [{ ...workspace, starts_at: null, ends_at: null }];
        break;
      case "course_workspace":
        if (fake.foreignCourse) error = { code: "42501" };
        data = fake.foreignCourse
          ? null
          : {
              ...workspace,
              sessions: fake.registerAvailable ? [session] : [],
              access:
                fake.actor === "fictional-learner"
                  ? {
                      ...workspace.access,
                      manager: false,
                      staff: false,
                      learner: true,
                    }
                  : workspace.access,
              exams: { ...workspace.exams, required: fake.examRequired },
            };
        break;
      case "course_session_register":
        data = {
          session_id: sessionId,
          starts_at: start,
          ends_at: end,
          time_zone: workspace.time_zone,
          evidence: [],
          history: [],
          rows: [
            {
              user_id: learnerId,
              name: "Fictional register entry",
              status: fake.attendanceVersion ? "present" : null,
              arrival_at: null,
              departure_at: null,
              note: "",
              version: fake.attendanceVersion,
            },
          ],
        };
        break;
      case "save_course_session_attendance":
        fake.attendanceVersion++;
        data = {
          status: "present",
          version: fake.attendanceVersion,
          minutes: 60,
        };
        break;
      case "import_course_session_attendance":
        fake.attendanceVersion++;
        data = { saved: 1 };
        break;
      case "course_welcome_content":
        data = {
          version: 1,
          description: "Fictional welcome",
          objectives: "",
          joining_instructions: "",
          published_at: null,
        };
        break;
      case "course_chat_rooms":
        data = [{ id: "room-a", title: "Fictional text chat", can_post: true }];
        break;
      case "course_chat_messages":
      case "course_enrolments":
      case "course_enrolment_candidates":
      case "academy_course_instructor_candidates":
        data = [];
        break;
      case "academy_course_draft_options":
        data = fake.canCreateDraft
          ? {
              organisations: [{ id: learnerId, name: "Fictional Training" }],
              templates: [{ id: sessionId, title: "Fictional template" }],
            }
          : null;
        break;
      case "notification_inbox":
        data = {
          items: [
            {
              id: learnerId,
              kind: "chat_message",
              title: "Fictional course notice",
              created_at: start,
              read_at: fake.notificationRead ? end : null,
              href: `/courses/${id}/workspace#course-chat`,
            },
          ],
          unread_count: fake.notificationRead ? 0 : 1,
          as_of: end,
          quiet_active: false,
        };
        break;
      case "mark_notifications":
        fake.notificationRead = true;
        data = 1;
        break;
      case "academy_create_course_draft":
        fake.draftAttempts++;
        if (fake.draftAttempts === 1) error = { code: "unavailable" };
        else data = { course_run_id: id, template_id: sessionId };
        break;
      case "academy_course_publication":
        data = fake.publication;
        break;
      case "academy_administration":
        data = fake.administration
          ? {
              can_write: fake.licence === "active",
              can_create_management: fake.licence === "active",
              organisations: [],
              accounts: [],
            }
          : null;
        break;
      case "academy_timetable":
        data = { rows: [], next: null };
        break;
      case "academy_publish_course":
        fake.publicationAttempts++;
        if (fake.publicationAttempts === 1) error = { code: "PT409" };
        else data = fake.publication = { published: true, capacity: 3 };
        break;
      default:
        throw new Error("Unexpected RPC: " + name);
    }
    const result = Promise.resolve({ data, error });
    return Object.assign(result, { abortSignal: () => result });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("opens the branded register deep link and reloads the exact server-confirmed row", async () => {
  fake.registerAvailable = true;
  open(`/courses/${id}/workspace#course-register`);
  expect(await screen.findByText("Fictional register entry")).toBeVisible();
  expect(screen.getByRole("link", { name: "Attendance" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await userEvent.click(screen.getByRole("button", { name: "Present" }));
  expect(await screen.findByText("Current status: Present")).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith(
    "save_course_session_attendance",
    expect.objectContaining({
      p_run_id: id,
      p_session_id: sessionId,
      p_user_id: learnerId,
      p_expected_version: 0,
    }),
  );
  expect(screen.queryByLabelText(/attendance.*PDF/i)).toBeNull();
  expect(screen.getByText("Import attendance from CSV or XLSX")).toBeVisible();
});

it("previews the exact branded session's CSV and imports it only on confirmation", async () => {
  fake.registerAvailable = true;
  open(`/courses/${id}/workspace#course-register`);
  const user = userEvent.setup();
  await user.click(
    await screen.findByText("Import attendance from CSV or XLSX"),
  );
  const bytes = new TextEncoder().encode(
    `user_id,name,status,arrival_at,departure_at,note,reason\n${learnerId},File name,present,,,Fictional import note,\n`,
  );
  const file = new File([bytes], "attendance.csv", { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.buffer,
  });
  await user.upload(screen.getByLabelText("Review CSV or XLSX file"), file);
  const confirm = await screen.findByRole("button", {
    name: "Confirm and save 1 change",
  });
  expect(screen.getByText(/Reviewed course session:/)).toBeVisible();
  expect(screen.getByText(learnerId)).toBeVisible();
  expect(screen.queryByText("File name")).toBeNull();
  expect(
    fake.rpc.mock.calls.some(
      ([name]) => name === "import_course_session_attendance",
    ),
  ).toBe(false);
  await user.click(confirm);
  expect(await screen.findByText("Saved 1 change.")).toBeVisible();
  expect(await screen.findByText("Current status: Present")).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith("import_course_session_attendance", {
    p_run_id: id,
    p_session_id: sessionId,
    p_rows: [
      {
        user_id: learnerId,
        status: "present",
        arrival_at: null,
        departure_at: null,
        note: "Fictional import note",
        reason: "",
        expected_version: 0,
      },
    ],
  });
});

it("opens the course hub without activating the full edition and reuses scoped active workspaces", async () => {
  open("/");
  const course = await screen.findByRole("link", {
    name: "Fictional course room",
  });
  await userEvent.click(course);
  expect(
    await screen.findByRole("heading", { name: "Fictional course room" }),
  ).toBeVisible();
  expect(await screen.findByText("Scanned workbook.pdf")).toBeVisible();
  expect(
    await screen.findByRole("button", { name: "Edit welcome content" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Edit meeting link" }),
  ).toBeVisible();
  expect(await screen.findByRole("textbox", { name: "Message" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Fictional Academy" }),
  ).toHaveAttribute("href", "/learning");
  expect(
    screen.queryByRole("link", {
      name: /contracts|marketplace|readiness|manage course/i,
    }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: /acknowledge/i })).toBeVisible();
  expect(screen.queryByRole("button", { name: /unshare/i })).toBeNull();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(fake.from).not.toHaveBeenCalled();
  expect(fake.rpc.mock.calls.map(([name]) => name)).toEqual(
    expect.arrayContaining([
      "installation_capabilities",
      "portal_access",
      "my_course_workspaces",
      "academy_course_draft_options",
    ]),
  );
});

it("keeps keyboard focus in the course schedule when adding and removing draft sessions", async () => {
  fake.canCreateDraft = true;
  open("/learning");
  const user = userEvent.setup();
  await user.click(
    await screen.findByText("Create course draft", { exact: true }),
  );
  const first = within(screen.getByRole("group", { name: "Session 1" }));
  const firstStart = first.getByLabelText("Start", { exact: true });
  fireEvent.change(firstStart, { target: { value: "2039-01-02T09:00" } });

  const add = screen.getByRole("button", { name: "Add session" });
  add.focus();
  await user.keyboard("{Enter}");
  const second = within(screen.getByRole("group", { name: "Session 2" }));
  expect(second.getByLabelText("Start", { exact: true })).toHaveFocus();

  second.getByRole("button", { name: "Remove session 2" }).focus();
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("group", { name: "Session 2" })).toBeNull();
  expect(firstStart).toHaveFocus();
  expect(firstStart).toHaveValue("2039-01-02T09:00");
});

it("creates an academy draft from the selected company and preserves its request on a failed reply", async () => {
  fake.canCreateDraft = true;
  open("/learning");
  const user = userEvent.setup();
  await user.click(
    await screen.findByText("Create course draft", { exact: true }),
  );
  await user.selectOptions(
    screen.getByLabelText("Organisation", { exact: true }),
    learnerId,
  );
  await user.click(screen.getByLabelText("Create a new course template"));
  await user.type(
    screen.getByLabelText("Course template title"),
    "Course from local academy",
  );
  fireEvent.change(screen.getByLabelText("Course time zone (IANA)"), {
    target: { value: "Australia/Brisbane" },
  });
  fireEvent.change(screen.getByLabelText("Start", { exact: true }), {
    target: { value: "2039-01-02T09:00" },
  });
  fireEvent.change(screen.getByLabelText("End", { exact: true }), {
    target: { value: "2039-01-02T10:00" },
  });
  await user.click(screen.getByRole("button", { name: /^Save draft$/ }));
  expect(
    await screen.findByText(/The course draft could not be confirmed/),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /^Save draft$/ }));
  expect(
    await screen.findByRole("heading", { name: "Fictional course room" }),
  ).toBeVisible();
  const writes = fake.rpc.mock.calls
    .filter(([name]) => name === "academy_create_course_draft")
    .map(([, data]) => data);
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatchObject({
    p_request_id: expect.any(String),
    p_organisation_id: learnerId,
    p_template_id: null,
    p_template_title: "Course from local academy",
    p_payload: {
      time_zone: "Australia/Brisbane",
      sessions: [
        {
          starts_at: "2039-01-01T23:00:00.000Z",
          ends_at: "2039-01-02T00:00:00.000Z",
        },
      ],
    },
  });
  expect(writes[1]).toEqual(writes[0]);
});

it("opens the dedicated timetable through its main navigation link", async () => {
  open("/learning");
  await userEvent.click(await screen.findByRole("link", { name: "Timetable" }));
  expect(
    await screen.findByRole("heading", { name: "Timetable" }),
  ).toBeVisible();
  expect(
    await screen.findByText("There are no course sessions in this date range."),
  ).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith(
    "academy_timetable",
    expect.objectContaining({
      p_from: expect.any(String),
      p_until: expect.any(String),
    }),
  );
});

it("opens local user administration only after the authority is confirmed", async () => {
  fake.administration = true;
  open("/learning");
  const link = await screen.findByRole("link", {
    name: "Academy administration",
  });
  await userEvent.click(link);
  expect(
    await screen.findByRole("heading", { name: "Academy administration" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Save organisation" }),
  ).toBeVisible();
});

it("does not show administration or its navigation link to a learner", async () => {
  fake.actor = "fictional-learner";
  open("/administration");
  expect(
    await screen.findByText("Administration is unavailable to your account."),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Academy administration" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save organisation" }),
  ).not.toBeInTheDocument();
});

it("confirms course publication online and retries the reviewed capacity", async () => {
  fake.publication = { published: false, capacity: null };
  open(`/courses/${id}/workspace`);
  const user = userEvent.setup();
  const capacity = await screen.findByRole("spinbutton", {
    name: "Maximum group size",
  });
  await user.type(capacity, "3");
  await user.click(screen.getByRole("button", { name: "Publish course" }));
  expect(fake.publicationAttempts).toBe(0);
  const review = within(screen.getByRole("dialog", { name: "Publish course" }));
  const confirm = () =>
    user.click(review.getByRole("button", { name: "Confirm" }));
  await confirm();
  expect(
    await review.findByText(/Publication was not confirmed/),
  ).toBeVisible();
  expect(screen.queryByText(/Course published/)).not.toBeInTheDocument();
  await confirm();
  expect(
    await screen.findByText("Course published. Maximum group size 3."),
  ).toBeVisible();
  expect(
    fake.rpc.mock.calls.filter(([name]) => name === "academy_publish_course"),
  ).toEqual([
    ["academy_publish_course", { p_course_id: id, p_capacity: 3 }],
    ["academy_publish_course", { p_course_id: id, p_capacity: 3 }],
  ]);
});

it("keeps publication read-only in licence grace", async () => {
  fake.licence = "grace";
  fake.publication = { published: false, capacity: null };
  open(`/courses/${id}/workspace`);
  expect(await screen.findByText(/This course is a draft/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Publish course" }),
  ).not.toBeInTheDocument();
});

it("opens the branded inbox from the bell and saves read state on the server", async () => {
  open("/learning");
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText(/^Notifications:.*1/));
  expect(await screen.findByText("Fictional course notice")).toBeVisible();
  await user.click(screen.getByRole("link", { name: "All notifications" }));
  expect(
    await screen.findByRole("heading", { name: "Notifications", level: 1 }),
  ).toBeVisible();
  const inbox = within(screen.getByRole("main"));
  await user.click(await inbox.findByRole("button", { name: "Mark as read" }));
  expect(fake.rpc).toHaveBeenCalledWith("mark_notifications", {
    p_ids: [learnerId],
    p_all_before: null,
    p_read: true,
  });
  expect(
    await inbox.findByRole("button", { name: "Mark as unread" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /Notification settings|Preferences/i }),
  ).toBeNull();
  expect(fake.from).not.toHaveBeenCalled();
});

it("reads the same branded inbox in grace without exposing write controls", async () => {
  fake.licence = "grace";
  open("/notifications");
  const inbox = within(await screen.findByRole("main"));
  expect(await inbox.findByText("Fictional course notice")).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: /mark as read|read all notifications/i,
    }),
  ).toBeNull();
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "mark_notifications",
    expect.anything(),
  );
});

it("renders the direct course link read-only in German even if individual resources are marked editable", async () => {
  await i18n.changeLanguage("de");
  fake.licence = "grace";
  open(`/courses/${id}/workspace#course-materials`);
  expect(await screen.findByText(/Lizenz-Kulanzfrist/)).toBeVisible();
  expect(await screen.findByText("Scanned workbook.pdf")).toBeVisible();
  expect(await screen.findByText("Fictional welcome")).toBeVisible();
  expect(
    await screen.findByRole("heading", { name: "Fictional text chat" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /bearbeiten|zuweisen|entfernen/i }),
  ).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(fake.rpc.mock.calls.flat()).not.toContain(
    "course_enrolment_candidates",
  );
  expect(fake.rpc.mock.calls.flat()).not.toContain(
    "academy_course_instructor_candidates",
  );
});

it("discards the visible workspace offline and requires fresh operator proof on reconnect", async () => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  open(`/courses/${id}/workspace`);
  expect(await screen.findByText("Protected course briefing")).toBeVisible();
  online.mockReturnValue(false);
  fireEvent(window, new Event("offline"));
  expect(screen.queryByText("Protected course briefing")).toBeNull();
  fake.profile = false;
  online.mockReturnValue(true);
  fireEvent(window, new Event("online"));
  expect(screen.queryByText("Protected course briefing")).toBeNull();
  expect(await screen.findByText(/course area is unavailable/)).toBeVisible();
});

it.each([
  [
    "different installation",
    () => {
      fake.returnedInstallation = "different";
    },
  ],
  [
    "expired licence",
    () => {
      fake.licence = "expired";
    },
  ],
  [
    "closed operator profile",
    () => {
      fake.profile = false;
    },
  ],
])(
  "refuses a dedicated workspace with %s before querying course data",
  async (_, change) => {
    change();
    open(`/courses/${id}/workspace`);
    expect(await screen.findByText(/course area is unavailable/)).toBeVisible();
    expect(fake.rpc.mock.calls.flat()).not.toContain("course_workspace");
  },
);

it("withdraws private details after the current workspace's live scope is revoked", async () => {
  const page = open(`/courses/${id}/workspace`);
  expect(await screen.findByText("Protected course briefing")).toBeVisible();
  fake.foreignCourse = true;
  await act(async () =>
    page.client.invalidateQueries({ queryKey: ["course-workspace"] }),
  );
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("Protected course briefing")).toBeNull();
});

it("rejects internal paths in the dedicated app without touching the backend", async () => {
  open("/admin/people");
  expect(await screen.findByRole("heading")).toHaveTextContent(
    /could not be found/i,
  );
  expect(fake.rpc).not.toHaveBeenCalled();
  expect(fake.from).not.toHaveBeenCalled();
});

it("waits for authentication before restoring the signed-out visitor's course link", async () => {
  fake.actor = null;
  const page = open(`/courses/${id}/workspace#course-materials`);
  expect(
    await screen.findByRole("heading", { name: "Fictional Academy" }),
  ).toBeVisible();
  expect(fake.rpc).not.toHaveBeenCalled();
  fake.actor = "fictional-learner";
  page.rerender();
  expect(await screen.findByText("Scanned workbook.pdf")).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith("course_workspace", { p_run_id: id });
  expect(screen.getByRole("link", { name: "Materials" })).toHaveAttribute(
    "aria-current",
    "location",
  );
});

it.each([false, true])(
  "shows the academy learner exam route only when required (%s)",
  async (required) => {
    fake.actor = "fictional-learner";
    fake.examRequired = required;
    open(`/courses/${id}/workspace#course-exam`);
    expect(
      await screen.findByRole("heading", { name: "Fictional course room" }),
    ).toBeVisible();
    const link = screen.queryByRole("link", { name: "Exam" });
    if (required) {
      expect(link).toHaveAttribute("aria-current", "location");
      expect(screen.getByText("Exam required")).toBeVisible();
    } else {
      expect(link).toBeNull();
      expect(screen.queryByRole("region", { name: "Course exam" })).toBeNull();
    }
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(fake.rpc.mock.calls.flat()).not.toContain(
      "set_course_exam_required",
    );
  },
);
