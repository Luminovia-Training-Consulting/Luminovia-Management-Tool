/** Check communication navigation and legacy links against the existing knowledge permissions. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  CommunicationWorkspace,
  LegacyForumRoute,
} from "../../app/section-hubs";
import { ChatPage } from "./chat";

const state = vi.hoisted(() => ({
  canAuthor: true,
  roles: ["client"] as string[],
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
  chatContactsQuery: (actor: string) => ({
    queryKey: ["chat-contacts", actor],
    queryFn: async () => [],
  }),
  chatKeys: { rooms: (actor: string) => ["chat-rooms", actor] },
  chatRoomsQuery: (actor: string) => ({
    queryKey: ["chat-rooms", actor],
    queryFn: async () => [],
  }),
}));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
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
