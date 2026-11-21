/** Exercise the dedicated app entrance, route selection and revoked browser data. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
  expect(document.querySelector('input[type="file"]')).toBeNull();
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
  expect(
    screen.queryByRole("button", { name: /acknowledge|unshare/i }),
  ).toBeNull();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(fake.from).not.toHaveBeenCalled();
  expect(fake.rpc.mock.calls.slice(0, 3).map(([name]) => name)).toEqual([
    "installation_capabilities",
    "portal_access",
    "my_course_workspaces",
  ]);
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
