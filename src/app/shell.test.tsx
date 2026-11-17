/**
 * Regressions for navigation, search and confirmed or failed sign-out. SDK/DOM fixtures isolate
 * the shell; real Auth and permission acceptance remain separate.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { InboxPage } from "../features/notifications/api";
import { Shell } from "./shell";
import "../lib/i18n";
const { signOut, access, refetchPermissions, refetchRoles } = vi.hoisted(
  () => ({
    signOut: vi.fn(),
    access: { failed: false },
    refetchPermissions: vi.fn(),
    refetchRoles: vi.fn(),
  }),
);
vi.mock("../features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "actor", email: "fictional@example.invalid" } },
  }),
}));
vi.mock("../features/profile/avatar", () => ({ Avatar: () => <span>A</span> }));
vi.mock("../lib/supabase", () => ({ db: () => ({ auth: { signOut } }) }));
vi.mock("@tanstack/react-query", async (original) => {
  const actual = await original<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: { queryKey: string[] }) => ({
      data:
        options.queryKey[0] === "profile"
          ? {
              active: true,
              display_name: "Fictional User",
              time_zone: "Europe/Berlin",
            }
          : options.queryKey[0] === "notifications" &&
              options.queryKey[2] === "preview"
            ? ({
                items: [],
                unread_count: 0,
                as_of: "2026-11-15T12:00:00Z",
              } satisfies InboxPage)
            : [],
      isPending: false,
      isSuccess: !access.failed,
      isError:
        access.failed &&
        ["permissions", "user-roles"].includes(options.queryKey[0]),
      isFetching: false,
      refetch:
        options.queryKey[0] === "permissions"
          ? refetchPermissions
          : refetchRoles,
    }),
  };
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("luminovia.sidebar-collapsed");
  access.failed = false;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(path = "/") {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const client = new QueryClient();
  client.setQueryData(["private", "actor"], "Owned private data");
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<p>Private workspace</p>} />
            <Route path="files" element={<NavigationTarget />} />
            <Route path="search" element={<NavigationTarget />} />
          </Route>
          <Route path="/login" element={<p>Login screen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, user: userEvent.setup() };
}
describe("server-confirmed logout", () => {
  it.each(["returned", "rejected"])(
    "keeps the workspace/cache on a %s sign-out failure and permits retry",
    async (mode) => {
      if (mode === "returned")
        signOut.mockResolvedValueOnce({
          error: new Error("Server unavailable"),
        });
      else signOut.mockRejectedValueOnce(new Error("Network unavailable"));
      const { client, user } = setup();
      const signout = within(screen.getByRole("complementary")).getByRole(
        "button",
        { name: "Abmelden" },
      );
      await user.click(signout);
      expect(await screen.findByRole("alert")).toBeVisible();
      expect(screen.getByText("Private workspace")).toBeVisible();
      expect(client.getQueryData(["private", "actor"])).toBe(
        "Owned private data",
      );
      signOut.mockResolvedValueOnce({ error: null });
      await user.click(signout);
      expect(await screen.findByText("Login screen")).toBeVisible();
      expect(client.getQueryData(["private", "actor"])).toBeUndefined();
    },
  );
  it("does not clear private data or submit twice before server acknowledgement", async () => {
    let complete!: (value: { error: null }) => void;
    signOut.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { client, user } = setup();
    const signout = within(screen.getByRole("complementary")).getByRole(
      "button",
      { name: "Abmelden" },
    );
    await user.click(signout);
    expect(signout).toBeDisabled();
    expect(client.getQueryData(["private", "actor"])).toBe(
      "Owned private data",
    );
    expect(signOut).toHaveBeenCalledTimes(1);
    complete({ error: null });
    await waitFor(() => expect(screen.getByText("Login screen")).toBeVisible());
  });
});

describe("tour access recovery", () => {
  it("explains an actual permission query failure and retries both owning queries", async () => {
    access.failed = true;
    const { user, client } = setup();
    const tour = within(
      screen.getByRole("region", { name: "Portal-Rundgang" }),
    );
    expect(tour.getByRole("alert")).toHaveTextContent(
      "Die Zugriffsrechte konnten nicht geladen werden",
    );
    expect(
      tour.getByRole("button", { name: "Portal-Rundgang" }),
    ).toBeDisabled();
    await user.click(
      tour.getByRole("button", { name: "Zugriffsrechte erneut laden" }),
    );
    expect(refetchPermissions).toHaveBeenCalledTimes(1);
    expect(refetchRoles).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["private", "actor"])).toBe(
      "Owned private data",
    );
  });
});

/** Observe real router transitions; the history action is outside the More disclosure. */
function NavigationTarget() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Fixture location">
        {location.pathname + location.search + location.hash}
      </output>
      <button onClick={() => navigate(-1)}>Back in fixture history</button>
    </>
  );
}

describe("native mobile More navigation", () => {
  it("closes after ordinary keyboard link navigation and leaves focus on its visible summary", async () => {
    const { user } = setup();
    const summary = screen.getByLabelText("Mehr");
    const menu = summary.closest("details")!;
    await user.click(summary);
    expect(menu).toHaveProperty("open", true);
    const files = within(menu).getByRole("link", { name: "Dateien" });
    // Search and notifications now precede routes in the complete mobile disclosure.
    for (let i = 0; i < 20 && document.activeElement !== files; i += 1) {
      await user.tab();
    }
    expect(files).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Fixture location")).toHaveTextContent(
      "/files",
    );
    await waitFor(() => expect(menu).toHaveProperty("open", false));
    expect(summary).toHaveFocus();
  });

  it("keeps account and settings routes reachable in the complete mobile disclosure", async () => {
    const { user } = setup();
    const summary = screen.getByLabelText("Mehr");
    await user.click(summary);
    const menu = summary.closest("details")!;
    expect(
      within(menu).getByRole("link", { name: "Einstellungen" }),
    ).toHaveAttribute("href", "/settings");
    expect(
      within(menu).getByRole("link", { name: "Mein Profil" }),
    ).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("combobox", { name: "Sprache" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Farbschema" })).toBeVisible();
    expect(
      screen.getByRole("banner").querySelector(".mobile-signout"),
    ).toBeInTheDocument();
  });

  it("closes on header-search navigation without stealing focus from the search input", async () => {
    const { user } = setup();
    const summary = screen.getByLabelText("Mehr");
    const menu = summary.closest("details")!;
    await user.click(summary);
    const search = within(menu).getByLabelText("Stellen durchsuchen");
    await user.type(search, "Fictional files");
    // Typing and unrelated Shell state renders are not navigation events.
    expect(menu).toHaveProperty("open", true);
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Fixture location")).toHaveTextContent(
      "/search?q=Fictional%20files",
    );
    await waitFor(() => expect(menu).toHaveProperty("open", false));
    expect(search).toHaveFocus();
    expect(search).toHaveValue("Fictional files");
  });

  it("closes for same-path query changes and back navigation rather than only a pathname change", async () => {
    const { user } = setup("/search?q=original");
    const summary = screen.getByLabelText("Mehr");
    const menu = summary.closest("details")!;
    await user.click(summary);
    await user.type(
      within(menu).getByLabelText("Stellen durchsuchen"),
      "updated",
    );
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByLabelText("Fixture location")).toHaveTextContent(
        "/search?q=updated",
      ),
    );
    await waitFor(() => expect(menu).toHaveProperty("open", false));
    await user.click(summary);
    expect(menu).toHaveProperty("open", true);
    await user.click(
      screen.getByRole("button", { name: "Back in fixture history" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Fixture location")).toHaveTextContent(
        "/search?q=original",
      ),
    );
    expect(menu).toHaveProperty("open", false);
  });
});

describe("Royal workspace sidebar preference", () => {
  it("keeps global search and notifications in the sidebar and mobile navigation", async () => {
    const { user } = setup();
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("search")).toBeInTheDocument();
    expect(
      screen
        .getByRole("banner")
        .querySelector(".global-search:not(.mobile-global-search)"),
    ).toBeNull();

    await user.click(
      within(sidebar).getByRole("button", { name: "Stellen durchsuchen" }),
    );
    const desktopInput = within(sidebar).getByRole("textbox", {
      name: "Stellen durchsuchen",
    });
    await user.type(desktopInput, "Fictional files");
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Fixture location")).toHaveTextContent(
      "/search?q=Fictional%20files",
    );

    const summary = screen.getByLabelText("Mehr");
    await user.click(summary);
    const menu = summary.closest("details")!;
    expect(within(menu).getByRole("search")).toBeInTheDocument();
    expect(
      menu.querySelector(".notification-menu summary"),
    ).toBeInTheDocument();
  });

  it("shows the collapsed rail toggle hint on keyboard focus", async () => {
    const { user } = setup();
    const toggle = screen.getByRole("button", {
      name: "Navigation ausklappen",
    });

    // Skip link is first in the document; the next Tab focuses the rail control.
    await user.tab();
    await user.tab();

    expect(toggle).toHaveFocus();
    expect(
      screen.getByRole("tooltip", { name: "Navigation ausklappen" }),
    ).toBeVisible();
  });

  it("starts as an accessible icon rail and persists the expanded choice", async () => {
    const { user } = setup();
    const files = screen
      .getByRole("complementary")
      .querySelector('a[href="/files"]')!;
    expect(files).toHaveAttribute("aria-label", "Dateien");
    expect(files).toHaveAttribute("aria-describedby", "sidebar-nav-tooltip");
    await user.hover(files);
    const tooltip = screen.getByRole("tooltip", { name: "Dateien" });
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.parentElement).toBe(document.body);
    expect(tooltip.style.left).toMatch(/px$/);
    await user.click(
      screen.getByRole("button", { name: "Navigation ausklappen" }),
    );
    expect(
      screen.getByRole("button", { name: "Navigation einklappen" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem("luminovia.sidebar-collapsed")).toBe("false");
    expect(files).toHaveTextContent("Dateien");
    expect(screen.getByRole("combobox", { name: "Sprache" })).toBeVisible();
    expect(
      within(screen.getByRole("complementary")).getByRole("button", {
        name: "Abmelden",
      }),
    ).toBeVisible();
  });
});
