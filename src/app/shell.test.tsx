/**
 * Regressions for navigation, search and confirmed or failed sign-out. SDK/DOM fixtures isolate
 * the shell; real Auth and permission acceptance remain separate.
 */
import { lazy, type ReactNode, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
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
import i18n from "../lib/i18n";

const { signOut, access, refetchPermissions, refetchRoles, loadUi, saveUi } =
  vi.hoisted(() => ({
    signOut: vi.fn(),
    access: { failed: false, roles: [] as string[] },
    refetchPermissions: vi.fn(),
    refetchRoles: vi.fn(),
    loadUi: vi
      .fn()
      .mockRejectedValue(new Error("No saved preferences fixture")),
    saveUi: vi.fn().mockResolvedValue(null),
  }));
vi.mock("../lib/ui-preferences-api", () => ({
  loadUiPreferences: loadUi,
  saveUiPreferences: saveUi,
}));
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
          : options.queryKey[0] === "user-roles"
            ? access.roles
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
  sessionStorage.removeItem("luminovia.tour.v1.actor");
  access.failed = false;
  access.roles = [];
  vi.clearAllMocks();
  loadUi
    .mockReset()
    .mockRejectedValue(new Error("No saved preferences fixture"));
  saveUi.mockReset().mockResolvedValue(null);
  vi.unstubAllGlobals();
});

it.each(["lecturer", "guest", "participant"])(
  "keeps the %s's selected language while the account preference is being saved",
  async (role) => {
    access.roles = [role];
    await i18n.changeLanguage("de");
    loadUi.mockResolvedValue({
      language: "de",
      theme: "system",
      sidebar_collapsed: false,
      version: 0,
    });
    let finishSave!: () => void;
    saveUi.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
    );
    try {
      const { user } = setup("/profile");
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Sprache" }),
        "en",
      );
      expect(saveUi).toHaveBeenCalledWith({ language: "en" });
      expect(loadUi).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue(
        "en",
      );
    } finally {
      finishSave();
      cleanup();
      await i18n.changeLanguage("de");
    }
  },
);

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(
  path = "/",
  initiallyCollapsed = true,
  settings: ReactNode = <NavigationTarget />,
) {
  if (initiallyCollapsed)
    localStorage.setItem("luminovia.sidebar-collapsed", "true");
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
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Suspense fallback={<p>Waiting for route</p>}>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<p>Private workspace</p>} />
              <Route path="settings" element={settings} />
              <Route path="calendar" element={<NavigationTarget />} />
              <Route path="profile" element={<NavigationTarget />} />
              <Route path="api/docs" element={<NavigationTarget />} />
              <Route path="files" element={<NavigationTarget />} />
              <Route path="courses" element={<p>Live courses route</p>} />
              <Route path="client" element={<p>Live company route</p>} />
              <Route path="jobs/:id" element={<p>Live job detail route</p>} />
              <Route path="finance" element={<p>Live finance route</p>} />
              <Route path="learning" element={<p>Live learning route</p>} />
              <Route path="search" element={<NavigationTarget />} />
            </Route>
            <Route path="/login" element={<p>Login screen</p>} />
          </Routes>
        </Suspense>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    client,
    user: userEvent.setup(),
    rerender: () => view.rerender(tree()),
  };
}

it("focuses the resume control after a lazy settings route loads on Escape", async () => {
  access.roles = ["lecturer"];
  sessionStorage.setItem(
    "luminovia.tour.v1.actor",
    JSON.stringify({ status: "active", step: "calendar" }),
  );
  type SettingsModule = { default: () => ReactNode };
  let resolveSettings!: (module: SettingsModule) => void;
  const settings = new Promise<SettingsModule>((resolve) => {
    resolveSettings = resolve;
  });
  const loadSettings = vi.fn(() => settings);
  const LazySettings = lazy(loadSettings);
  const { user } = setup("/calendar", false, <LazySettings />);
  const tour = () =>
    within(screen.getByRole("region", { name: /Portal-Rundgang|Portal tour/ }));
  expect(tour().getByRole("heading", { level: 2 })).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(loadSettings).toHaveBeenCalledOnce());
  expect(
    screen.queryByText("Fictional settings content"),
  ).not.toBeInTheDocument();
  await act(async () =>
    resolveSettings({ default: () => <p>Fictional settings content</p> }),
  );
  expect(screen.getByText("Fictional settings content")).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Rundgang fortsetzen|Resume tour/ }),
  ).toHaveFocus();
});

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

describe("role access recovery", () => {
  it("does not mount private routes or tour before role authority can be established", async () => {
    access.failed = true;
    const { user, client } = setup("/settings");
    expect(screen.getByRole("alert")).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Portal-Rundgang" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(refetchRoles).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["private", "actor"])).toBe(
      "Owned private data",
    );
  });
});
it("guest-only navigation exposes own profile/settings/help and no operational controls", async () => {
  access.roles = ["guest"];
  setup("/settings");
  expect(screen.queryByRole("search")).not.toBeInTheDocument();
  expect(document.querySelector(".notification-menu")).toBeNull();
  const sidebar = screen.getByRole("complementary");
  expect(
    within(sidebar).queryByRole("link", { name: "Dateien" }),
  ).not.toBeInTheDocument();
  expect(
    within(sidebar).getByRole("link", { name: "Mein Profil" }),
  ).toBeInTheDocument();
  expect(document.querySelector(".portal-tour")).toBeNull();
});
it.each(["admin", "management"])(
  "keeps %s on live routes with ordinary header controls",
  (role) => {
    access.roles = [role];
    setup("/courses", false);
    expect(screen.getByText("Live courses route")).toBeVisible();
    expect(screen.getByRole("search")).toBeVisible();
    expect(document.querySelector(".account-menu")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Navigationsvorschau" }),
    ).toBeNull();
  },
);

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

  it("keeps one header search and preserves its focus while searching", async () => {
    const { user } = setup();
    const summary = screen.getByLabelText("Mehr");
    const menu = summary.closest("details")!;
    await user.click(summary);
    expect(within(menu).queryByRole("search")).not.toBeInTheDocument();
    const search = within(screen.getByRole("banner")).getByLabelText(
      "Im Portal suchen",
    );
    await user.type(search, "Fictional files");
    expect(menu).toHaveProperty("open", false);
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
      within(screen.getByRole("banner")).getByLabelText("Im Portal suchen"),
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
    fireEvent.click(
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
  it("keeps search and notifications in the top bar when the rail is collapsed", async () => {
    const { user } = setup();
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).queryByRole("search")).not.toBeInTheDocument();
    const banner = screen.getByRole("banner");
    const input = within(banner).getByRole("textbox", {
      name: "Im Portal suchen",
    });
    await user.type(input, "Fictional files");
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Fixture location")).toHaveTextContent(
      "/search?q=Fictional%20files",
    );
    expect(
      banner.querySelector(".notification-menu summary"),
    ).toBeInTheDocument();
  });

  it("shows the collapsed rail toggle hint on keyboard focus", async () => {
    const { user } = setup();
    const toggle = screen.getByRole("button", {
      name: "Navigation ausklappen",
    });

    // Skip link and brand link precede the rail control in keyboard order.
    await user.tab();
    await user.tab();
    await user.tab();

    expect(toggle).toHaveFocus();
    expect(
      screen.getByRole("tooltip", { name: "Navigation ausklappen" }),
    ).toBeVisible();
  });

  it("starts with labelled navigation unless a collapsed preference was saved", async () => {
    const { user } = setup("/", false);
    const sidebar = screen.getByRole("complementary");
    const files = within(sidebar).getByRole("link", { name: "Dateien" });
    expect(files).toBeVisible();
    expect(
      within(sidebar).getByRole("link", { name: "Luminovia Portal" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Navigation einklappen" }),
    );
    expect(
      screen.getByRole("button", { name: "Navigation ausklappen" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("luminovia.sidebar-collapsed")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Sprache" })).toBeVisible();
    expect(
      within(sidebar).getByRole("button", { name: "Abmelden" }),
    ).toBeVisible();
  });
});
it("lets participant-only accounts open their own profile without opening operational navigation", async () => {
  access.roles = ["participant"];
  setup("/profile", false);
  const sidebar = screen.getByRole("complementary", { name: "Menü" });
  expect(
    within(sidebar).getByRole("link", { name: "Meine Kurse" }),
  ).toHaveAttribute("href", "/learning");
  expect(
    within(sidebar).getByRole("link", { name: "Benachrichtigungen" }),
  ).toHaveAttribute("href", "/notifications");
  expect(screen.getByLabelText("Fixture location")).toHaveTextContent(
    "/profile",
  );
  expect(within(sidebar).queryByRole("link", { name: "Aufträge" })).toBeNull();
});

it("allows a participant's signed-in API explorer route", () => {
  access.roles = ["participant"];
  setup("/api/docs");
  expect(screen.getByLabelText("Fixture location")).toHaveTextContent(
    "/api/docs",
  );
});

it.each(["/jobs/fictional-offer", "/finance?claim=fictional-claim"])(
  "routes company-only requests for %s back to the company workspace",
  async (path) => {
    access.roles = ["client"];
    setup(path, false);
    expect(await screen.findByText("Live company route")).toBeVisible();
    expect(screen.queryByText("Live job detail route")).not.toBeInTheDocument();
    expect(screen.queryByText("Live finance route")).not.toBeInTheDocument();
  },
);

it("opens a valid job detail ID for the company-scoped server projection", async () => {
  access.roles = ["client"];
  setup("/jobs/28e21536-c4ab-4219-a5ac-16399fce8efa", false);
  expect(await screen.findByText("Live job detail route")).toBeVisible();
});

it("uses one finance link for company invoices and analytics", () => {
  access.roles = ["client"];
  setup("/client", false);
  const sidebar = screen.getByRole("complementary", { name: "Menü" });
  expect(
    within(sidebar).getByRole("link", { name: "Finanzen" }),
  ).toHaveAttribute("href", "/finance");
  expect(within(sidebar).queryByRole("link", { name: "Analysen" })).toBeNull();
  expect(
    within(sidebar).queryByRole("link", { name: "Buchhaltung und Exporte" }),
  ).toBeNull();
});

it("combines enterprise, participant and teaching navigation on one account", () => {
  access.roles = ["client", "participant", "lecturer"];
  setup("/finance", false);
  const sidebar = screen.getByRole("complementary", { name: "Menü" });
  expect(
    within(sidebar).getByRole("link", { name: "Stellenbörse" }),
  ).toHaveAttribute("href", "/jobs");
  expect(
    within(sidebar).getByRole("link", { name: "Unternehmensportal" }),
  ).toHaveAttribute("href", "/client");
  expect(
    within(sidebar).getByRole("link", { name: "Lernbereich" }),
  ).toHaveAttribute("href", "/learning");
  expect(
    within(sidebar).getByRole("link", { name: "Kursbewertungen" }),
  ).toHaveAttribute("href", "/my-reviews");
  expect(screen.getByText("Live finance route")).toBeVisible();
});
