import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { LearningPrograms } from "./learning-programs";
import type { LearningProgramDetail } from "./learning-program-schema";

const id = "ec948826-1e20-4d2b-832d-ab6872049d3e";
const organisation = "3454f620-3546-4b18-910d-b6513123f6ef";
const first = "5f45eb6a-76c7-4c2f-869c-77ad4269b457";
const second = "a66377ad-ad35-47d2-bc3f-33fb716f5e97";
const firstReceipt = "b585a406-3b4d-421e-8a13-817655fc466b";
const secondReceipt = "73b010dc-3e98-4f37-a0e4-a9d3e57ced12";
const fixture = vi.hoisted(() => ({
  detail: undefined as LearningProgramDetail | undefined,
  start: vi.fn(),
  save: vi.fn(),
  place: vi.fn(),
}));
vi.mock("./learning-program-api", () => ({
  learningProgramsKey: (actor: string) => ["programmes", actor],
  learningProgramsQuery: (actor: string, args: object) => ({
    queryKey: ["programmes", actor, args],
    queryFn: async () => ({
      programs: [],
      detail: fixture.detail ?? null,
      organisations: [{ id: organisation, name: "Fictional Academy" }],
      courses: [
        { id: first, title: "Foundation", starts_at: null },
        { id: second, title: "Workshop", starts_at: null },
      ],
      candidates: [],
      writable: true,
    }),
  }),
  learningProgramClassProgressQuery: (actor: string, program: string) => ({
    queryKey: ["programmes", actor, "class-progress", program],
    queryFn: async () => [
      {
        class_id: first,
        class_name: "Class A",
        participants: 4,
        participants_completed: 2,
        module_slots: 8,
        modules_completed: 6,
      },
      {
        class_id: second,
        class_name: "Class B",
        participants: 5,
        participants_completed: 0,
        module_slots: 10,
        modules_completed: 1,
      },
    ],
  }),
  startLearningProgramCourse: fixture.start,
  placeLearningProgramParticipant: fixture.place,
  saveLearningProgram: fixture.save,
  enrolLearningProgram: vi.fn(),
}));

function mount(program?: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter
        initialEntries={[
          `/learning?view=programmes${program ? `&program=${program}` : ""}`,
        ]}
      >
        <LearningPrograms actor={id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const learner = (): LearningProgramDetail => ({
  id,
  title: "Fictional programme",
  organisation_name: "Fictional Academy",
  archived: false,
  organisation_id: organisation,
  sequential: true,
  version: 1,
  description: "",
  manage: false,
  can_write: false,
  can_edit: false,
  learner_name: "Fictional learner",
  roster: null,
  steps: null,
  progress: {
    completed: 0,
    total: 2,
    completed_at: null,
    steps: [
      {
        course_id: first,
        title: "Foundation",
        receipt_id: null,
        state: "in_progress",
        can_open: true,
      },
      {
        course_id: second,
        title: "Workshop",
        receipt_id: null,
        state: "locked",
        can_open: false,
      },
    ],
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  fixture.detail = undefined;
  fixture.start.mockResolvedValue(undefined);
  fixture.save.mockResolvedValue(id);
  fixture.place.mockResolvedValue(undefined);
  await i18n.changeLanguage("de");
});
afterEach(cleanup);

it("saves an ordered programme of distinct selected course runs", async () => {
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Programm anlegen" }),
  );
  fireEvent.change(screen.getByLabelText("Programmtitel"), {
    target: { value: "Fictional teaching programme" },
  });
  const picker = await screen.findByLabelText("Kursdurchlauf");
  for (const course of [second, first]) {
    fireEvent.change(picker, { target: { value: course } });
    fireEvent.click(screen.getByRole("button", { name: "Kurs hinzufügen" }));
  }
  fireEvent.click(screen.getAllByRole("button", { name: "Nach oben" })[1]);
  fireEvent.click(screen.getByRole("button", { name: "Programm speichern" }));
  await waitFor(() =>
    expect(fixture.save).toHaveBeenCalledWith(
      {
        p_program_id: expect.any(String),
        p_organisation_id: organisation,
        p_title: "Fictional teaching programme",
        p_description: "",
        p_sequential: true,
        p_course_ids: [first, second],
        p_archived: false,
        p_expected_version: 0,
      },
      expect.anything(),
    ),
  );
});

it("shows locked prerequisites without exposing a link or completion proof", async () => {
  fixture.detail = learner();
  mount(id);
  expect(await screen.findByText(/Voraussetzungen offen/)).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Kurs öffnen" }).getAttribute("href"),
  ).toContain(first);
  expect(screen.queryByText("Programmabschluss")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Kurs freischalten" }),
  ).toBeNull();
});

it("activates the exact course when server progress reports its prerequisites complete", async () => {
  const view = learner();
  view.progress!.completed = 1;
  view.progress!.steps[0].state = "completed";
  view.progress!.steps[0].receipt_id = firstReceipt;
  view.progress!.steps[1].state = "ready";
  fixture.detail = view;
  await i18n.changeLanguage("en");
  mount(id);
  fireEvent.click(await screen.findByRole("button", { name: "Unlock course" }));
  await waitFor(() =>
    expect(fixture.start).toHaveBeenCalledWith(
      { p_program_id: id, p_course_id: second },
      expect.anything(),
    ),
  );
});

it("renders the whole programme proof only when the server validates every course receipt", async () => {
  const view = learner();
  view.progress!.completed = 2;
  view.progress!.completed_at = "2026-11-24T02:00:00Z";
  view.progress!.steps.forEach((step, index) => {
    step.state = "completed";
    step.receipt_id = [firstReceipt, secondReceipt][index];
    step.can_open = true;
  });
  fixture.detail = view;
  mount(id);
  expect(
    await screen.findByRole("heading", { name: "Programmabschluss" }),
  ).toBeVisible();
  expect(screen.getByText(new RegExp(secondReceipt))).toBeVisible();
  expect(
    screen.getByRole("button", {
      name: "Nachweis drucken / als PDF speichern",
    }),
  ).toBeVisible();
});

it("shows correct class totals and filters the manager view without changing enrolments", async () => {
  fixture.detail = {
    ...learner(),
    manage: true,
    learner_name: null,
    progress: null,
    roster: [],
  };
  mount(id);
  expect(
    await screen.findByRole("heading", {
      name: "Gesamtfortschritt pro Klasse",
    }),
  ).toBeVisible();
  expect(
    await screen.findByText(
      "2 von 4 Teilnehmenden haben das Programm abgeschlossen.",
    ),
  ).toBeVisible();
  expect(screen.getByText("6 von 8 Kursabschlüssen erreicht.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Class B" })).toBeVisible();
  fireEvent.change(screen.getByLabelText("Klasse filtern"), {
    target: { value: second },
  });
  expect(screen.queryByRole("heading", { name: "Class A" })).toBeNull();
  expect(screen.getByText("1 von 10 Kursabschlüssen erreicht.")).toBeVisible();
});

it("saves the existing membership version when changing a learner's class", async () => {
  const current = learner();
  fixture.detail = {
    ...current,
    manage: true,
    can_write: true,
    progress: null,
    learner_name: null,
    classes: [
      { id: first, name: "Class A" },
      { id: second, name: "Class B" },
    ],
    roster: [
      {
        id,
        name: "Fictional learner",
        active: true,
        placement: { class_id: first, version: 4 },
        progress: current.progress!,
      },
    ],
  };
  mount(id);
  fireEvent.change(
    await screen.findByLabelText("Person für Klassenzuordnung"),
    { target: { value: id } },
  );
  expect(screen.getByLabelText("Klasse für die Person")).toHaveValue(first);
  fireEvent.change(screen.getByLabelText("Klasse für die Person"), {
    target: { value: second },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Klassenzuordnung speichern" }),
  );
  await waitFor(() =>
    expect(fixture.place).toHaveBeenCalledWith(
      {
        p_organisation_id: organisation,
        p_user_id: id,
        p_class_id: second,
        p_expected_version: 4,
      },
      expect.anything(),
    ),
  );
});
