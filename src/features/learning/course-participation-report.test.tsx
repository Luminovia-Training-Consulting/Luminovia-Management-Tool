import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CourseParticipationReport } from "./course-participation-report";

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(),
  download: vi.fn(),
  online: true,
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fixture.rpc }) }));
vi.mock("../../lib/online", () => ({ useOnline: () => fixture.online }));
vi.mock("../commercial/api", () => ({ downloadCsv: fixture.download }));

const courseId = "ef89205c-bc11-47bf-8aab-afdc2a0ee279";
const firstRow = {
  user_id: "b3de9970-cdb1-4b4e-8b55-3af2c0e25c94",
  participant_id: "FICT1",
  name: "Fictional learner A",
  enrolment: "completed",
  present: 2,
  absent: 1,
  excused: 0,
  completion: "issued",
};
const secondRow = {
  ...firstRow,
  user_id: "bcc69003-19fc-405d-8404-6f3e68a243cd",
  participant_id: "FICT2",
  name: "Fictional learner B",
  completion: "not_issued",
};

function open() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <CourseParticipationReport courseId={courseId} />
    </QueryClientProvider>,
  );
}

function firstPage() {
  fixture.rpc.mockResolvedValueOnce({
    data: {
      course_id: courseId,
      session_count: 3,
      rows: [firstRow],
      next_after: firstRow.user_id,
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  fixture.rpc.mockReset();
  fixture.online = true;
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

it("publishes a localised CSV only after fetching each authorised page", async () => {
  firstPage();
  fixture.rpc.mockResolvedValueOnce({
    data: {
      course_id: courseId,
      session_count: 3,
      rows: [secondRow],
      next_after: null,
    },
  });
  open();
  await userEvent.click(
    screen.getByRole("button", { name: "Export participation report as CSV" }),
  );
  await waitFor(() => expect(fixture.download).toHaveBeenCalledTimes(1));
  expect(fixture.rpc).toHaveBeenNthCalledWith(
    2,
    "academy_course_participation_report",
    {
      p_run_id: courseId,
      p_after_user_id: firstRow.user_id,
      p_limit: 200,
    },
  );
  expect(fixture.download.mock.calls[0][1]).toEqual([
    [
      "Participant",
      "Participant ID",
      "Enrolment",
      "Scheduled sessions",
      "Present",
      "Absent",
      "Excused",
      "Completion record",
    ],
    [firstRow.name, "FICT1", "Completed", "3", "2", "1", "0", "Issued"],
    [secondRow.name, "FICT2", "Completed", "3", "2", "1", "0", "Not issued"],
  ]);
});

it("discards earlier pages when the server revokes scope before the export settles", async () => {
  firstPage();
  fixture.rpc.mockResolvedValueOnce({ error: new Error("Denied") });
  open();
  await userEvent.click(
    screen.getByRole("button", { name: "Export participation report as CSV" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not export the participation report.",
  );
  expect(fixture.download).not.toHaveBeenCalled();
});

it("disables the German export action when offline", async () => {
  fixture.online = false;
  await i18n.changeLanguage("de");
  open();
  expect(
    screen.getByRole("button", {
      name: "Teilnahmebericht als CSV exportieren",
    }),
  ).toBeDisabled();
  expect(fixture.rpc).not.toHaveBeenCalled();
});
