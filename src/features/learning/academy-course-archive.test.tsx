import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import type { CourseBulkArchiveItem } from "../operations/course-bulk-archive-schema";
import { AcademyCourseArchive } from "./academy-course-archive";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

const companyId = "ced50000-0000-4000-8000-000000000001";
const fixtures: CourseBulkArchiveItem[] = [
  {
    id: "ced50000-0000-4000-8000-000000000002",
    organisation_id: companyId,
    organisation_name: "Fictional Academy",
    title: "Fictional mathematics",
    time_zone: "Europe/Berlin",
    starts_at: "2030-04-21T06:00:00+00:00",
    published: true,
    archived_at: null,
  },
  {
    id: "ced50000-0000-4000-8000-000000000003",
    organisation_id: companyId,
    organisation_name: "Fictional Academy",
    title: "Fictional history",
    time_zone: "Australia/Brisbane",
    starts_at: "2030-04-22T06:00:00+00:00",
    published: false,
    archived_at: null,
  },
];

function renderArchive(readOnly = false) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AcademyCourseArchive actor="academy-manager" readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  let courses = fixtures;
  rpc.mockReset();
  rpc.mockImplementation((name, args) => {
    if (name === "academy_course_archive_runs") {
      return {
        abortSignal: async () => ({
          data: {
            items: courses.filter(
              ({ archived_at }) => Boolean(archived_at) === args.p_archived,
            ),
            has_more: false,
          },
          error: null,
        }),
      };
    }
    courses = courses.map((course) => ({
      ...course,
      archived_at: args.p_archive ? "2030-04-20T06:00:00+00:00" : null,
    }));
    return Promise.resolve({ data: 2, error: null });
  });
});

it("reviews the same two courses before archiving and again before restoring", async () => {
  const user = userEvent.setup();
  const archiveCalls = () =>
    rpc.mock.calls.filter(([name]) => name === "archive_course_runs");
  renderArchive();
  await user.click(await screen.findByText("Manage course archive"));
  for (const course of fixtures) {
    const checkbox = await screen.findByRole("checkbox", {
      name: new RegExp(course.title),
    });
    checkbox.focus();
    await user.keyboard(" ");
  }
  await user.click(screen.getByRole("button", { name: "Review archive" }));
  const archivePreview = within(
    screen.getByRole("dialog", { name: "Review archive" }),
  );
  expect(archivePreview.getByRole("list")).toHaveTextContent(fixtures[0].title);
  expect(archivePreview.getByRole("list")).toHaveTextContent(
    fixtures[1].organisation_name,
  );
  expect(archiveCalls()).toHaveLength(0);
  await user.click(
    archivePreview.getByRole("button", { name: "Confirm change" }),
  );
  await screen.findByText("Archive status saved.");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Courses to show" }),
    "archived",
  );
  for (const course of fixtures) {
    await user.click(
      await screen.findByRole("checkbox", { name: new RegExp(course.title) }),
    );
  }
  await user.click(screen.getByRole("button", { name: "Review restore" }));
  const restorePreview = within(
    screen.getByRole("dialog", { name: "Review restore" }),
  );
  expect(archiveCalls()).toHaveLength(1);
  await user.click(
    restorePreview.getByRole("button", { name: "Confirm change" }),
  );
  await waitFor(() => expect(archiveCalls()).toHaveLength(2));
  expect(archiveCalls()[1][1]).toEqual({
    p_archive: false,
    p_items: fixtures.map(({ id, organisation_id, published }) => ({
      id,
      organisation_id,
      published,
      archived_at: "2030-04-20T06:00:00+00:00",
    })),
  });
});

it("keeps the course archive read-only during licence grace", async () => {
  renderArchive(true);
  await userEvent.click(await screen.findByText("Manage course archive"));
  expect(await screen.findByText(fixtures[0].title)).toBeVisible();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Review archive" })).toBeNull();
});

it("does not expose course names or archive actions when course authority is denied", async () => {
  rpc.mockImplementation(() => ({
    abortSignal: async () => ({ data: null, error: { code: "42501" } }),
  }));
  renderArchive();
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("academy_course_archive_runs", {
      p_archived: false,
      p_offset: 0,
    }),
  );
  expect(screen.queryByText("Manage course archive")).toBeNull();
  expect(screen.queryByText(fixtures[0].title)).toBeNull();
});
