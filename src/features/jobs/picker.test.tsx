import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import i18n from "../../lib/i18n";
import { JobPicker } from "./picker";
import { jobPickerQuery } from "./picker-api";
import { FilesPage } from "../files/files";
import { CreateGroup } from "../chat/manage";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  upload: vi.fn(),
  online: true,
  permissions: ["jobs.manage"],
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ rpc: state.rpc, from: state.from }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw Error("offline");
  },
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../files/discovery", () => ({
  DocumentExplorer: ({
    children,
  }: {
    children: (rows: never[]) => ReactNode;
  }) => children([]),
  DocumentOrganiser: () => null,
}));
vi.mock("../files/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../files/api")>()),
  uploadDocument: state.upload,
}));
const clients: QueryClient[] = [];
const first = {
  id: "d8000000-0000-4000-8000-000000000001",
  title: "Fictional permitted course",
  customer_name: "Fictional organisation",
  course_run_id: "e8000000-0000-4000-8000-000000000001",
  starts_at: null,
  time_zone: "Europe/Berlin",
};
const second = {
  ...first,
  id: "d8000000-0000-4000-8000-000000000002",
  title: "Fictional second course",
};
const cursor = {
  at: "2040-01-01T00:00:00Z",
  id: second.id,
  fingerprint: "a".repeat(32),
};
function response(data: unknown, error: unknown = null) {
  const promise = Promise.resolve({ data, error });
  return Object.assign(promise, { abortSignal: () => promise });
}
function setup(content: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  render(<QueryClientProvider client={client}>{content}</QueryClientProvider>);
  return client;
}
function mockPicker() {
  state.rpc.mockImplementation((name, args) =>
    response(
      name === "get_my_permissions"
        ? state.permissions
        : name === "chat_contacts"
          ? []
          : name === "create_chat_group"
            ? "room"
            : {
                items: args.p_cursor ? [second] : [first],
                has_more: !args.p_cursor,
                next_cursor: args.p_cursor ? null : cursor,
                selected: args.p_selected_id ? first : null,
              },
    ),
  );
}
function Harness() {
  const [value, setValue] = useState("");
  return (
    <JobPicker
      actor="actor"
      purpose="job_attachment"
      value={value}
      onChange={setValue}
    >
      {(selected) =>
        selected && (
          <input
            aria-label="Selected operation draft"
            defaultValue="Private upload draft"
          />
        )
      }
    </JobPicker>
  );
}
afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.clearAllMocks();
  state.online = true;
  state.permissions = ["jobs.manage"];
  await i18n.changeLanguage("de");
});
it("loads only explicit bounded pages and applied literal searches without reading the legacy jobs table", async () => {
  mockPicker();
  setup(<Harness />);
  const user = userEvent.setup();
  await screen.findByRole("option", { name: /Fictional permitted course/ });
  await user.type(screen.getByLabelText("Auftrag oder Kurs suchen"), "%_");
  expect(state.rpc).toHaveBeenCalledTimes(1);
  await user.click(
    screen.getByRole("button", { name: "Weitere Auswahlmöglichkeiten laden" }),
  );
  await screen.findByRole("option", { name: /Fictional second course/ });
  expect(state.rpc.mock.calls[1][1]).toMatchObject({
    p_cursor: cursor,
    p_limit: 40,
  });
  await user.click(screen.getByRole("button", { name: "Auswahl durchsuchen" }));
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(3));
  expect(state.rpc.mock.calls[2][1]).toMatchObject({
    p_search: "%_",
    p_cursor: null,
    p_purpose: "job_attachment",
  });
  expect(state.from).not.toHaveBeenCalled();
});
it("revalidates the selected exact ID before exposing the connected operation", async () => {
  let confirm!: (value: { data: unknown; error: null }) => void;
  state.rpc.mockImplementation((_name, args) =>
    args.p_selected_id
      ? Object.assign(
          new Promise((resolve) => {
            confirm = resolve;
          }),
          {
            abortSignal() {
              return this;
            },
          },
        )
      : response({
          items: [first],
          has_more: false,
          next_cursor: null,
          selected: null,
        }),
  );
  setup(<Harness />);
  const user = userEvent.setup();
  const choice = await screen.findByLabelText("Auftrag für die Datei");
  await user.selectOptions(choice, first.id);
  expect(screen.getByLabelText("Auftrag für die Datei")).toBe(choice);
  expect(choice).toBeEnabled();
  expect(choice).toHaveFocus();
  expect(choice).not.toHaveAccessibleDescription();
  expect(
    screen.queryByLabelText("Selected operation draft"),
  ).not.toBeInTheDocument();
  await act(async () =>
    confirm({
      data: {
        items: [second],
        has_more: false,
        next_cursor: null,
        selected: first,
      },
      error: null,
    }),
  );
  await screen.findByLabelText("Selected operation draft");
  expect(screen.getByLabelText("Auftrag für die Datei")).toHaveValue(first.id);
  expect(choice).toHaveAccessibleDescription(
    /Fictional permitted course.*Fictional organisation.*Ohne Termin.*Europe\/Berlin.*Durchlauf 00000001/,
  );
  expect(
    screen.getByRole("option", { name: /Fictional permitted course/ }),
  ).toBeVisible();
});
it("hides selected private content on42501 and keeps denial through a later network failure", async () => {
  let error: unknown = null;
  state.rpc.mockImplementation(() =>
    response(
      error
        ? null
        : {
            items: [first],
            has_more: false,
            next_cursor: null,
            selected: first,
          },
      error,
    ),
  );
  const client = setup(
    <JobPicker
      actor="actor"
      purpose="job_attachment"
      value={first.id}
      onChange={() => {}}
    >
      {(selected) =>
        selected && (
          <input
            aria-label="Private retained draft"
            defaultValue="Fictional secret draft"
          />
        )
      }
    </JobPicker>,
  );
  await screen.findByLabelText("Private retained draft");
  const descriptionID = screen
    .getByLabelText("Auftrag für die Datei")
    .getAttribute("aria-describedby");
  expect(document.getElementById(descriptionID!)).toBeVisible();
  client.setQueryData(["permissions", "actor"], ["jobs.manage"]);
  error = { code: "42501", message: "Revoked" };
  await act(async () => {
    await client.refetchQueries({ queryKey: ["job-picker"] });
  });
  await waitFor(() =>
    expect(
      screen.queryByLabelText("Private retained draft"),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("option", { name: /Fictional permitted/ }),
  ).not.toBeInTheDocument();
  expect(document.getElementById(descriptionID!)).toBeNull();
  expect(client.getQueryState(["permissions", "actor"])?.isInvalidated).toBe(
    true,
  );
  error = { message: "Network unavailable" };
  await userEvent.click(
    screen.getByRole("button", { name: "Erneut versuchen" }),
  );
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(3));
  expect(
    screen.queryByLabelText("Private retained draft"),
  ).not.toBeInTheDocument();
});
it("preserves a connected operation draft through a normal transport failure", async () => {
  let error: unknown = null;
  state.rpc.mockImplementation(() =>
    response(
      error
        ? null
        : {
            items: [first],
            has_more: false,
            next_cursor: null,
            selected: first,
          },
      error,
    ),
  );
  const client = setup(
    <JobPicker
      actor="actor"
      purpose="job_attachment"
      value={first.id}
      onChange={() => {}}
    >
      {(selected) =>
        selected && (
          <input
            aria-label="Private retained draft"
            defaultValue="Fictional draft"
          />
        )
      }
    </JobPicker>,
  );
  const input = await screen.findByLabelText("Private retained draft");
  await userEvent.type(input, " kept");
  error = { message: "Network unavailable" };
  await act(async () => {
    await client.refetchQueries({ queryKey: ["job-picker"] });
  });
  expect(screen.getByLabelText("Private retained draft")).toBe(input);
  expect(input).toHaveValue("Fictional draft kept");
});
it("rejects invalid cursor/commercial DTOs and cross-purpose selected metadata", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  for (const page of [
    {
      items: [{ ...first, gross_amount: 100 }],
      has_more: false,
      next_cursor: null,
      selected: null,
    },
    { items: [], has_more: true, next_cursor: null, selected: null },
    { items: [], has_more: false, next_cursor: null, selected: second },
  ]) {
    state.rpc.mockImplementation(() => response(page));
    await expect(
      client.fetchInfiniteQuery(
        jobPickerQuery("actor", "job_attachment", "", first.id),
      ),
    ).rejects.toThrow();
    client.clear();
  }
  state.rpc.mockImplementation(() =>
    response({
      items: [{ ...first, course_run_id: null }],
      has_more: false,
      next_cursor: null,
      selected: null,
    }),
  );
  await expect(
    client.fetchInfiniteQuery(
      jobPickerQuery("actor", "participant_course", "", ""),
    ),
  ).rejects.toThrow(/real course/);
});
it("the Files upload dialog never loads jobs for browsing/personal uploads and connects only a confirmed selection to the existing uploader", async () => {
  mockPicker();
  state.upload.mockResolvedValue({ id: "document" });
  setup(<FilesPage />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Datei hochladen" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(state.rpc.mock.calls.some(([name]) => name === "job_picker")).toBe(
    false,
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Freigabe"),
    "job_after",
  );
  await user.selectOptions(
    await within(dialog).findByLabelText("Auftrag für die Datei"),
    first.id,
  );
  const choose = await within(dialog).findByLabelText("Datei auswählen");
  await user.upload(
    choose,
    new File(["Fictional material"], "fictional.txt", { type: "text/plain" }),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Datei hochladen" }),
  );
  await waitFor(() =>
    expect(state.upload).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        scope: "job_after",
        jobId: first.id,
        kind: "material",
      }),
      expect.any(Function),
    ),
  );
  expect(state.from).not.toHaveBeenCalled();
});
it("topic group creation does not request offers and participant creation submits the real job binding after course validation", async () => {
  mockPicker();
  const onRoom = vi.fn();
  setup(
    <CreateGroup
      actor="actor"
      canManageCourses
      open
      onOpenChange={() => {}}
      onRoom={onRoom}
    />,
  );
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Gruppe erstellen" });
  expect(state.rpc.mock.calls.some(([name]) => name === "job_picker")).toBe(
    false,
  );
  await user.type(
    screen.getByLabelText("Gruppenname"),
    "Fictional selected participant channel",
  );
  await user.selectOptions(
    screen.getByLabelText("Art der Gruppe"),
    "participant_course",
  );
  await user.selectOptions(
    await screen.findByLabelText("Kurs für den Teilnahmechat"),
    first.id,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Gruppe erstellen" }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Gruppe erstellen" }));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "create_chat_group",
      expect.objectContaining({
        p_job_id: first.id,
        p_kind: "participant_course",
      }),
    ),
  );
  expect(onRoom).toHaveBeenCalledWith("room");
  expect(state.from).not.toHaveBeenCalled();
});
it("ordinary file accounts and topic-only group dialogs never query a privileged picker", async () => {
  state.permissions = [];
  mockPicker();
  setup(<FilesPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Datei hochladen" }),
  );
  expect(
    screen.queryByRole("option", { name: "Nach der Übernahme sichtbar" }),
  ).not.toBeInTheDocument();
  expect(state.rpc.mock.calls.some(([name]) => name === "job_picker")).toBe(
    false,
  );
});

it("keeps one choice per course run for an old job binding and localizes its explicit schedule/zone", async () => {
  const selected = {
    ...first,
    id: second.id,
    starts_at: "2060-01-01T08:00:00Z",
  };
  state.rpc.mockImplementation(() =>
    response({
      items: [{ ...first, starts_at: selected.starts_at }],
      has_more: false,
      next_cursor: null,
      selected,
    }),
  );
  setup(
    <JobPicker
      actor="actor"
      purpose="participant_course"
      value={selected.id}
      onChange={() => {}}
    />,
  );
  const choose = await screen.findByLabelText("Kurs für den Teilnahmechat");
  expect(within(choose).getAllByRole("option")).toHaveLength(2);
  expect(choose).toHaveValue(selected.id);
  expect(
    within(choose).getByRole("option", { name: /Europe\/Berlin/ }),
  ).toHaveTextContent("Durchlauf 00000001");
  expect(choose).toHaveAccessibleDescription(
    /Fictional permitted course.*Fictional organisation.*2060.*Europe\/Berlin.*Durchlauf 00000001/,
  );
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(
    screen.getByLabelText("Course for the participant channel"),
  ).toHaveValue(selected.id);
  expect(
    within(choose).getByRole("option", { name: /Europe\/Berlin/ }),
  ).toHaveTextContent("Run 00000001");
  expect(choose).toHaveAccessibleDescription(
    /Fictional permitted course.*Fictional organisation.*2060.*Europe\/Berlin.*Run 00000001/,
  );
  expect(state.rpc).toHaveBeenCalledTimes(1);
});
