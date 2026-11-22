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
  canAuthor: true,
  roles: ["client"] as string[],
  rooms: [] as ChatRoom[],
  facets: [] as ChatDirectoryFacet[],
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-forum-contact" } } }),
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
  chatKeys: { rooms: (actor: string) => ["chat-rooms", actor] },
  chatRoomsQuery: (actor: string) => ({
    queryKey: ["chat-rooms", actor],
    queryFn: async () => state.rooms,
  }),
}));

vi.mock("./thread", () => ({
  ChatThread: ({ room }: { room: ChatRoom }) => <h2>Open: {room.title}</h2>,
}));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
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
  expect(await screen.findByRole("link", { name: "Forum" })).toHaveAttribute(
    "href",
    "/chats/forum",
  );

  cleanup();
  state.canAuthor = false;
  renderPage();
  await screen.findByRole("heading", { name: "Chats" });
  expect(screen.queryByRole("link", { name: "Forum" })).not.toBeInTheDocument();
});

it("preserves the thread and fragment from a legacy forum link", async () => {
  state.canAuthor = true;
  renderPage("/forum?thread=fixture#reply");
  await screen.findByRole("heading", {
    name: "/chats/forum?thread=fixture#reply",
  });
  expect(screen.getByRole("link", { name: "Forum" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("returns to chats when forum access is unavailable", async () => {
  state.canAuthor = false;
  renderPage("/chats/forum?thread=fixture");
  await screen.findByRole("heading", { name: "Chats" });
  expect(screen.queryByRole("link", { name: "Forum" })).not.toBeInTheDocument();
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
