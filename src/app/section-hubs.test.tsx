/** Consolidated workspaces retain their current section while feature URL state changes. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import {
  CommunicationForum,
  LegacyWikiRoute,
  SectionHub,
} from "./section-hubs";
import "../lib/i18n";

const state = vi.hoisted(() => ({ roles: ["lecturer"] }));

vi.mock("../features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "company" } } }),
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: state.roles }),
}));
vi.mock("../features/operations/courses", () => ({
  CoursesPage: () => <p>Course catalogue</p>,
}));
vi.mock("../features/knowledge/articles", () => ({
  KnowledgeArticles: () => <p>Article content</p>,
}));
vi.mock("../features/knowledge/forum", () => ({
  ForumPage: () => <p>Discussion content</p>,
}));
vi.mock("../features/help/help", () => ({
  HelpCenter: ({ embedded }: { embedded?: boolean }) => {
    const [params, setParams] = useSearchParams();
    return (
      <button
        onClick={() => {
          const next = new URLSearchParams(params);
          next.set("topic", "files");
          setParams(next);
        }}
      >
        {embedded ? "Embedded help" : "Public help"}
      </button>
    );
  },
}));
afterEach(() => {
  cleanup();
  state.roles = ["lecturer"];
});
it.each(["lecturer", "client"])(
  "shows the course catalogue with no separate replacement controls for %s",
  async (role) => {
    state.roles = [role];
    render(
      <MemoryRouter>
        <SectionHub kind="courses" />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Course catalogue")).toBeVisible();
    expect(
      screen.queryByText(/Vertretung für einen Kurs|Find or claim a course/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Vertretungen|Replacements/ }),
    ).not.toBeInTheDocument();
  },
);
it("embeds help without losing the active assistance section on topic navigation", async () => {
  render(
    <MemoryRouter initialEntries={["/assistance?section=help"]}>
      <SectionHub kind="assistance" />
    </MemoryRouter>,
  );
  const help = await screen.findByRole("button", { name: "Embedded help" });
  await userEvent.click(help);
  expect(
    screen.getByRole("button", { name: "Embedded help" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Article content")).not.toBeInTheDocument();
});

function Location() {
  const { pathname, search, hash } = useLocation();
  return <output>{pathname + search + hash}</output>;
}

function renderForum(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/chats/forum"
          element={
            <>
              <Location />
              <CommunicationForum />
            </>
          }
        />
        <Route path="/wiki" element={<LegacyWikiRoute />} />
        <Route path="/assistance" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
}

it("makes existing article links open in the forum and switches to discussions in place", async () => {
  renderForum("/wiki?section=wiki&page=sample#revision");
  expect(
    await screen.findByText("/chats/forum?page=sample&view=articles#revision"),
  ).toBeVisible();
  expect(await screen.findByText("Article content")).toBeVisible();
  expect(screen.queryByText("Discussion content")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: /Diskussionen|Discussions/ }),
  );
  expect(await screen.findByText("Discussion content")).toBeVisible();
  expect(screen.getByText("/chats/forum")).toBeVisible();
});

it("does not mount articles or offer the tab to an account with discussion-only access", async () => {
  state.roles = ["client"];
  renderForum("/chats/forum?view=articles&page=sample");
  expect(
    await screen.findByRole("heading", {
      name: /Diese Seite wurde nicht gefunden|This page could not be found/,
    }),
  ).toBeVisible();
  expect(
    screen.getByText("/chats/forum?view=articles&page=sample"),
  ).toBeVisible();
  expect(screen.queryByText("Discussion content")).not.toBeInTheDocument();
  expect(screen.queryByText("Article content")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Fachartikel|Articles/ }),
  ).not.toBeInTheDocument();
});

it("retains old help links including their selected article", async () => {
  state.roles = ["guest"];
  renderForum("/wiki?section=help&topic=security#guidance");
  expect(
    await screen.findByText("/assistance?topic=security#guidance"),
  ).toBeVisible();
});
