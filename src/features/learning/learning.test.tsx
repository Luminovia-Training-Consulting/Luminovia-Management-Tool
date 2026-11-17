import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CourseWorkspacePage } from "./learning";
import type { CourseWorkspace } from "./api";
import i18n from "../../lib/i18n";
const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  workspace: {} as CourseWorkspace,
  error: null as unknown,
  pending: undefined as Promise<unknown> | undefined,
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "learner-a" } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
const clients: QueryClient[] = [];
function fixture(): CourseWorkspace {
  return {
    id: "course-a",
    title: "Fictional course",
    description: "Shared safe description",
    syllabus: "Linux practice",
    time_zone: "Europe/Berlin",
    venue: "https://example.invalid/class",
    delivery_type: "online",
    ended: true,
    access: {
      manager: false,
      teacher: false,
      learner: true,
      client: false,
      staff: false,
    },
    settings_version: 0,
    contact: null,
    contact_options: [],
    sessions: [],
    preparation: [],
    resources: [],
    share_options: [],
    questions: [],
    notebook: { body: "My private draft", version: 2 },
    feedback: null,
    feedback_summary: null,
    quiz: null,
    completion: null,
    roster: [],
    attendance_history: [],
    repeat_request: null,
  };
}
beforeEach(async () => {
  await i18n.changeLanguage("de");
  fake.workspace = fixture();
  fake.error = null;
  fake.pending = undefined;
  fake.rpc.mockReset().mockImplementation((name: string) => {
    const request = {
      abortSignal: () => request,
      then: (resolve: (v: unknown) => unknown) =>
        name === "course_workspace"
          ? Promise.resolve({ data: fake.workspace, error: fake.error }).then(
              resolve,
            )
          : Promise.resolve(fake.pending ?? { id: null, saved: true }).then(
              (data) => resolve({ data, error: fake.error }),
            ),
    };
    return request;
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/courses/course-a/workspace"]}>
        <Routes>
          <Route
            path="/courses/:id/workspace"
            element={<CourseWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
describe("connected course workspace", () => {
  it("keeps staff preparation and other learners' attendance controls out of the participant experience", async () => {
    fake.workspace.preparation = [
      {
        id: "staff-task",
        label: "Staff-only preparation",
        done: false,
        client_visible: true,
        version: 1,
      },
    ];
    setup();
    expect(await screen.findByText("Shared safe description")).toBeVisible();
    expect(
      screen.queryByText("Staff-only preparation"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Anwesenheit bestätigen" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Persönliche Kursnotizen")).toHaveValue(
      "My private draft",
    );
  });
  it("copies only the authorized validated teaching link after clipboard confirmation, and explains failure", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("denied"));
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    setup();
    await user.click(
      await screen.findByRole("button", { name: "Unterrichtslink kopieren" }),
    );
    expect(writeText).toHaveBeenCalledWith("https://example.invalid/class");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Unterrichtslink kopiert.",
    );
    await user.click(
      screen.getByRole("button", { name: "Unterrichtslink kopieren" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("manuell");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("offers English copy controls only for valid HTTPS online courses", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    setup();
    await user.click(
      await screen.findByRole("button", { name: "Copy teaching link" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Teaching link copied.",
    );
    expect(writeText).toHaveBeenCalledWith("https://example.invalid/class");
  });
  it("does not offer copying for an unsafe teaching URL", async () => {
    fake.workspace.venue = "javascript:alert(1)";
    setup();
    expect(await screen.findByText("Shared safe description")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Unterrichtslink kopieren" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Unterrichtslink öffnen" }),
    ).not.toBeInTheDocument();
  });
  it("does not offer a copy action for a physical course", async () => {
    fake.workspace.delivery_type = "onsite";
    setup();
    expect(await screen.findByText("Shared safe description")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Unterrichtslink kopieren" }),
    ).not.toBeInTheDocument();
  });
  it("does not expose a copy control when the server denies workspace access", async () => {
    fake.error = { code: "42501" };
    setup();
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Unterrichtslink kopieren" }),
    ).not.toBeInTheDocument();
  });
  it("stores the actor-owned notebook with its current version and confirms only after the response", async () => {
    const user = userEvent.setup();
    setup();
    const notes = await screen.findByLabelText("Persönliche Kursnotizen");
    await user.clear(notes);
    await user.type(notes, "My revised notes");
    let resolve!: (value: unknown) => void;
    fake.pending = new Promise((r) => (resolve = r));
    const form = notes.closest("form")!;
    await user.click(form.querySelector("button")!);
    expect(
      screen.queryByText("Änderung auf dem Server gespeichert."),
    ).not.toBeInTheDocument();
    expect(fake.rpc).toHaveBeenCalledWith("course_workspace_action", {
      p_run_id: "course-a",
      p_action: "notebook",
      p_payload: { body: "My revised notes" },
      p_expected_version: 2,
    });
    fake.workspace = {
      ...fake.workspace,
      notebook: { body: "My revised notes", version: 3 },
    };
    await act(async () => resolve({ id: null, saved: true }));
    await waitFor(() =>
      expect(screen.getByLabelText("Persönliche Kursnotizen")).toHaveValue(
        "My revised notes",
      ),
    );
  });
  it("waits for committed shared preparation state and exposes read-only progress to a client", async () => {
    fake.workspace.access = {
      manager: false,
      teacher: true,
      learner: false,
      client: false,
      staff: true,
    };
    fake.workspace.preparation = [
      {
        id: "task-a",
        label: "Lab accounts ready",
        done: false,
        client_visible: true,
        version: 1,
      },
    ];
    const user = userEvent.setup();
    setup();
    const checkbox = await screen.findByRole("checkbox", {
      name: "Lab accounts ready",
    });
    let resolve!: (value: unknown) => void;
    fake.pending = new Promise((r) => (resolve = r));
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    fake.workspace = {
      ...fake.workspace,
      preparation: [
        { ...fake.workspace.preparation[0], done: true, version: 2 },
      ],
    };
    await act(async () => resolve({ saved: true }));
    await waitFor(() => expect(checkbox).toBeChecked());
  });
  it("never renders retained private workspace data after a revoked read", async () => {
    const client = setup();
    expect(await screen.findByLabelText("Persönliche Kursnotizen")).toHaveValue(
      "My private draft",
    );
    fake.error = { code: "42501" };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["course-workspace"] });
    });
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Persönliche Kursnotizen"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Shared safe description"),
    ).not.toBeInTheDocument();
  });
  it("submits only chosen quiz answers and an idempotency key, preserving DE/EN cached state", async () => {
    fake.workspace.quiz = {
      version: 3,
      published: true,
      pass_percent: 80,
      max_attempts: 2,
      questions: [{ prompt: "Read directory?", options: ["ls", "rm"] }],
      attempts: 0,
      passed: false,
      last_score: null,
    };
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("radio", { name: "ls" }));
    await user.click(
      screen.getByRole("button", { name: "Antworten verbindlich abgeben" }),
    );
    await waitFor(() =>
      expect(fake.rpc).toHaveBeenCalledWith(
        "course_workspace_action",
        expect.objectContaining({
          p_action: "quiz_attempt",
          p_expected_version: 3,
          p_payload: { answers: [0], request_id: expect.any(String) },
        }),
      ),
    );
    const calls = fake.rpc.mock.calls.length;
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(screen.getByRole("heading", { name: "Mini quiz" })).toBeVisible();
    expect(fake.rpc).toHaveBeenCalledTimes(calls);
  });
});
