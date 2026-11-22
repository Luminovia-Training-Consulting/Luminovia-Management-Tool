/** Verify admin-only double confirmation, version-aware toggle and read-only management status. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompanyPremiumControl } from "./company-premium";
import type { CompanyPremiumSetting } from "./company-premium-schema";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  online: true,
  download: vi.fn(),
}));
vi.mock("../learning/api", () => ({ downloadPortalDocument: fake.download }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => undefined,
  useOnline: () => fake.online,
}));

const initial: CompanyPremiumSetting = {
  organisation_id: "c1c7235f-8f2d-49a3-898b-729ca578915e",
  enabled: false,
  version: 0,
  updated_at: null,
};
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
beforeEach(() => {
  fake.online = true;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  fake.rpc.mockImplementation(
    async (name: string, args?: Record<string, unknown>) => {
      if (name === "set_company_premium")
        return {
          data: {
            status: "updated",
            enabled: args?.p_enabled,
            version: Number(args?.p_expected_version) + 1,
          },
          error: null,
        };
      if (name === "retained_company_lms")
        return {
          data: {
            organisation_id: initial.organisation_id,
            premium_enabled: false,
            course_count: 0,
            courses: [],
          },
          error: null,
        };
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  );
});

function control(isAdmin: boolean, setting = initial) {
  return (
    <QueryClientProvider client={client}>
      <CompanyPremiumControl
        actor="fictional-admin"
        setting={setting}
        isAdmin={isAdmin}
      />
    </QueryClientProvider>
  );
}

function mount(isAdmin: boolean, setting = initial) {
  return render(control(isAdmin, setting));
}

it("requires both confirmations before an admin command and sends no command on cancel", async () => {
  mount(true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("switch", { name: "Premium LMS" }));
  expect(
    await screen.findByRole("dialog", { name: "Premium LMS aktivieren?" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "set_company_premium",
    expect.anything(),
  );
  await user.click(
    screen.getByRole("button", { name: "Premium LMS jetzt einschalten" }),
  );
  expect(
    await screen.findByText("Premium-Einstellung wurde gespeichert."),
  ).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledTimes(1);
  expect(fake.rpc).toHaveBeenCalledWith(
    "set_company_premium",
    expect.objectContaining({
      p_organisation_id: initial.organisation_id,
      p_enabled: true,
      p_expected_version: 0,
      p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }),
  );
});

it("shows status without toggle or retained-data access for management", async () => {
  mount(false);
  expect(await screen.findByText("Premium LMS AUS")).toBeVisible();
  expect(
    screen.getByText("Nur eine aktive Administration darf Premium umschalten."),
  ).toBeVisible();
  expect(
    screen.queryByRole("switch", { name: "Premium LMS" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Beibehaltene Kursdaten ansehen" }),
  ).not.toBeInTheDocument();
  expect(fake.rpc).not.toHaveBeenCalled();
});

/** Recreate a strict, fictional retained response without course people or file data. */
function retainedResponse(title: string) {
  return {
    error: null,
    data: {
      organisation_id: initial.organisation_id,
      premium_enabled: false,
      course_count: 1,
      courses: [
        {
          run_id: "62d82643-5082-403b-a45f-407d854eba58",
          title,
          archived_at: null,
          sessions: 1,
          enrolments: 0,
          resources: [],
          attendance_entries: 0,
          course_group_messages: 0,
          questions: 0,
          quiz_attempts: 0,
          completion_records: 0,
        },
      ],
    },
  };
}

it("opens the scoped read-only register only after an audit reason and discards it on permission loss", async () => {
  const retained = retainedResponse("Fictional retained course");
  const [course] = retained.data.courses;
  course.attendance_entries = 1;
  const session = "af85b06a-2eaf-42b3-8fb6-376007fb3eca";
  const learner = "2468a606-d5ee-4b97-8ad4-f54df3f6a56d";
  const startsAt = "2026-05-01T10:00:00Z";
  fake.rpc
    .mockResolvedValueOnce(retained)
    .mockResolvedValueOnce({
      error: null,
      data: {
        time_zone: "Europe/Berlin",
        items: [
          {
            session_id: session,
            user_id: learner,
            name: "Fictional attendee",
            starts_at: startsAt,
            ends_at: "2026-05-01T11:00:00Z",
            status: "excused",
            arrival_at: null,
            departure_at: null,
            note: "Fictional archived note",
          },
        ],
        next_cursor: {
          starts_at: startsAt,
          session_id: session,
          user_id: learner,
        },
      },
    })
    .mockResolvedValueOnce({
      error: null,
      data: { time_zone: "Europe/Berlin", items: [], next_cursor: null },
    });
  const user = userEvent.setup();
  const mounted = mount(true);
  await user.click(
    screen.getByRole("button", { name: "Beibehaltene Kursdaten ansehen" }),
  );
  const inspect = await screen.findByRole("button", {
    name: "Anwesenheit im Archiv ansehen",
  });
  expect(inspect).toBeDisabled();
  await user.type(
    screen.getByLabelText("Grund für die Anwesenheitseinsicht"),
    "Fiktionale Prüfung",
  );
  await user.click(inspect);
  expect(await screen.findByText("Fictional attendee")).toBeVisible();
  expect(screen.getByText("Fictional archived note")).toBeVisible();
  expect(fake.rpc).toHaveBeenNthCalledWith(
    2,
    "inspect_retained_course_attendance",
    {
      p_organisation_id: initial.organisation_id,
      p_run_id: course.run_id,
      p_reason: "Fiktionale Prüfung",
      p_after_start: null,
      p_after_session_id: null,
      p_after_user_id: null,
    },
  );
  expect(
    screen.queryByRole("button", { name: "Speichern" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Nächste Anwesenheitseinträge" }),
  );
  expect(
    await screen.findByText("Keine gespeicherten Einträge auf dieser Seite."),
  ).toBeVisible();
  expect(fake.rpc).toHaveBeenNthCalledWith(
    3,
    "inspect_retained_course_attendance",
    {
      p_organisation_id: initial.organisation_id,
      p_run_id: course.run_id,
      p_reason: "Fiktionale Prüfung",
      p_after_start: startsAt,
      p_after_session_id: session,
      p_after_user_id: learner,
    },
  );
  mounted.rerender(control(false));
  expect(
    screen.queryByText("Keine gespeicherten Einträge auf dieser Seite."),
  ).not.toBeInTheDocument();
});

it("inspects and downloads exact archived course files only while Premium is off", async () => {
  const retained = retainedResponse("Fictional retained course");
  const [course] = retained.data.courses;
  const file = {
    file_kind: "exam",
    id: "af85b06a-2eaf-42b3-8fb6-376007fb3eca",
    version_id: "2468a606-d5ee-4b97-8ad4-f54df3f6a56d",
    version: 2,
    name: "Fiktionale Prüfung.pdf",
    audience: "exam_staff",
    withdrawn: true,
  };
  const reason = "Fiktionale Archivprüfung";
  fake.download.mockResolvedValue(undefined);
  fake.rpc
    .mockResolvedValueOnce(retained)
    .mockResolvedValueOnce({
      error: null,
      data: {
        items: [file],
        next_cursor: { file_kind: file.file_kind, id: file.id },
      },
    })
    .mockResolvedValueOnce({
      error: null,
      data: { items: [], next_cursor: null },
    });
  const user = userEvent.setup();
  const mounted = mount(true);
  await user.click(
    screen.getByRole("button", { name: "Beibehaltene Kursdaten ansehen" }),
  );

  const inspect = await screen.findByRole("button", {
    name: "Kursdateien ansehen",
  });
  expect(inspect).toBeDisabled();
  await user.type(
    screen.getByLabelText("Grund für die Einsicht in die Kursdateien"),
    reason,
  );
  await user.click(inspect);
  const download = await screen.findByRole("button", {
    name: file.name + " herunterladen",
  });
  expect(screen.getByText("Aus dem Kurs entfernt")).toBeVisible();
  await user.click(download);
  expect(fake.download).toHaveBeenCalledWith(
    {
      kind: "retained_course_file",
      organisation_id: initial.organisation_id,
      run_id: course.run_id,
      file_kind: file.file_kind,
      id: file.id,
      version_id: file.version_id,
      reason,
    },
    file.name,
    expect.any(AbortSignal),
  );
  const scope = {
    p_organisation_id: initial.organisation_id,
    p_run_id: course.run_id,
    p_reason: reason,
  };
  expect(fake.rpc).toHaveBeenNthCalledWith(2, "inspect_retained_course_files", {
    ...scope,
    p_after_kind: null,
    p_after_id: null,
  });

  await user.click(screen.getByRole("button", { name: "Nächste Kursdateien" }));
  expect(
    await screen.findByText(
      /keine archivierten Prüfungs- oder Materialdateien/,
    ),
  ).toBeVisible();
  expect(fake.rpc).toHaveBeenNthCalledWith(3, "inspect_retained_course_files", {
    ...scope,
    p_after_kind: file.file_kind,
    p_after_id: file.id,
  });
  mounted.rerender(control(true, { ...initial, enabled: true, version: 1 }));
  expect(inspect).not.toBeInTheDocument();
});

it.each(["permission", "connection"] as const)(
  "discards the open retained summary when %s is lost and audits a new read on reopening",
  async (loss) => {
    const oldTitle = "Fictional previous summary";
    const newTitle = "Fictional newly authorised summary";
    let completeNext: (
      result: ReturnType<typeof retainedResponse>,
    ) => void = () => undefined;
    const nextResponse = new Promise<ReturnType<typeof retainedResponse>>(
      (resolve) => {
        completeNext = resolve;
      },
    );
    fake.rpc
      .mockResolvedValueOnce(retainedResponse(oldTitle))
      .mockReturnValueOnce(nextResponse);

    const user = userEvent.setup();
    const launcher = "Beibehaltene Kursdaten ansehen";
    const mounted = mount(true);
    await user.click(screen.getByRole("button", { name: launcher }));
    expect(await screen.findByText(oldTitle)).toBeVisible();

    fake.online = loss !== "connection";
    mounted.rerender(control(loss !== "permission"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(oldTitle)).not.toBeInTheDocument();
    if (loss === "connection") {
      expect(screen.getByRole("button", { name: launcher })).toBeDisabled();
    } else {
      expect(
        screen.queryByRole("button", { name: launcher }),
      ).not.toBeInTheDocument();
    }

    fake.online = true;
    mounted.rerender(control(true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: launcher }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.queryByText(oldTitle)).not.toBeInTheDocument();
    expect(fake.rpc).toHaveBeenCalledTimes(2);
    expect(fake.rpc).toHaveBeenNthCalledWith(2, "retained_company_lms", {
      p_organisation_id: initial.organisation_id,
    });
    completeNext(retainedResponse(newTitle));
    expect(await screen.findByText(newTitle)).toBeVisible();
  },
);

it("sends no toggle when cancelled and applies the same confirmations when disabling", async () => {
  mount(true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("switch", { name: "Premium LMS" }));
  await user.click(await screen.findByRole("button", { name: "Abbrechen" }));
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "set_company_premium",
    expect.anything(),
  );
  expect(screen.getByText("Premium LMS AUS")).toBeVisible();

  cleanup();
  mount(true, { ...initial, enabled: true, version: 1 });
  await user.click(screen.getByRole("switch", { name: "Premium LMS" }));
  await user.click(await screen.findByRole("button", { name: "Weiter" }));
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "set_company_premium",
    expect.anything(),
  );
  await user.click(
    screen.getByRole("button", { name: "Premium LMS jetzt ausschalten" }),
  );
  expect(
    await screen.findByText("Premium-Einstellung wurde gespeichert."),
  ).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith(
    "set_company_premium",
    expect.objectContaining({
      p_enabled: false,
      p_expected_version: 1,
    }),
  );
});
