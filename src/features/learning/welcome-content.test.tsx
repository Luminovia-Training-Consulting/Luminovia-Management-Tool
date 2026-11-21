import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CourseWelcomeContent } from "./welcome-content";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const first = {
  version: 2,
  description: "Fictional course description",
  objectives: "",
  joining_instructions: "",
  published_at: null,
};

afterEach(() => {
  cleanup();
  rpc.mockReset();
});

async function view(canEdit: boolean) {
  await i18n.changeLanguage("en");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CourseWelcomeContent
        actor="fictional"
        courseId="course"
        zone="UTC"
        canEdit={canEdit}
      />
    </QueryClientProvider>,
  );
  await screen.findByText(first.description);
}

it("shows only the published version to a learner", async () => {
  rpc.mockReturnValue({
    abortSignal: async () => ({ data: first, error: null }),
  });
  await view(false);
  expect(
    screen.queryByRole("button", { name: "Edit welcome content" }),
  ).not.toBeInTheDocument();
  expect(rpc.mock.calls).toEqual([
    ["course_welcome_content", { p_run_id: "course" }],
  ]);
});

it("previews the edited content privately before publishing the opened revision", async () => {
  let current = first;
  rpc.mockImplementation((name) => {
    if (name === "course_welcome_content") {
      return { abortSignal: async () => ({ data: current, error: null }) };
    }
    current = { ...first, description: "New description", version: 3 };
    return Promise.resolve({ data: current, error: null });
  });
  await view(true);
  fireEvent.click(screen.getByRole("button", { name: "Edit welcome content" }));
  fireEvent.change(screen.getByLabelText("Course description"), {
    target: { value: "New description" },
  });
  fireEvent.change(screen.getByLabelText("Heading"), {
    target: { value: "Welcome to our workshop" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByText("Welcome to our workshop")).toBeVisible();
  expect(
    rpc.mock.calls.every(([name]) => name === "course_welcome_content"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  await screen.findByText("New description");
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("publish_course_welcome_content", {
      p_run_id: "course",
      p_expected_version: 2,
      p_payload: {
        heading: "Welcome to our workshop",
        description: "New description",
        objectives: "",
        joining_instructions: "",
        welcome_message: "",
        schedule_information: "",
        contact_instructions: "",
        protect_instructions: false,
        attachment_ids: [],
      },
    }),
  );
});

it("keeps protected instructions read-only for an assigned instructor", async () => {
  rpc.mockReturnValue({
    abortSignal: async () => ({
      data: {
        ...first,
        protect_instructions: true,
        joining_instructions: "Existing company instructions",
      },
      error: null,
    }),
  });
  await view(true);
  fireEvent.click(screen.getByRole("button", { name: "Edit welcome content" }));
  expect(screen.getByLabelText("Joining instructions")).toHaveAttribute(
    "readonly",
  );
  expect(screen.getByLabelText("Course description")).not.toHaveAttribute(
    "readonly",
  );
  expect(
    screen.queryByRole("checkbox", { name: /protect schedule/i }),
  ).not.toBeInTheDocument();
});
