/**
 * Regressions for navigation, search and confirmed or failed sign-out. SDK/DOM fixtures isolate
 * the shell; real Auth and permission acceptance remain separate.
 */
import { lazy, type ReactNode, StrictMode, Suspense } from "react";
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
  useOutletContext,
} from "react-router-dom";
import type { InboxPage } from "../features/notifications/api";
import type { SearchSession } from "../features/search/search";
import {
  AdminNavigation,
  AdministrationSection,
} from "../features/admin/navigation";
import { Shell } from "./shell";
import i18n from "../lib/i18n";

const {
  signOut,
  access,
  refetchPermissions,
  refetchRoles,
  loadUi,
  saveUi,
  observeQuery,
} = vi.hoisted(() => ({
  signOut: vi.fn(),
  observeQuery: vi.fn(),
  access: {
    failed: false,
    permissionsLoading: false,
    actor: "actor",
    roles: [] as string[],
    permissions: [] as string[],
  },
  refetchPermissions: vi.fn(),
  refetchRoles: vi.fn(),
  loadUi: vi.fn().mockRejectedValue(new Error("No saved preferences fixture")),
  saveUi: vi.fn().mockResolvedValue(null),
}));
vi.mock("../lib/ui-preferences-api", () => ({
  loadUiPreferences: loadUi,
  saveUiPreferences: saveUi,
}));
vi.mock("../features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: access.actor, email: "fictional@example.invalid" } },
  }),
}));
vi.mock("../features/profile/avatar", () => ({ Avatar: () => <span>A</span> }));
vi.mock("../lib/supabase", () => ({ db: () => ({ auth: { signOut } }) }));
vi.mock("@tanstack/react-query", async (original) => {
  const actual = await original<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: { queryKey: string[] }) => {
      observeQuery(options.queryKey);
      return {
        data:
          options.queryKey[0] === "profile"
            ? {
                active: true,
                display_name: "Fictional User",
                time_zone: "Europe/Berlin",
              }
            : options.queryKey[0] === "user-roles"
              ? access.roles
              : options.queryKey[0] === "permissions"
                ? access.permissions
                : options.queryKey[0] === "notifications" &&
                    options.queryKey[2] === "preview"
                  ? ({
                      items: [],
                      unread_count: 0,
                      as_of: "2026-11-15T12:00:00Z",
                    } satisfies InboxPage)
                  : options.queryKey[0] === "deletions" &&
                      options.queryKey[1] === "access"
                    ? { can_admin: false, kinds: [] }
                    : [],
        isPending:
          options.queryKey[0] === "permissions" && access.permissionsLoading,
        isSuccess:
          !access.failed &&
          !(options.queryKey[0] === "permissions" && access.permissionsLoading),
        isError:
          access.failed &&
          ["permissions", "user-roles"].includes(options.queryKey[0]),
        isFetching: false,
        refetch:
          options.queryKey[0] === "permissions"
            ? refetchPermissions
            : refetchRoles,
      };
    },
  };
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("luminovia.sidebar-collapsed");
  sessionStorage.removeItem("luminovia.tour.v1.actor");
  access.failed = false;
  access.actor = "actor";
  access.permissionsLoading = false;
  access.roles = [];
  access.permissions = [];
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
      new Promise((resolve) => {
        finishSave = () =>
          resolve({
            language: "en",
            theme: "system",
            sidebar_collapsed: false,
            version: 1,
          });
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

it("restores the account language even if the browser theme changed while loading", async () => {
  access.roles = ["lecturer"];
  await i18n.changeLanguage("de");
  let finishLoad!: (value: {
    language: "en";
    theme: "dark";
    sidebar_collapsed: false;
    version: number;
  }) => void;
  loadUi.mockReturnValue(
    new Promise((resolve) => {
      finishLoad = resolve;
    }),
  );
  const { user } = setup("/profile");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Farbschema" }),
    "light",
  );
  await act(async () =>
    finishLoad({
      language: "en",
      theme: "dark",
      sidebar_collapsed: false,
      version: 2,
    }),
  );
  expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("en");
  expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("light");
  await i18n.changeLanguage("de");
});

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(
  path = "/",
  initiallyCollapsed = true,
  settings: ReactNode = <NavigationTarget />,
  strict = false,
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
              <Route element={<AdminNavigation />}>
                <Route path="admin" element={<AdministrationSection />} />
                <Route
                  path="admin/operations"
                  element={<AdministrationSection area="operations" />}
                />
                <Route
                  path="admin/directory"
                  element={<AdministrationSection area="directory" />}
                />
                <Route
                  path="admin/platform"
                  element={<AdministrationSection area="platform" />}
                />
                <Route path="admin/clients" element={<NavigationTarget />} />
                <Route path="changes" element={<NavigationTarget />} />
                <Route path="changes/:id" element={<NavigationTarget />} />
                <Route path="admin/contracts" element={<NavigationTarget />} />
              </Route>
              <Route path="calendar" element={<NavigationTarget />} />
              <Route path="profile" element={<NavigationTarget />} />
              <Route path="profile/contracts" element={<NavigationTarget />} />
              <Route path="api/docs" element={<NavigationTarget />} />
              <Route path="files" element={<NavigationTarget />} />
              <Route path="courses" element={<p>Live courses route</p>} />
              <Route path="client" element={<p>Live company route</p>} />
              <Route path="jobs/:id" element={<p>Live job detail route</p>} />
              <Route path="finance" element={<p>Live finance route</p>} />
              <Route path="learning" element={<p>Live learning route</p>} />
              <Route path="search" element={<SearchTarget />} />
            </Route>
            <Route path="/login" element={<p>Login screen</p>} />
          </Routes>
        </Suspense>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const renderTree = () =>
    strict ? <StrictMode>{tree()}</StrictMode> : tree();
  const view = render(renderTree());
  return {
    client,
    user: userEvent.setup(),
    rerender: () => view.rerender(renderTree()),
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
      expect(
        await within(screen.getByRole("main")).findByRole("alert"),
      ).toBeVisible();
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
  it("places mobile sign-out in the menu footer and keeps retry available after failure", async () => {
    signOut
      .mockReset()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce({ error: null });
    const { client, user } = setup();
    expect(
      screen.getByRole("banner").querySelector(".mobile-signout"),
    ).toBeNull();
    const more = document.querySelector<HTMLDetailsElement>(
      "details.mobile-more",
    );
    if (!more) throw new Error("Mobile navigation disclosure is missing");
    await user.click(more.querySelector("summary")!);
    const panel = more.querySelector<HTMLElement>(".mobile-menu-panel");
    if (!panel) throw new Error("Mobile navigation panel is missing");
    expect(panel.lastElementChild).toHaveClass("mobile-menu-footer");
    const signout = within(panel).getByRole("button", { name: "Abmelden" });
    await user.click(signout);
    expect(await within(panel).findByRole("alert")).toBeVisible();
    expect(signout).toBeEnabled();
    expect(screen.getByText("Private workspace")).toBeVisible();
    expect(client.getQueryData(["private", "actor"])).toBe(
      "Owned private data",
    );
    await user.click(signout);
    expect(await screen.findByText("Login screen")).toBeVisible();
    expect(client.getQueryData(["private", "actor"])).toBeUndefined();
  });
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
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
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
  "moves operational and lecturer links out of the %s sidebar",
  async (role) => {
    access.roles = [role];
    access.permissions = ["jobs.manage", "taxonomy.manage"];
    const { user } = setup("/courses", false);
    const sidebar = within(screen.getByRole("complementary"));
    for (const name of ["Leitstand", "Themen & Tools", "Dozierende"])
      expect(sidebar.queryByRole("link", { name })).toBeNull();
    await user.click(sidebar.getByRole("link", { name: "Verwaltung" }));
    await user.click(
      within(screen.getByRole("navigation", { name: "Verwaltung" })).getByRole(
        "link",
        { name: /^Kursbetrieb(?: |$)/ },
      ),
    );
    expect(
      screen.getByRole("link", { name: /^Leitstand(?: |$)/ }),
    ).toHaveAttribute("href", "/control-center");
    expect(
      screen.getByRole("link", { name: /^Themen & Tools(?: |$)/ }),
    ).toHaveAttribute("href", "/topics");
  },
);

it.each(["admin", "management"])(
  "groups contract administration, changes and companies for %s",
  async (role) => {
    access.roles = [role];
    access.permissions = [
      "jobs.manage",
      "contracts.manage",
      "organisations.manage",
      "users.manage",
      "qualifications.verify",
    ];
    const { user } = setup("/changes/fictional?filter=open", false);
    const sidebar = within(screen.getByRole("complementary"));
    expect(sidebar.getByRole("link", { name: "Verwaltung" })).toHaveClass(
      "active",
    );
    expect(sidebar.queryByRole("link", { name: "Verträge" })).toBeNull();
    for (const name of ["Auftragsänderungen", "Unternehmen"])
      expect(sidebar.queryByRole("link", { name })).toBeNull();
    expect(sidebar.getByRole("link", { name: "Chat" })).toHaveAttribute(
      "href",
      "/chats",
    );

    const sections = within(
      screen.getByRole("navigation", { name: "Verwaltung" }),
    );
    expect(
      sections.getByRole("link", { name: /^Kursbetrieb(?: |$)/ }),
    ).toHaveAttribute("aria-current", "location");
    await user.click(
      sections.getByRole("link", { name: /^Unternehmen & Personen(?: |$)/ }),
    );
    expect(
      screen.getByRole("link", { name: /^Unternehmen(?! & Personen)/ }),
    ).toHaveAttribute("href", "/admin/clients");
    expect(
      screen.getByRole("link", { name: /^Dozierende(?: |$)/ }),
    ).toHaveAttribute("href", "/people");
    await user.click(screen.getByRole("link", { name: /^Verträge(?: |$)/ }));
    expect(await screen.findByLabelText("Fixture location")).toHaveTextContent(
      "/admin/contracts",
    );
    expect(
      sections.getByRole("link", { name: /^Unternehmen & Personen(?: |$)/ }),
    ).toHaveAttribute("aria-current", "location");
    await user.click(
      sections.getByRole("link", { name: /^Kursbetrieb(?: |$)/ }),
    );
    expect(
      within(screen.getByRole("main")).queryByRole("link", {
        name: /^Verträge(?: |$)/,
      }),
    ).toBeNull();
  },
);

it("puts a lecturer's own contracts in the profile menu only", async () => {
  access.roles = ["lecturer"];
  const { user } = setup("/profile", false);
  const sidebar = within(screen.getByRole("complementary"));
  expect(sidebar.queryByRole("link", { name: /Verträge/ })).toBeNull();
  const account = screen
    .getByRole("banner")
    .querySelector(".account-menu summary");
  await user.click(account!);
  const contracts = screen.getByRole("link", {
    name: "Meine Verträge",
  });
  expect(contracts).toHaveAttribute("href", "/profile/contracts");
  await user.click(contracts);
  expect(await screen.findByLabelText("Fixture location")).toHaveTextContent(
    "/profile/contracts",
  );
  expect(
    sidebar.getByRole("link", { name: "Auftragsänderungen" }),
  ).toHaveAttribute("href", "/changes");
  expect(screen.queryByRole("navigation", { name: "Verwaltung" })).toBeNull();
  expect(sidebar.getByRole("link", { name: "Dozierende" })).toHaveAttribute(
    "href",
    "/people",
  );
  expect(sidebar.getByRole("link", { name: "Themen & Tools" })).toHaveAttribute(
    "href",
    "/topics",
  );
});

it("does not open administrative contracts with personal contract access", () => {
  access.roles = ["lecturer"];
  access.permissions = ["contracts.read"];
  setup("/admin/contracts", false);
  expect(
    screen.getByRole("heading", { name: "Diese Seite wurde nicht gefunden." }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Fixture location")).toBeNull();
});

it("keeps the overview in place and exposes only available areas after permissions load", () => {
  access.roles = ["management"];
  access.permissionsLoading = true;
  const { rerender } = setup("/admin");
  expect(screen.queryByRole("heading", { name: "Verwaltung" })).toBeNull();
  access.permissionsLoading = false;
  rerender();
  expect(screen.getByRole("heading", { name: "Verwaltung" })).toBeVisible();
  const nav = within(screen.getByRole("navigation", { name: "Verwaltung" }));
  expect(nav.getByRole("link", { name: /^Kursbetrieb(?: |$)/ })).toBeVisible();
  expect(
    nav.getByRole("link", { name: /^Unternehmen & Personen(?: |$)/ }),
  ).toBeVisible();
  expect(
    nav.queryByRole("link", { name: /^Plattformbetrieb(?: |$)/ }),
  ).toBeNull();
});
it("hides the Control Center without its current management permission", () => {
  access.roles = ["management"];
  access.permissions = ["announcements.manage"];
  setup("/courses", false);
  expect(
    within(screen.getByRole("complementary")).queryByRole("link", {
      name: "Leitstand",
    }),
  ).not.toBeInTheDocument();
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

function SearchTarget() {
  const [{ q }] = useOutletContext<SearchSession>();
  return (
    <>
      <NavigationTarget />
      <output aria-label="Fixture search term">{q}</output>
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

  it("keeps profile and personal settings together in the account menu", async () => {
    const { user } = setup();
    const summary = screen.getByLabelText("Mehr");
    await user.click(summary);
    const menu = summary.closest("details")!;
    expect(
      within(menu).queryByRole("link", { name: "Persönliche Einstellungen" }),
    ).toBeNull();
    expect(
      within(menu).queryByRole("link", { name: "Mein Profil" }),
    ).toBeNull();
    const account =
      document.querySelector<HTMLDetailsElement>(".account-menu")!;
    await user.click(account.querySelector("summary")!);
    expect(
      within(account).getByRole("link", { name: "Persönliche Einstellungen" }),
    ).toHaveAttribute("href", "/settings");
    expect(
      within(account).getByRole("link", { name: "Mein Profil" }),
    ).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("combobox", { name: "Sprache" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Farbschema" })).toBeVisible();
    expect(
      within(account).queryByRole("button", { name: "Abmelden" }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).getByRole("button", { name: "Abmelden" }).parentElement,
    ).toHaveClass("mobile-menu-footer");
  });

  it("does not rerender the shell while typing and clears the search when the account changes", async () => {
    const { user, rerender } = setup();
    const search = screen.getByLabelText("Im Portal suchen");

    await user.click(search);
    observeQuery.mockClear();
    await user.keyboard("Fictional search");
    expect(search).toHaveValue("Fictional search");
    expect(observeQuery).not.toHaveBeenCalled();

    access.actor = "second-actor";
    rerender();
    expect(screen.getByLabelText("Im Portal suchen")).toHaveValue("");
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
      /^\/search$/,
    );
    expect(screen.getByLabelText("Fixture search term")).toHaveTextContent(
      "Fictional files",
    );
    await waitFor(() => expect(menu).toHaveProperty("open", false));
    expect(search).toHaveFocus();
    expect(search).toHaveValue("Fictional files");
  });

  it("closes for repeated search and back navigation without creating search history entries", async () => {
    const { user } = setup("/calendar");
    const summary = screen.getByLabelText("Mehr");
    const menu = summary.closest("details")!;
    const search = within(screen.getByRole("banner")).getByLabelText(
      "Im Portal suchen",
    );
    await user.type(search, "original{Enter}");
    expect(
      await screen.findByLabelText("Fixture search term"),
    ).toHaveTextContent("original");
    await user.click(summary);
    await user.clear(search);
    await user.type(search, "updated{Enter}");
    expect(screen.getByLabelText("Fixture location")).toHaveTextContent(
      /^\/search$/,
    );
    expect(screen.getByLabelText("Fixture search term")).toHaveTextContent(
      "updated",
    );
    await waitFor(() => expect(menu).toHaveProperty("open", false));
    await user.click(summary);
    expect(menu).toHaveProperty("open", true);
    fireEvent.click(
      screen.getByRole("button", { name: "Back in fixture history" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Fixture location")).toHaveTextContent(
        "/calendar",
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
    const input = within(banner).getByRole("searchbox", {
      name: "Im Portal suchen",
    });
    await user.type(input, "Fictional files");
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Fixture location")).toHaveTextContent(
      /^\/search$/,
    );
    expect(screen.getByLabelText("Fixture search term")).toHaveTextContent(
      "Fictional files",
    );
    expect(
      banner.querySelector(".notification-menu summary"),
    ).toBeInTheDocument();
  });

  it("renders a collapsed rail hint without rerendering the shell queries", async () => {
    const { user } = setup();
    observeQuery.mockClear();
    await user.hover(
      screen.getByRole("button", { name: "Navigation ausklappen" }),
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Navigation ausklappen",
    );
    expect(observeQuery).not.toHaveBeenCalled();
  });

  it("persists a sidebar click only once under Strict Mode", async () => {
    const { user } = setup("/", true, undefined, true);
    await user.click(
      screen.getByRole("button", { name: "Navigation ausklappen" }),
    );
    expect(saveUi).toHaveBeenCalledExactlyOnceWith({
      sidebar_collapsed: false,
    });
    expect(localStorage.getItem("luminovia.sidebar-collapsed")).toBe("false");
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

it("routes a company-only job request back to the company workspace", async () => {
  access.roles = ["client"];
  setup("/jobs/fictional-offer", false);
  expect(await screen.findByText("Live company route")).toBeVisible();
  expect(screen.queryByText("Live job detail route")).not.toBeInTheDocument();
  expect(screen.queryByText("Live finance route")).not.toBeInTheDocument();
});

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
    within(sidebar).getByRole("link", { name: "Unternehmensfinanzen" }),
  ).toHaveAttribute("href", "/client/finance");
  expect(within(sidebar).queryByRole("link", { name: "Analysen" })).toBeNull();
  expect(
    within(sidebar).queryByRole("link", { name: "Buchhaltung und Exporte" }),
  ).toBeNull();
});

it.each([
  { roles: ["lecturer"], personal: true, platform: false },
  { roles: ["senior_lecturer"], personal: true, platform: false },
  { roles: ["owner"], personal: false, platform: true },
  { roles: ["admin"], personal: false, platform: true },
  { roles: ["management"], personal: false, platform: true },
  { roles: ["owner", "lecturer"], personal: true, platform: true },
  { roles: ["admin", "lecturer"], personal: true, platform: true },
  { roles: ["management", "lecturer"], personal: true, platform: true },
  { roles: ["client"], personal: false, platform: false },
  { roles: ["participant"], personal: false, platform: false },
])(
  "shows the authorised finance entry points in both menus for $roles",
  async ({ roles, personal, platform }) => {
    access.roles = roles;
    access.permissions = ["finance.manage"];
    const { user } = setup("/", false);
    const sidebar = within(screen.getByRole("complementary", { name: "Menü" }));
    const summary = screen.getByLabelText("Mehr");
    await user.click(summary);
    const mobile = within(summary.closest("details")!);
    for (const menu of [sidebar, mobile]) {
      const personalLink = menu.queryByRole("link", { name: "Meine Finanzen" });
      const companyLink = menu.queryByRole("link", {
        name: "Unternehmensfinanzen",
      });
      const platformLink = menu.queryByRole("link", { name: "Verwaltung" });
      if (personal) expect(personalLink).toHaveAttribute("href", "/finance");
      else expect(personalLink).not.toBeInTheDocument();
      if (roles.includes("client"))
        expect(companyLink).toHaveAttribute("href", "/client/finance");
      else expect(companyLink).not.toBeInTheDocument();
      if (platform) expect(platformLink).toHaveAttribute("href", "/admin");
      else expect(platformLink).not.toBeInTheDocument();
    }
    if (platform) {
      await user.click(mobile.getByRole("link", { name: "Verwaltung" }));
      expect(
        within(
          screen.getByRole("navigation", { name: "Verwaltung" }),
        ).getByRole("link", { name: /^Plattformfinanzen(?: |$)/ }),
      ).toHaveAttribute("href", "/admin/finance");
    }
  },
);

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
  expect(
    within(sidebar).getByRole("link", { name: "Meine Finanzen" }),
  ).toHaveAttribute("href", "/finance");
  expect(screen.getByText("Live finance route")).toBeVisible();
});
