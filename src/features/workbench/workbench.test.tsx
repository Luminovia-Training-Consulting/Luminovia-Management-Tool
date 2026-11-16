import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkbenchPage } from "./workbench";
import { TaskFromMessageAction } from "./message-action";
import "../../lib/i18n";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  bulk: vi.fn(),
  template: vi.fn(),
  apply: vi.fn(),
  favourite: vi.fn(),
  items: [] as unknown[],
  templates: [] as unknown[],
  detail: null as unknown,
  online: true,
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "11111111-1111-4111-8111-111111111111" } },
  }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => mocks.online,
  requireOnline: () => {
    if (!mocks.online) throw new Error("offline");
  },
}));
vi.mock("../../lib/queries", () => ({
  profileQuery: (actor: string) => ({
    queryKey: ["profile", actor],
    queryFn: async () => ({ time_zone: "Europe/Berlin" }),
  }),
  topicsQuery: { queryKey: ["topics"], queryFn: async () => [] },
}));
vi.mock("./api", () => ({
  workKeys: (actor: string) => ["work-tasks", actor],
  tasksQuery: (actor: string, state: string) => ({
    queryKey: ["work-tasks", actor, state],
    initialPageParam: null,
    queryFn: async () => ({
      items: mocks.items,
      templates: mocks.templates,
      can_manage: false,
      assignees: [],
    }),
    getNextPageParam: () => undefined,
  }),
  taskHistoryQuery: () => ({
    queryKey: ["history"],
    queryFn: async () => [],
    enabled: false,
  }),
  workTaskDetailQuery: (actor: string, id: string | null) => ({
    queryKey: ["work-task-detail", actor, id],
    enabled: Boolean(id),
    queryFn: async () => mocks.detail,
  }),
  favouritesQuery: (actor: string, search: string) => ({
    queryKey: ["favourites", actor, search],
    queryFn: async () => ({ items: [], organisations: [] }),
  }),
  recommendationsQuery: (actor: string) => ({
    queryKey: ["recommendations", actor],
    queryFn: async () => [],
  }),
  saveTask: (...args: unknown[]) => mocks.save(...args),
  bulkTaskState: (...args: unknown[]) => mocks.bulk(...args),
  saveTemplate: (...args: unknown[]) => mocks.template(...args),
  applyTemplate: (...args: unknown[]) => mocks.apply(...args),
  setFavourite: (...args: unknown[]) => mocks.favourite(...args),
}));
const task = {
  id: "22222222-2222-4222-8222-222222222222",
  creator_id: "11111111-1111-4111-8111-111111111111",
  assignee_id: "11111111-1111-4111-8111-111111111111",
  assignee_name: "Fictional lecturer",
  title: "Existing task",
  description: "Authored task",
  scope: "private",
  state: "open",
  due_at: null,
  time_zone: "Europe/Berlin",
  source_room_id: null,
  source_message_id: null,
  version: 1,
  created_at: "2026-11-16T01:00:00Z",
  updated_at: "2026-11-16T01:00:00Z",
};
function show(path = "/workbench") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <WorkbenchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.online = true;
  mocks.items = [task];
  mocks.templates = [];
  mocks.detail = null;
  mocks.save.mockResolvedValue(task);
  mocks.bulk.mockResolvedValue(1);
  mocks.template.mockResolvedValue({ id: task.id, version: 1 });
  mocks.apply.mockResolvedValue([task.id]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("waits for server confirmation and retains task draft on a version conflict", async () => {
  mocks.save.mockRejectedValue({ code: "40001" });
  show();
  fireEvent.click(
    await screen.findByRole("button", { name: "Aufgabe bearbeiten" }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Titel"), {
    target: { value: "Edited draft" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Aufgabe speichern" }),
  );
  expect(
    await within(dialog).findByText(/zwischenzeitlich geändert/),
  ).toBeVisible();
  expect(within(dialog).getByLabelText("Titel")).toHaveValue("Edited draft");
  expect(screen.getByText("Existing task", { exact: true })).toBeVisible();
});
it("bulk actions submit exact selected revisions and do not optimistically change state", async () => {
  mocks.bulk.mockRejectedValue({ code: "40001" });
  show();
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Auswählen: Existing task" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Auswahl erledigen" }));
  await waitFor(() =>
    expect(mocks.bulk).toHaveBeenCalledWith(
      [{ id: task.id, version: 1 }],
      "done",
    ),
  );
  expect(await screen.findByText(/zwischenzeitlich geändert/)).toBeVisible();
  expect(screen.getByText(/Offen · Fictional lecturer/)).toBeVisible();
});
it("linked-message draft is private and does not copy a message body", async () => {
  show("/workbench?message=33333333-3333-4333-8333-333333333333");
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByLabelText("Titel")).toHaveValue("");
  fireEvent.change(within(dialog).getByLabelText("Titel"), {
    target: { value: "Own follow-up" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Aufgabe speichern" }),
  );
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
  expect(mocks.save.mock.calls[0][1]).toMatchObject({
    scope: "private",
    source_message_id: "33333333-3333-4333-8333-333333333333",
    description: "",
    assignee_id: task.creator_id,
  });
});
it("rejects a nonexistent Berlin DST wall time before any write", async () => {
  show();
  fireEvent.click(
    await screen.findByRole("button", { name: "Aufgabe erstellen" }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Titel"), {
    target: { value: "DST task" },
  });
  fireEvent.change(within(dialog).getByLabelText("Fällig am"), {
    target: { value: "2027-03-28T02:30" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Aufgabe speichern" }),
  );
  expect(await within(dialog).findByText(/nicht bestätigt/)).toBeVisible();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("workflow editor adds/removes structured steps without text delimiters", async () => {
  show();
  fireEvent.click(
    await screen.findByRole("button", { name: "Vorlage erstellen" }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Name der Vorlage"), {
    target: { value: "Prep workflow" },
  });
  fireEvent.change(within(dialog).getByLabelText("Aufgabentitel 1"), {
    target: { value: "Check files; keep punctuation" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Aufgabe ergänzen" }),
  );
  fireEvent.change(within(dialog).getByLabelText("Aufgabentitel 2"), {
    target: { value: "Contact client" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Vorlage speichern" }),
  );
  await waitFor(() => expect(mocks.template).toHaveBeenCalled());
  expect(mocks.template.mock.calls[0][1].items).toEqual([
    { title: "Check files; keep punctuation", days: 0 },
    { title: "Contact client", days: 0 },
  ]);
});
it("template application retries the same request identity after an unconfirmed response", async () => {
  mocks.templates = [
    {
      id: task.id,
      title: "Fictional template",
      items: [{ title: "Step", days: 1 }],
      version: 3,
      shared: false,
      archived: false,
      can_edit: true,
    },
  ];
  mocks.apply.mockRejectedValue(new Error("network"));
  show();
  fireEvent.click(
    await screen.findByRole("button", { name: "Als eigene Aufgaben anlegen" }),
  );
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Als eigene Aufgaben anlegen" }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Als eigene Aufgaben anlegen" }),
  );
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2));
  expect(mocks.apply.mock.calls[0][2]).toBe(mocks.apply.mock.calls[1][2]);
});
it("offline editing cannot be submitted", async () => {
  mocks.online = false;
  show();
  expect(
    await screen.findByRole("button", { name: "Aufgabe erstellen" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Vorlage erstellen" }),
  ).toBeDisabled();
});
it("message action links only to the explicit private task route", () => {
  render(
    <MemoryRouter>
      <TaskFromMessageAction messageId="33333333-3333-4333-8333-333333333333" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    "/workbench?message=33333333-3333-4333-8333-333333333333",
  );
});
it("opens an authorized task deep link even when the target is absent from the loaded page", async () => {
  mocks.items = [];
  mocks.detail = task;
  show(`/workbench?task=${task.id}`);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByLabelText("Titel")).toHaveValue(task.title);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Aufgabe speichern" }),
  );
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
  expect(mocks.save.mock.calls[0][0]).toBe(task.id);
  expect(mocks.save.mock.calls[0][2]).toBe(task.version);
});
it("does not display an unavailable direct task or fabricate a new-task editor", async () => {
  mocks.items = [];
  mocks.detail = null;
  show(`/workbench?task=${task.id}`);
  expect(
    await screen.findByText(/Diese Aufgabe ist nicht verfügbar/),
  ).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
});
