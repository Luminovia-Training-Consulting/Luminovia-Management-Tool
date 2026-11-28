/**
 * Shared desktop/mobile shell for navigation, search, notifications and preferences.
 * Loaded capabilities shape visible actions and guidance; the backend authorizes access.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  matchPath,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useMatch,
  useNavigate,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PermanentDeletionProvider } from "../features/deletions/deletions";
import { AnnouncementBanners } from "../features/announcements/announcement-banners";
import {
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  DollarSign,
  FileCheck2,
  FolderOpen,
  GraduationCap,
  Home,
  LogOut,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  UserRound,
  Users,
} from "lucide-react";
import { Avatar } from "../features/profile/avatar";
import {
  PortalNavigation,
  type PortalNavigationItem,
} from "../components/portal-navigation";
import { useDismissibleDisclosure } from "../components/use-dismissible-disclosure";
import { NotificationsMenu } from "../features/notifications/notifications-menu";
import {
  guestRouteAllowed,
  isGuestOnly,
  isParticipantOnly,
} from "../features/auth/guest-navigation";
import {
  hasJobStaffRole,
  hasTeachingRole,
} from "../features/auth/internal-capabilities";
import { administrationLinks } from "../features/admin/navigation-links";
import { useAuth } from "../features/auth/auth-context";
import { useAuthorizationRefresh } from "../features/auth/authorization-refresh";
import { useSignOut } from "../features/auth/sign-out-state";
import type { SearchSession } from "../features/search/search";
import i18n from "../lib/i18n";
import { permissionsQuery, profileQuery, userRolesQuery } from "../lib/queries";
import {
  installationBrand,
  portalInternalEdition,
} from "../lib/installation-brand";
import { financeWorkspaceAccess } from "./finance-access";
import { Button } from "../components/ui/button";
import { ErrorState, Loading, Notice } from "../components/common";
import "../features/learning/i18n";
import "../features/workbench/finance-i18n";
import { Preferences } from "../components/preferences";
import { PortalTour } from "../features/help/tour";
import { OfflineSchedule } from "../features/calendar/offline";
import { clearOfflineSchedule } from "../features/calendar/offline-store";
import { useOnline } from "../lib/online";
import {
  loadUiPreferences,
  saveUiPreferences,
} from "../lib/ui-preferences-api";
import { useSaveUiPreferences } from "../lib/use-save-ui-preferences";
import {
  reportUiPreferenceChange,
  uiLocalChangeEvent,
  type UiPreferenceField,
} from "../lib/preferences";

/**
 * Render private navigation and the actor-scoped tour; confirm sign-out before clearing private
 * queries. The layout adapts Royal's KW UI `workspace-shell` pattern
 * (`kw-landingpage` 794d46f45b48ca2642e8e589d7be4cb8a5fa6c1d,
 * `app/components/workspace/WorkspaceShell.vue`): collapsed icon rail,
 * named focus/hover tooltips, a compact action toolbar and a complete mobile disclosure. React
 * Router, Supabase-backed capability filtering and Luminovia's existing palette remain authoritative.
 */
const financeNavItem = {
  to: "/finance",
  icon: DollarSign,
  label: "myFinance",
};

export function Shell() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const actor = session!.user.id;
  const { mutateAsync: saveAppearance } = useSaveUiPreferences(actor);
  const navigate = useNavigate();
  const location = useLocation();
  const jobsPath = useMatch("/jobs/*");
  const jobDetailPath = useMatch("/jobs/:id");
  const replacementsPath = useMatch("/replacements");
  // The protected route is keyed by actor; only its current search lives in memory.
  const [search, setSearch] = useState<SearchSession[0]>({ q: "", kind: "" });
  const { attributes: mobileDisclosure, close: closeMobileMore } =
    useDismissibleDisclosure(location.key, true);
  const { attributes: accountDisclosure } = useDismissibleDisclosure(
    location.key,
  );
  const client = useQueryClient();
  // Start with the labelled workspace navigation; remember the user's own choice.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("luminovia.sidebar-collapsed") === "true";
    } catch {
      return true;
    }
  });
  const [uiSaveFailed, setUiSaveFailed] = useState(false);
  const sidebarSaveSeq = useRef(0);
  // Hydrate for the active account once, independent of the translated render.
  // A new language must never trigger a read of the value still being saved.
  useEffect(() => {
    let alive = true;
    const changedLocally = new Set<UiPreferenceField>();
    const changed = (event: Event) => {
      changedLocally.add((event as CustomEvent<UiPreferenceField>).detail);
    };
    window.addEventListener(uiLocalChangeEvent, changed);
    void loadUiPreferences()
      .then((saved) => {
        if (!alive) return;
        if (!changedLocally.has("language"))
          void i18n.changeLanguage(saved.language);
        if (!changedLocally.has("theme"))
          window.dispatchEvent(
            new CustomEvent("luminovia-theme-changed", { detail: saved.theme }),
          );
        if (!changedLocally.has("sidebar_collapsed"))
          setCollapsed(saved.sidebar_collapsed);
      })
      .catch(() => {});
    return () => {
      alive = false;
      window.removeEventListener(uiLocalChangeEvent, changed);
    };
  }, [actor]);
  const {
    signOut: logout,
    pending: signoutPending,
    failed: signoutFailed,
  } = useSignOut(() => {
    client.clear();
    navigate("/login", { replace: true });
  });
  const profile = useQuery(profileQuery(session!.user.id));
  const roles = useQuery(userRolesQuery(session!.user.id));
  const guestOnly = isGuestOnly(roles.data);
  const participantOnly = isParticipantOnly(roles.data);
  const limitedAccount = guestOnly || participantOnly;
  const permissions = useQuery({
    ...permissionsQuery(session!.user.id),
    enabled: !roles.isPending && !roles.isError && !limitedAccount,
  });
  useAuthorizationRefresh(
    session!.user.id,
    roles.data,
    limitedAccount ? [] : permissions.data,
  );
  const online = useOnline();

  function toggleSidebar() {
    const collapsedNext = !collapsed;
    reportUiPreferenceChange("sidebar_collapsed");
    setCollapsed(collapsedNext);
    try {
      localStorage.setItem(
        "luminovia.sidebar-collapsed",
        String(collapsedNext),
      );
    } catch {
      // Keep the current shell usable when browser storage is unavailable.
    }
    const seq = ++sidebarSaveSeq.current;
    setUiSaveFailed(false);
    void saveUiPreferences({ sidebar_collapsed: collapsedNext }).catch(() => {
      if (sidebarSaveSeq.current === seq) setUiSaveFailed(true);
    });
  }

  const profileDenied =
    profile.data?.active === false || (profile.isSuccess && !profile.data);
  const minimalOffline =
    !limitedAccount &&
    !online &&
    !profileDenied &&
    (profile.isPending || profile.isError || (roles.isPending && !roles.data));
  // A known inactive/missing profile never falls back to an old snapshot. This
  // clears only the opt-in schedule; native Auth/session semantics stay intact.
  useEffect(() => {
    if (profileDenied) void clearOfflineSchedule().catch(() => {});
  }, [profileDenied, actor]);
  const personalContracts =
    !limitedAccount &&
    roles.isSuccess &&
    (hasTeachingRole(roles.data) ||
      permissions.data?.includes("contracts.read") ||
      permissions.data?.includes("contracts.manage"));
  const staff = roles.isSuccess && hasJobStaffRole(roles.data);
  const clientPortalAccess = roles.data?.includes("client") ?? false;
  const learnerAccess = roles.data?.includes("participant") ?? false;
  const financeAccess = financeWorkspaceAccess(roles.data, permissions.data);
  const administration = administrationLinks(
    roles.data,
    permissions.data,
    profile.data?.active === true && !roles.isError && !permissions.isError,
  );
  const inAdministrationSection = administration.some(({ to, end }) =>
    matchPath({ path: to, end: end ?? false }, location.pathname),
  );
  const navigation = participantOnly
    ? [
        { to: "/learning", icon: GraduationCap, label: "myCourses" },
        { to: "/my-reviews", icon: FileCheck2, label: "myReviews" },
        { to: "/notifications", icon: Bell, label: "notifications" },
      ]
    : guestOnly
      ? [
          { to: "/profile", icon: UserRound, label: "profile" },
          { to: "/settings", icon: Settings2, label: "personalSettings" },
          { to: "/assistance", icon: BookOpen, label: "helpSupport" },
        ]
      : [
          { to: "/", icon: Home, label: "home" },
          ...(staff
            ? [{ to: "/jobs", icon: BriefcaseBusiness, label: "jobs" }]
            : []),
          { to: "/calendar", icon: CalendarDays, label: "calendar" },
          {
            to: "/courses",
            icon: GraduationCap,
            label: permissions.data?.includes("courses.manage")
              ? "coursesManage"
              : clientPortalAccess
                ? "clientCourses"
                : "myCourses",
          },
          ...(learnerAccess
            ? [
                {
                  to: "/learning",
                  icon: GraduationCap,
                  label: "learningWorkspace",
                },
                { to: "/my-reviews", icon: FileCheck2, label: "myReviews" },
              ]
            : []),
          ...(!administration.some(({ to }) => to === "/people")
            ? [{ to: "/people", icon: Users, label: "staffDirectory" }]
            : []),
          { to: "/chats", icon: MessagesSquare, label: "chats" },
          { to: "/files", icon: FolderOpen, label: "files" },
          ...(portalInternalEdition && financeAccess.personal.sidebar
            ? [financeNavItem]
            : []),
          ...(portalInternalEdition && financeAccess.company.accounting
            ? [
                {
                  to: "/client/finance",
                  icon: DollarSign,
                  label: "companyFinance",
                },
              ]
            : []),
          ...(!administration.some(({ to }) => to === "/changes") &&
          (staff || clientPortalAccess)
            ? [{ to: "/changes", icon: FileCheck2, label: "assignmentChanges" }]
            : []),
          ...(clientPortalAccess
            ? [{ to: "/client", icon: Building2, label: "clientPortal" }]
            : []),
          { to: "/assistance", icon: BookOpen, label: "helpSupport" },
          ...(!administration.some(({ to }) => to === "/topics")
            ? [{ to: "/topics", icon: BookOpen, label: "topics" }]
            : []),
          ...(administration.length
            ? [
                {
                  to: "/admin",
                  icon: Settings2,
                  label: "admin",
                  sectionActive: inAdministrationSection,
                },
              ]
            : []),
        ];
  // Paused role reads cannot replace the existing actor-scoped offline schedule
  // fallback or conceal a profile already known to be inactive/missing.
  if (online && !profileDenied && !profile.isError && roles.isPending)
    return <Loading />;
  if (online && !profileDenied && !profile.isError && roles.isError)
    return <ErrorState retry={() => void roles.refetch()} />;
  if (guestOnly && !guestRouteAllowed(location.pathname))
    return <Navigate to="/profile" replace />;
  // Keep standalone learners out of operational page loaders, including on direct links.
  if (
    participantOnly &&
    !/^\/(?:learning|my-reviews|notifications|profile|api\/docs|auth\/password|courses\/[^/]+\/workspace)\/?$/.test(
      location.pathname,
    )
  )
    return <Navigate to="/learning" replace />;
  if (online && !profileDenied && !profile.isError && !limitedAccount) {
    const companyJobDetail =
      clientPortalAccess &&
      /^[0-9a-f-]{36}$/i.test(jobDetailPath?.params.id ?? "");
    if (!staff && !companyJobDetail && (jobsPath || replacementsPath))
      return <Navigate to={clientPortalAccess ? "/client" : "/"} replace />;
  }
  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <Sidebar
        collapsed={collapsed}
        navigation={navigation}
        onToggle={toggleSidebar}
        onSignout={() => void logout()}
        signoutPending={signoutPending}
      />
      <div className="workspace">
        <header className="topbar" aria-label={t("workspace")}>
          {!limitedAccount && (
            <form
              key={actor}
              className="header-global-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                const q = String(
                  new FormData(event.currentTarget).get("q") ?? "",
                )
                  .trim()
                  .slice(0, 100);
                setSearch({ q, kind: "" });
                navigate("/search", {
                  replace: location.pathname === "/search",
                });
              }}
            >
              <label htmlFor="portal-global-search" className="sr-only">
                {t("portalSearch")}
              </label>
              <input
                id="portal-global-search"
                name="q"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                maxLength={100}
                placeholder={t("portalSearch")}
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                aria-label={t("portalSearchSubmit")}
                title={t("portalSearchSubmit")}
              >
                <Search size={20} aria-hidden="true" />
              </Button>
            </form>
          )}
          <div className="topbar-actions">
            {profile.data?.active && online && !guestOnly && (
              <NotificationsMenu id={actor} zone={profile.data.time_zone} />
            )}
            <Preferences onSave={saveAppearance} />
            <details className="account-menu" {...accountDisclosure}>
              <summary title={t("profile")}>
                {limitedAccount ? (
                  <span
                    className="profile-avatar profile-avatar-small"
                    aria-hidden="true"
                  >
                    {profile.data?.display_name?.slice(0, 1) || "G"}
                  </span>
                ) : (
                  <Avatar
                    userId={actor}
                    name={profile.data?.display_name ?? ""}
                    decorative
                  />
                )}
                <span className="account-menu-label">
                  <span
                    className="account-menu-name"
                    title={profile.data?.display_name}
                  >
                    {profile.data?.display_name}
                  </span>
                  <small>{t("profile")}</small>
                </span>
                <span aria-hidden="true">⌄</span>
              </summary>
              <div className="account-menu-panel">
                <NavLink to="/profile">{t("profile")}</NavLink>
                {personalContracts && (
                  <NavLink to="/profile/contracts">{t("myContracts")}</NavLink>
                )}
                {!participantOnly && (
                  <NavLink to="/settings">{t("personalSettings")}</NavLink>
                )}
              </div>
            </details>
            <details className="mobile-more" {...mobileDisclosure}>
              <summary aria-label={t("more")} aria-controls="mobile-shell-menu">
                <Menu size={20} aria-hidden="true" />
              </summary>
              <div id="mobile-shell-menu" className="mobile-menu-panel">
                <PortalNavigation
                  id="mobile-shell-navigation"
                  items={navigation}
                  ariaLabel={t("menu")}
                  renderLabel={t}
                  onItemClick={() => closeMobileMore(true)}
                />
                <div className="mobile-menu-footer">
                  {signoutFailed && (
                    <Notice kind="error">{t("signOutFailed")}</Notice>
                  )}
                  <Button
                    variant="ghost"
                    className="mobile-menu-signout"
                    onClick={() => void logout()}
                    disabled={signoutPending}
                  >
                    <LogOut size={18} aria-hidden="true" />
                    <span>{t("logout")}</span>
                  </Button>
                </div>
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          {signoutFailed && (
            <div className="shell-signout-failure">
              <Notice kind="error">{t("signOutFailed")}</Notice>
            </div>
          )}
          {uiSaveFailed && (
            <Notice kind="error">{t("uiPreferenceNotSaved")}</Notice>
          )}
          {profileDenied ? (
            <Notice kind="error">{t("profileMissing")}</Notice>
          ) : minimalOffline ? (
            <>
              <Notice>
                {t("calendarSubscriptions:offlineProfileUnavailable")}
              </Notice>
              <OfflineSchedule
                key={`offline-shell-${session!.user.id}`}
                actor={session!.user.id}
                zone={profile.data?.time_zone ?? "UTC"}
                minimal
              />
            </>
          ) : profile.isPending ? (
            <Loading />
          ) : profile.isError ? (
            <ErrorState retry={() => void profile.refetch()} />
          ) : !profile.data?.active ? (
            <Notice kind="error">{t("profileMissing")}</Notice>
          ) : limitedAccount ? (
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          ) : (
            <>
              <AnnouncementBanners actor={session!.user.id} />
              <PortalTour
                key={session!.user.id}
                actor={session!.user.id}
                roles={roles.data ?? []}
                permissions={permissions.data ?? []}
                ready={permissions.isSuccess && roles.isSuccess}
                failed={permissions.isError || roles.isError}
                retrying={permissions.isFetching || roles.isFetching}
                onRetry={() => {
                  void permissions.refetch();
                  void roles.refetch();
                }}
              ></PortalTour>
              <PermanentDeletionProvider>
                <Suspense fallback={<Loading />}>
                  <Outlet
                    context={[search, setSearch] satisfies SearchSession}
                  />
                </Suspense>
              </PermanentDeletionProvider>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** Keep tooltip interactions local to the rail so they do not render the workspace. */
function Sidebar({
  collapsed,
  navigation,
  onToggle,
  onSignout,
  signoutPending,
}: {
  collapsed: boolean;
  navigation: PortalNavigationItem[];
  onToggle: () => void;
  onSignout: () => void;
  signoutPending: boolean;
}) {
  const { t } = useTranslation();
  const [railTooltip, setRailTooltip] = useState<{
    label: string;
    top: number;
    left: number;
  } | null>(null);
  /** Place the active collapsed-link hint in the document layer outside scroll clipping. */
  function showRailTooltip(label: string, element: HTMLElement) {
    if (!collapsed) return;
    const bounds = element.getBoundingClientRect();
    setRailTooltip({
      label: t(label),
      top: bounds.top + bounds.height / 2,
      left: bounds.right + 8,
    });
  }

  return (
    <>
      <aside className="sidebar" aria-label={t("menu")}>
        <NavLink className="sidebar-brand" to="/">
          <img src={installationBrand.mark} alt="" />
          {portalInternalEdition ? (
            <span>
              {installationBrand.shortName} <small>Portal</small>
            </span>
          ) : (
            <span className="installation-brand-name">
              {installationBrand.shortName}
            </span>
          )}
        </NavLink>
        <Button
          variant="ghost"
          className="collapse-button"
          aria-label={t(collapsed ? "expand" : "collapse")}
          aria-expanded={!collapsed}
          aria-describedby={collapsed ? "sidebar-nav-tooltip" : undefined}
          onClick={(event) => {
            // When collapsing, the click itself does not trigger another focus or
            // hover event, so place the newly relevant keyboard/mouse hint now.
            const willCollapse = !collapsed;
            onToggle();
            if (willCollapse) {
              const bounds = event.currentTarget.getBoundingClientRect();
              setRailTooltip({
                label: t("expand"),
                top: bounds.top + bounds.height / 2,
                left: bounds.right + 8,
              });
            } else {
              setRailTooltip(null);
            }
          }}
          onMouseEnter={(event) =>
            showRailTooltip(
              collapsed ? "expand" : "collapse",
              event.currentTarget,
            )
          }
          onMouseLeave={() => setRailTooltip(null)}
          onFocus={(event) =>
            showRailTooltip(
              collapsed ? "expand" : "collapse",
              event.currentTarget,
            )
          }
          onBlur={() => setRailTooltip(null)}
        >
          {collapsed ? (
            <PanelLeftOpen size={20} />
          ) : (
            <PanelLeftClose size={20} />
          )}
          <span>{t(collapsed ? "expand" : "collapse")}</span>
        </Button>
        <PortalNavigation
          items={navigation}
          ariaLabel={t("menu")}
          ariaDescribedBy="sidebar-nav-tooltip"
          collapsed={collapsed}
          renderLabel={t}
          onItemFocus={(label, element) => showRailTooltip(label, element)}
          onItemMouseLeave={(event) => {
            if (document.activeElement !== event.currentTarget)
              setRailTooltip(null);
          }}
          onItemBlur={(event) => {
            if (!event.currentTarget.matches(":hover")) setRailTooltip(null);
          }}
        />
        <div className="sidebar-bottom">
          <Button
            variant="ghost"
            className="sidebar-signout"
            onClick={onSignout}
            aria-label={t("logout")}
            aria-describedby={collapsed ? "sidebar-nav-tooltip" : undefined}
            title={collapsed ? t("logout") : undefined}
            onMouseEnter={(event) =>
              showRailTooltip("logout", event.currentTarget)
            }
            onMouseLeave={(event) => {
              if (document.activeElement !== event.currentTarget)
                setRailTooltip(null);
            }}
            onFocus={(event) => showRailTooltip("logout", event.currentTarget)}
            onBlur={() => setRailTooltip(null)}
            disabled={signoutPending}
          >
            <LogOut size={18} aria-hidden="true" />
            <span>{t("logout")}</span>
          </Button>
        </div>
      </aside>
      {collapsed &&
        railTooltip &&
        createPortal(
          <span
            id="sidebar-nav-tooltip"
            className="sidebar-tooltip-portal"
            role="tooltip"
            style={{ top: railTooltip.top, left: railTooltip.left }}
          >
            {railTooltip.label}
          </span>,
          document.body,
        )}
    </>
  );
}
