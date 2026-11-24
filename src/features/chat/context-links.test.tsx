/** Check communication navigation and legacy links against the existing knowledge permissions. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  CommunicationWorkspace,
  LegacyForumRoute,
} from "../../app/section-hubs";
import { ChatPage } from "./chat";
import type { ChatDirectoryFacet } from "./api";
import type { ChatRoom } from "./types";
import i18n from "../../lib/i18n";

const state = vi.hoisted(() => ({
  actor: "fictional-forum-contact",
  canAuthor: true,
  roles: ["client"] as string[],
  rooms: [] as ChatRoom[],
  facets: [] as ChatDirectoryFacet[],
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../../lib/online", () => ({
  requireOnline: () => undefined,
  useOnline: () => true,
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: async (name: string) =>
      name === "knowledge_access"
        ? { data: { can_author: state.canAuthor }, error: null }
        : { data: [], error: null },
  }),
}));
vi.mock("../../lib/queries", () => ({
  permissionsQuery: () => ({
    queryKey: ["permissions"],
    queryFn: async () => [],
  }),
  profileQuery: () => ({ queryKey: ["profile"], queryFn: async () => null }),
  userRolesQuery: () => ({
    queryKey: ["roles"],
    queryFn: async () => state.roles,
  }),
}));
vi.mock("../knowledge/api", () => ({
  knowledgeAccessQuery: () => ({
    queryKey: ["knowledge-access"],
    queryFn: async () => ({ can_author: state.canAuthor }),
  }),
}));
vi.mock("./api", () => ({
  chatDirectoryFiltersQuery: (actor: string) => ({
    queryKey: ["directory-filters", actor],
    queryFn: async () => state.facets,
  }),
  chatContactsQuery: (actor: string) => ({
    queryKey: ["chat-contacts", actor],
    queryFn: async () => [],
  }),
  chatKeys: {
    rooms: (actor: string) => ["chat-rooms", actor],
    draft: (actor: string, room: string) => ["chat-draft", actor, room],
  },
  chatRoomsQuery: (actor: string) => ({
    queryKey: ["chat-rooms", actor],
    queryFn: async () => state.rooms,
  }),
}));

vi.mock("./thread", () => ({
  ChatThread: ({
    room,
    draft,
    onDraftChange,
  }: {
    room: ChatRoom;
    draft?: string;
    onDraftChange: (value: string) => void;
  }) => (
    <>
      <h2>Open: {room.title}</h2>
      <textarea
        aria-label="Fictional draft"
        defaultValue={draft}
        onChange={(event) => onDraftChange(event.target.value)}
      />
    </>
  ),
}));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  localStorage.clear();
  state.actor = "fictional-forum-contact";
  clients.forEach((client) => client.clear());
  clients.length = 0;
  state.rooms = [];
  state.facets = [];
  vi.clearAllMocks();
});

function ForumLocation() {
  const { pathname, search, hash } = useLocation();
  return <h1>{pathname + search + hash}</h1>;
}

function renderPage(path = "/chats") {
  const client = new QueryClient();
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/chats" element={<CommunicationWorkspace />}>
            <Route index element={<ChatPage />} />
            <Route path="forum" element={<ForumLocation />} />
          </Route>
          <Route path="/forum" element={<LegacyForumRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("shows the canonical forum link only to actors allowed by knowledge_access", async () => {
  state.canAuthor = true;
  state.roles = ["client"];
  renderPage();
  expect(
    await screen.findByRole("link", { name: /^Forum(?: |$)/ }),
  ).toHaveAttribute("href", "/chats/forum");

  cleanup();
  state.canAuthor = false;
  renderPage();
  await screen.findByRole("heading", { name: "Chats" });
  expect(
    screen.queryByRole("link", { name: /^Forum(?: |$)/ }),
  ).not.toBeInTheDocument();
});

it("preserves the thread and fragment from a legacy forum link", async () => {
  state.canAuthor = true;
  renderPage("/forum?thread=fixture#reply");
  await screen.findByRole("heading", {
    name: "/chats/forum?thread=fixture#reply",
  });
  expect(screen.getByRole("link", { name: /^Forum(?: |$)/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("returns to chats when forum access is unavailable", async () => {
  state.canAuthor = false;
  renderPage("/chats/forum?thread=fixture");
  await screen.findByRole("heading", { name: "Chats" });
  expect(
    screen.queryByRole("link", { name: /^Forum(?: |$)/ }),
  ).not.toBeInTheDocument();
});

it("filters active or archived chats by category and identity without replacing the open conversation", async () => {
  await i18n.changeLanguage("en");
  const makeRoom = (
    id: string,
    title: string,
    kind: ChatRoom["kind"],
    archived = false,
  ): ChatRoom => ({
    id,
    title,
    kind,
    personal_archived: archived,
    job_id: null,
    owner_id: null,
    unread_count: 0,
    muted: false,
    last_message_at: null,
  });
  state.rooms = [
    makeRoom("course-room", "Room A", "lecturer_course"),
    makeRoom("staff-room", "Room B", "dm"),
    makeRoom("lecturer-room", "Room C", "dm", true),
    makeRoom("other-room", "Room D", "lecturer_course"),
  ];
  state.facets = [
    {
      room_id: "course-room",
      category: "course",
      facet_key: "one",
      label: "Network basics",
    },
    {
      room_id: "course-room",
      category: "company",
      facet_key: "org-a",
      label: "Fictional Training",
    },
    {
      room_id: "other-room",
      category: "course",
      facet_key: "two",
      label: "Linux basics",
    },
    {
      room_id: "other-room",
      category: "company",
      facet_key: "org-b",
      label: "Fictional Academy",
    },
    {
      room_id: "staff-room",
      category: "staff",
      facet_key: "sam",
      label: "Sam Example",
    },
    {
      room_id: "lecturer-room",
      category: "lecturer",
      facet_key: "alex",
      label: "Alex Example",
    },
    {
      room_id: "revoked-room",
      category: "company",
      facet_key: "hidden",
      label: "Unlisted company",
    },
  ];
  renderPage("/chats?room=course-room");
  const user = userEvent.setup();
  const category = await screen.findByRole("combobox", { name: "Filter by" });
  await waitFor(() => expect(category).toBeEnabled());
  await user.selectOptions(category, "company");
  expect(screen.queryByRole("option", { name: "Unlisted company" })).toBeNull();
  await user.selectOptions(screen.getByLabelText("Select company"), "org-b");
  expect(screen.getByRole("button", { name: /^Room D/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Room A/ })).toBeNull();
  expect(screen.getByRole("heading", { name: "Open: Room A" })).toBeVisible();

  await user.selectOptions(category, "course");
  await user.selectOptions(screen.getByLabelText("Select course"), "one");
  expect(screen.getByRole("button", { name: /^Room A/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Room D/ })).toBeNull();

  await user.selectOptions(category, "staff");
  await user.type(
    screen.getByRole("searchbox", { name: "Search conversations" }),
    "Sam Example",
  );
  expect(screen.getByRole("button", { name: /^Room B/ })).toBeVisible();
  await user.selectOptions(category, "lecturer");
  expect(
    screen.getByRole("heading", { name: "No matching conversations" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  await user.click(screen.getByRole("button", { name: "Archived" }));
  await user.selectOptions(category, "lecturer");
  await user.selectOptions(screen.getByLabelText("Select lecturer"), "alex");
  expect(screen.getByRole("button", { name: /^Room C/ })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Open: Room A" })).toBeVisible();
});

it("combines unread filters with room categories and remembers them only for the same account", async () => {
  await i18n.changeLanguage("en");
  state.rooms = [
    ["new", "Unseen messages", 2, false],
    ["flag", "Manually flagged", 0, true],
    ["read", "Already read", 0, false],
  ].map(([id, title, unread, manual]) => ({
    id: String(id),
    title: String(title),
    unread_count: Number(unread),
    manual_unread: Boolean(manual),
    kind: "dm",
    job_id: null,
    owner_id: null,
    muted: false,
    last_message_at: null,
    personal_archived: true,
  }));
  state.facets = state.rooms.map((room) => ({
    room_id: room.id,
    category: "staff",
    facet_key: "a8fbaa65-02e8-4cf9-ba55-69ef3879c240",
    label: "Course team",
  }));
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("button", { name: "Archived" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Filter by" }),
    "staff",
  );
  const teamFilter = screen.getByRole("option", { name: "Course team" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Select staff member" }),
    teamFilter,
  );
  await user.click(screen.getByRole("button", { name: "Unread" }));
  expect(await screen.findByText("Unseen messages")).toBeVisible();
  expect(screen.getByText("Manually flagged")).toBeVisible();
  expect(screen.queryByText("Already read")).toBeNull();

  cleanup();
  renderPage();
  expect(await screen.findByText("Manually flagged")).toBeVisible();
  expect(screen.getByRole("button", { name: "Archived" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Unread" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("combobox", { name: "Filter by" })).toHaveValue(
    "staff",
  );
  expect(
    screen.getByRole("combobox", { name: "Select staff member" }),
  ).toHaveValue("a8fbaa65-02e8-4cf9-ba55-69ef3879c240");
  cleanup();
  state.actor = "second-account";
  renderPage();
  expect(await screen.findByRole("button", { name: "Unread" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(screen.getByRole("button", { name: "Archived" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

it("keeps independent drafts when switching between two rooms", async () => {
  await i18n.changeLanguage("en");
  state.rooms = ["First room", "Second room"].map((title, index) => ({
    id: String(index),
    title,
    kind: "dm",
    job_id: null,
    owner_id: null,
    unread_count: 0,
    muted: false,
    last_message_at: null,
  }));
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("button", { name: /^First room/ }));
  await user.type(
    screen.getByRole("textbox", { name: "Fictional draft" }),
    "First draft",
  );
  await user.click(screen.getByRole("button", { name: /^Second room/ }));
  expect(screen.getByRole("textbox", { name: "Fictional draft" })).toHaveValue(
    "",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Fictional draft" }),
    "Second draft",
  );
  await user.click(screen.getByRole("button", { name: /^First room/ }));
  expect(screen.getByRole("textbox", { name: "Fictional draft" })).toHaveValue(
    "First draft",
  );
  await user.click(screen.getByRole("button", { name: /^Second room/ }));
  expect(screen.getByRole("textbox", { name: "Fictional draft" })).toHaveValue(
    "Second draft",
  );
  await i18n.changeLanguage("de");
});
