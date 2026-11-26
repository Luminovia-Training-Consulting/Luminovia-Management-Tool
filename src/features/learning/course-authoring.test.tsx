import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CourseAuthoring } from "./course-authoring";
import type { CourseContentStudio } from "./api";
import "./i18n";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: mocks.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: vi.fn(),
  useOnline: () => true,
}));

const moduleId = "8f9d9d23-59d7-4cb4-a996-53eb828f92c1";
const lessonId = "6d1bb289-55c2-4e19-8b2a-3b0a573df4a6";
const learnerId = "9587bbd4-cdb1-44cf-b525-18e0b9213ce2";
const body = { type: "doc", content: [{ type: "paragraph" }] };
const publishedContent = {
  modules: [
    {
      id: moduleId,
      title: "Published module",
      description: "Participant-visible content",
      lessons: [
        {
          id: lessonId,
          title: "Published lesson",
          objectives: "Read the material",
          duration_minutes: 20,
          body,
        },
      ],
    },
  ],
};

let studio: CourseContentStudio;
let rejectSave: boolean;

function mount(editable: boolean, manager = false) {
  const router = createMemoryRouter(
    [
      {
        path: "/course",
        element: (
          <>
            <CourseAuthoring
              actor="fictional-actor"
              courseId="fictional-course"
              editable={editable}
              manager={manager}
              roster={[
                {
                  user_id: learnerId,
                  name: "Fictional learner",
                  status: "enrolled",
                  completion_id: null,
                  sessions: [],
                },
              ]}
            />
            <Link to="/next">Navigate away</Link>
          </>
        ),
      },
      { path: "/next", element: <h1>Next screen</h1> },
    ],
    { initialEntries: ["/course"] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  rejectSave = false;
  studio = {
    can_edit: true,
    published_version: 1,
    published_content: publishedContent,
    published_at: "2026-11-25T10:00:00Z",
    draft_version: 0,
    draft_base_version: 1,
    draft_content: null,
    versions: [
      { version: 1, published_at: "2026-11-25T10:00:00Z", module_count: 1 },
    ],
  };
  mocks.rpc.mockImplementation((name, args) => {
    if (name === "course_content_studio")
      return { abortSignal: async () => ({ data: studio, error: null }) };
    if (args.p_action === "save_draft") {
      if (rejectSave)
        return Promise.resolve({ data: null, error: { code: "PT409" } });
      studio = {
        ...studio,
        draft_version: studio.draft_version + 1,
        draft_content: args.p_payload.content,
      };
    } else if (args.p_action === "publish") {
      studio = {
        ...studio,
        published_version: studio.published_version + 1,
        published_content: studio.draft_content!,
        draft_version: 0,
        draft_base_version: studio.published_version + 1,
        draft_content: null,
        versions: [
          ...studio.versions,
          {
            version: studio.published_version + 1,
            published_at: "2026-11-26T10:00:00Z",
            module_count: studio.draft_content!.modules.length,
          },
        ],
      };
    }
    return Promise.resolve({ data: studio, error: null });
  });
});

afterEach(() => {
  cleanup();
  mocks.rpc.mockReset();
});

it("shows only the enrolled participant's pinned publication", async () => {
  studio = {
    ...studio,
    can_edit: false,
    draft_content: null,
    draft_version: 0,
    versions: [],
  };
  await i18n.changeLanguage("de");
  mount(false);
  expect(
    await screen.findByRole("heading", { name: "Published module" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Published lesson" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Save draft" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Draft · revision/)).not.toBeInTheDocument();
  expect(mocks.rpc).toHaveBeenCalledWith("course_content_studio", {
    p_run_id: "fictional-course",
  });
});

it("copies modules and lessons, moves a copy and saves it without editing the publication", async () => {
  mount(true);
  fireEvent.click(
    await screen.findByRole("button", { name: "Published module" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Duplicate module" }));
  fireEvent.change(screen.getByLabelText("Module title"), {
    target: { value: "Module copy" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Published module" }));
  const [original] = screen.getAllByRole("button", {
    name: "Published lesson",
  });
  fireEvent.click(original);
  fireEvent.click(screen.getByRole("button", { name: "Duplicate lesson" }));
  fireEvent.change(screen.getByLabelText("Lesson title"), {
    target: { value: "Moved lesson copy" },
  });
  const move = screen.getByRole("button", {
    name: "Move to destination module",
  });
  expect(move).toBeDisabled();
  const target = screen.getByRole("option", {
    name: "2. Module copy",
  }) as HTMLOptionElement;
  fireEvent.change(screen.getByLabelText("Destination module"), {
    target: { value: target.value },
  });
  fireEvent.click(move);
  expect(screen.getByLabelText("Lesson title")).toHaveValue(
    "Moved lesson copy",
  );

  fireEvent.click(screen.getByRole("button", { name: "Participant preview" }));
  const compact = screen.getByRole("button", { name: "Narrow view" });
  fireEvent.click(compact);
  expect(compact).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("heading", { name: "Moved lesson copy" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Wide view" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

  await screen.findByText("The draft was saved.");
  expect(studio.published_content).toEqual(publishedContent);
  const [source, destination] = studio.draft_content!.modules;
  expect(source.lessons.map((lesson) => lesson.id)).toEqual([lessonId]);
  expect(destination.id).not.toBe(source.id);
  expect(destination.lessons.map((lesson) => lesson.title)).toEqual([
    "Published lesson",
    "Moved lesson copy",
  ]);
  expect(
    new Set([lessonId, ...destination.lessons.map((lesson) => lesson.id)]).size,
  ).toBe(3);
  expect(destination.lessons.map((lesson) => lesson.body)).toEqual([
    body,
    body,
  ]);
});

it("saves and publishes an edited module, then explicitly migrates one active learner", async () => {
  mount(true, true);
  await screen.findByRole("heading", { name: "Course content" });
  fireEvent.click(screen.getByRole("button", { name: "Add module" }));
  fireEvent.change(screen.getByLabelText("Module title"), {
    target: { value: "Fictional new module" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add lesson" }));
  fireEvent.change(screen.getByLabelText("Lesson title"), {
    target: { value: "Fictional new lesson" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith(
      "course_content_action",
      expect.objectContaining({
        p_run_id: "fictional-course",
        p_action: "save_draft",
        p_payload: expect.objectContaining({
          published_version: 1,
          draft_version: 0,
          content: expect.objectContaining({ modules: expect.any(Array) }),
        }),
      }),
    ),
  );
  const publish = await screen.findByRole("button", { name: "Publish" });
  await waitFor(() => expect(publish).toBeEnabled());
  fireEvent.click(publish);
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith(
      "course_content_action",
      expect.objectContaining({
        p_action: "publish",
        p_payload: { published_version: 1, draft_version: 1 },
      }),
    ),
  );

  fireEvent.change(screen.getByLabelText("Select an enrolled participant"), {
    target: { value: learnerId },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Move selected participant to this revision",
    }),
  );
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith(
      "course_content_action",
      expect.objectContaining({
        p_action: "migrate",
        p_payload: { user_id: learnerId, target_version: 2 },
      }),
    ),
  );
});

it("blocks leaving a dirty draft until the author keeps editing or discards it", async () => {
  mount(true);
  await screen.findByRole("heading", { name: "Course content" });
  fireEvent.click(screen.getByRole("button", { name: "Add module" }));
  const unload = new Event("beforeunload", { cancelable: true });
  expect(window.dispatchEvent(unload)).toBe(false);

  fireEvent.click(screen.getByRole("link", { name: "Navigate away" }));
  const confirmation = await screen.findByRole("dialog", {
    name: "Discard unsaved course changes?",
  });
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(confirmation).not.toBeInTheDocument();
  expect(screen.getByLabelText("Module title")).toHaveValue("New module");

  fireEvent.click(screen.getByRole("link", { name: "Navigate away" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(
    await screen.findByRole("heading", { name: "Next screen" }),
  ).toBeVisible();
  expect(
    window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  ).toBe(true);
});

it("autosaves a valid draft without publishing it", async () => {
  mount(true);
  fireEvent.click(await screen.findByRole("button", { name: "Add module" }));
  expect(
    await screen.findByText("The draft was saved.", {}, { timeout: 4000 }),
  ).toBeVisible();
  expect(studio.draft_content?.modules.at(-1)?.title).toBe("New module");
  expect(studio.published_version).toBe(1);
});

it("keeps local changes after a conflict until the author explicitly reloads", async () => {
  rejectSave = true;
  mount(true);
  fireEvent.click(await screen.findByRole("button", { name: "Add module" }));
  fireEvent.change(screen.getByLabelText("Module title"), {
    target: { value: "Local edit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  const reload = await screen.findByRole("button", {
    name: "Discard local edits and reload",
  });
  expect(screen.getByLabelText("Module title")).toHaveValue("Local edit");
  expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  studio = { ...studio, draft_version: 1, draft_content: publishedContent };
  fireEvent.click(reload);
  expect(await screen.findByText("Draft · revision 1")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Local edit" }),
  ).not.toBeInTheDocument();
});
