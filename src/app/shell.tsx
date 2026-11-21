/**
 * Shared desktop/mobile shell for navigation, search, notifications and preferences.
 * Loaded capabilities shape visible actions and guidance; the backend authorizes access.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Navigate,
  NavLink,
  Outlet,
  useLocation,
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
  ChevronLeft,
  FileCheck2,
  FolderOpen,
  GraduationCap,
  Home,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { Avatar } from "../features/profile/avatar";
import { type PreviewRole, RolePreview } from "./role-preview";
import { PortalNavigation } from "../components/portal-navigation";
import { NotificationsMenu } from "../features/notifications/notifications-menu";
import {
  guestRouteAllowed,
  isGuestOnly,
  isParticipantOnly,
} from "../features/auth/guest-navigation";
import { useAuth } from "../features/auth/auth-context";
import { useAuthorizationRefresh } from "../features/auth/authorization-refresh";
import { db } from "../lib/supabase";
import i18n from "../lib/i18n";
import { permissionsQuery, profileQuery, userRolesQuery } from "../lib/queries";
import {
  installationBrand,
  portalInternalEdition,
} from "../lib/installation-brand";
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
import { uiLocalChangeEvent } from "../lib/preferences";

export { Preferences } from "../components/preferences";

/**
 * Render private navigation and the actor-scoped tour; confirm sign-out before clearing private
 * queries. The layout adapts Royal's KW UI `workspace-shell` pattern
 * (`kw-landingpage` 794d46f45b48ca2642e8e589d7be4cb8a5fa6c1d,
 * `app/components/workspace/WorkspaceShell.vue`): collapsed icon rail,
 * named focus/hover tooltips, a compact action toolbar and a complete mobile disclosure. React
 * Router, Supabase-backed capability filtering and Luminovia's existing palette remain authoritative.
 */
export function Shell() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const actor = session!.user.id;
  const navigate = useNavigate();
  const location = useLocation();
  const mobileMore = useRef<HTMLDetailsElement>(null);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (accountMenu.current) accountMenu.current.open = false;
  }, [location]);
  const [railTooltip, setRailTooltip] = useState<{
    label: string;
    top: number;
    left: number;
  } | null>(null);
  // Native details survives route changes with the Shell. Close its overlay
  // after every actual navigation, including query changes and browser back.
  // Keep keyboard focus visible when its selected link becomes hidden, but do
  // not take focus from a header search or another control outside the menu.
  useEffect(() => {
    const menu = mobileMore.current;
    if (!menu?.open) return;
    const focusInside = menu.contains(document.activeElement);
    menu.open = false;
    if (focusInside) menu.querySelector("summary")?.focus();
  }, [location]);
  const client = useQueryClient();
  // Start with the labelled workspace navigation; remember the user's own choice.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("luminovia.sidebar-collapsed") === "true";
    } catch {
      return true;
    }
  });
  const [chosenPreview, setPreviewMode] = useState<PreviewRole | null>(null);
  const [uiSaveFailed, setUiSaveFailed] = useState(false);
  // Hydrate for the active account once, independent of the translated render.
  // A new language must never trigger a read of the value still being saved.
  useEffect(() => {
    let alive = true;
    let changedLocally = false;
    const changed = () => {
      changedLocally = true;
    };
    window.addEventListener(uiLocalChangeEvent, changed);
    void loadUiPreferences()
      .then((saved) => {
        if (!alive || changedLocally) return;
        void i18n.changeLanguage(saved.language);
        window.dispatchEvent(
          new CustomEvent("luminovia-theme-changed", { detail: saved.theme }),
        );
        setCollapsed(saved.sidebar_collapsed);
      })
      .catch(() => {});
    return () => {
      alive = false;
      window.removeEventListener(uiLocalChangeEvent, changed);
    };
  }, [actor]);
  const [search, setSearch] = useState("");
  const previousActor = useRef(actor);
  useEffect(() => {
    if (previousActor.current === actor) return;
    previousActor.current = actor;
    setSearch("");
  }, [actor]);
  const [signoutFailed, setSignoutFailed] = useState(false);
  const [signoutPending, setSignoutPending] = useState(false);
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
    window.dispatchEvent(new Event(uiLocalChangeEvent));
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("luminovia.sidebar-collapsed", String(next));
      } catch {
        // Keep the current shell usable when browser storage is unavailable.
      }
      setUiSaveFailed(false);
      void saveUiPreferences({ sidebar_collapsed: next }).catch(() =>
        setUiSaveFailed(true),
      );
      return next;
    });
  }

  const profileDenied =
    profile.data?.active === false || (profile.isSuccess && !profile.data);
  const minimalOffline =
    !limitedAccount &&
    !online &&
    !profileDenied &&
    (profile.isPending || profile.isError);
  // A known inactive/missing profile never falls back to an old snapshot. This
  // clears only the opt-in schedule; native Auth/session semantics stay intact.
  useEffect(() => {
    if (profileDenied) void clearOfflineSchedule().catch(() => {});
  }, [profileDenied, actor]);
  const teaching =
    roles.data?.some((role) =>
      ["owner", "admin", "lecturer", "senior_lecturer"].includes(role),
    ) ?? false;
  const staff = teaching || Boolean(roles.data?.includes("management"));
  const clientPortalAccess = roles.data?.includes("client") ?? false;
  const manage = Boolean(
    permissions.data?.includes("jobs.manage") ||
    permissions.data?.includes("announcements.manage"),
  );
  const previewAllowed =
    roles.data?.some((role) =>
      ["owner", "admin", "management"].includes(role),
    ) ?? false;
  const previewMode =
    previewAllowed && online && !guestOnly ? chosenPreview : null;
  const navigation = participantOnly
    ? [
        { to: "/learning", icon: GraduationCap, label: "myCourses" },
        { to: "/my-reviews", icon: FileCheck2, label: "myReviews" },
        { to: "/notifications", icon: Bell, label: "notifications" },
      ]
    : guestOnly
      ? [
          { to: "/profile", icon: UserRound, label: "profile" },
          { to: "/settings", icon: Settings2, label: "settings" },
          { to: "/wiki", icon: BookOpen, label: "knowledgeHelp" },
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
          ...(permissions.data?.includes("organisations.manage")
            ? [{ to: "/clients", icon: Building2, label: "clients" }]
            : []),
          { to: "/people", icon: Users, label: "staffDirectory" },
          { to: "/chats", icon: MessagesSquare, label: "chats" },
          { to: "/files", icon: FolderOpen, label: "files" },
          ...(teaching || permissions.data?.includes("contracts.read")
            ? [{ to: "/contracts", icon: FileCheck2, label: "contracts" }]
            : []),
          ...(teaching || permissions.data?.includes("finance.manage")
            ? [{ to: "/finance", icon: Wallet, label: "finance" }]
            : []),
          ...(teaching ||
          clientPortalAccess ||
          permissions.data?.includes("finance.manage")
            ? [{ to: "/accounting", icon: Wallet, label: "accountingExports" }]
            : []),
          ...(staff || clientPortalAccess
            ? [{ to: "/changes", icon: FileCheck2, label: "assignmentChanges" }]
            : []),
          ...(clientPortalAccess
            ? [{ to: "/client", icon: Building2, label: "clientPortal" }]
            : []),
          { to: "/wiki", icon: BookOpen, label: "knowledgeHelp" },
          ...(staff
            ? [{ to: "/forum", icon: MessageCircle, label: "forum" }]
            : []),
          { to: "/topics", icon: BookOpen, label: "topics" },
          ...(manage
            ? [{ to: "/admin", icon: Settings2, label: "admin" }]
            : []),
          { to: "/settings", icon: Settings2, label: "settings" },
          { to: "/profile", icon: UserRound, label: "profile" },
        ];
  const previewNavigation = {
    management: [
      { to: "/", icon: Home, label: "home" },
      { to: "/jobs", icon: BriefcaseBusiness, label: "jobs" },
      { to: "/calendar", icon: CalendarDays, label: "calendar" },
      { to: "/courses", icon: GraduationCap, label: "coursesManage" },
      { to: "/clients", icon: Building2, label: "clients" },
      { to: "/people", icon: Users, label: "staffDirectory" },
      { to: "/chats", icon: MessagesSquare, label: "chats" },
      { to: "/files", icon: FolderOpen, label: "files" },
      { to: "/contracts", icon: FileCheck2, label: "contracts" },
      { to: "/finance", icon: Wallet, label: "finance" },
      { to: "/changes", icon: FileCheck2, label: "assignmentChanges" },
      { to: "/forum", icon: MessageCircle, label: "forum" },
      { to: "/topics", icon: BookOpen, label: "topics" },
      { to: "/admin", icon: Settings2, label: "admin" },
      { to: "/settings", icon: Settings2, label: "settings" },
      { to: "/profile", icon: UserRound, label: "profile" },
    ],
    lecturer: [
      { to: "/", icon: Home, label: "home" },
      { to: "/jobs", icon: BriefcaseBusiness, label: "jobs" },
      { to: "/calendar", icon: CalendarDays, label: "calendar" },
      { to: "/courses", icon: GraduationCap, label: "myCourses" },
      { to: "/chats", icon: MessagesSquare, label: "chats" },
      { to: "/files", icon: FolderOpen, label: "files" },
      { to: "/contracts", icon: FileCheck2, label: "contracts" },
      { to: "/finance", icon: Wallet, label: "finance" },
      { to: "/changes", icon: FileCheck2, label: "assignmentChanges" },
      { to: "/topics", icon: BookOpen, label: "topics" },
      { to: "/settings", icon: Settings2, label: "settings" },
      { to: "/profile", icon: UserRound, label: "profile" },
    ],
    company: [
      { to: "/", icon: Home, label: "home" },
      { to: "/calendar", icon: CalendarDays, label: "calendar" },
      { to: "/courses", icon: GraduationCap, label: "clientCourses" },
      { to: "/client", icon: Building2, label: "clientPortal" },
      { to: "/changes", icon: FileCheck2, label: "assignmentChanges" },
      { to: "/chats", icon: MessagesSquare, label: "chats" },
      { to: "/files", icon: FolderOpen, label: "files" },
      { to: "/finance", icon: Wallet, label: "finance" },
      { to: "/settings", icon: Settings2, label: "settings" },
      { to: "/profile", icon: UserRound, label: "profile" },
    ],
  } satisfies Record<PreviewRole, typeof navigation>;
  const visibleNavigation =
    previewMode && previewAllowed ? previewNavigation[previewMode] : navigation;

  async function logout() {
    setSignoutFailed(false);
    setSignoutPending(true);
    try {
      const { error } = await db().auth.signOut();
      if (error) throw error;
      client.clear();
      navigate("/login", { replace: true });
    } catch {
      // A rejected SDK/network promise is not a confirmed sign-out. Keep the
      // current screen and private queries available for an explicit retry.
      setSignoutFailed(true);
    } finally {
      setSignoutPending(false);
    }
  }

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
  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
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
            toggleSidebar();
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
          items={visibleNavigation.filter(
            ({ to }) => guestOnly || !["/settings", "/profile"].includes(to),
          )}
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
            onClick={() => void logout()}
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
      <div className="workspace">
        <header className="topbar" aria-label={t("workspace")}>
          {!limitedAccount && !previewMode && (
            <form
              className="global-search header-global-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                navigate(`/search?q=${encodeURIComponent(search)}`);
              }}
            >
              <Search size={20} aria-hidden="true" />
              <label htmlFor="portal-global-search" className="sr-only">
                {t("portalSearch")}
              </label>
              <input
                id="portal-global-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("portalSearch")}
              />
            </form>
          )}
          <div className="topbar-actions">
            {previewAllowed && !guestOnly && (
              <label className="role-preview-switch">
                <span>{t("viewPreview")}</span>
                <select
                  aria-label={t("viewPreview")}
                  value={previewMode ?? "live"}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setSearch("");
                    setPreviewMode(
                      value === "live" ? null : (value as PreviewRole),
                    );
                  }}
                >
                  <option value="live">{t("liveView")}</option>
                  <option value="management">{t("previewManagement")}</option>
                  <option value="lecturer">{t("previewLecturer")}</option>
                  <option value="company">{t("previewCompany")}</option>
                </select>
              </label>
            )}
            {profile.data?.active && online && !guestOnly && !previewMode && (
              <NotificationsMenu id={actor} zone={profile.data.time_zone} />
            )}
            <Preferences onSave={saveUiPreferences} />
            <details className="account-menu" ref={accountMenu}>
              <summary title={t("profile")}>
                {limitedAccount ? (
                  <span className="profile-avatar" aria-hidden="true">
                    {profile.data?.display_name?.slice(0, 1) || "G"}
                  </span>
                ) : (
                  <Avatar
                    userId={actor}
                    name={profile.data?.display_name ?? ""}
                    decorative
                  />
                )}
                <span>
                  {profile.data?.display_name}
                  <small>{t("profile")}</small>
                </span>
                <span aria-hidden="true">⌄</span>
              </summary>
              <div className="account-menu-panel">
                <NavLink to="/profile">{t("profile")}</NavLink>
                {!participantOnly && (
                  <NavLink to="/settings">{t("settings")}</NavLink>
                )}
                <button
                  type="button"
                  disabled={signoutPending}
                  onClick={() => void logout()}
                >
                  {t("logout")}
                </button>
              </div>
            </details>
            <Button
              variant="ghost"
              className="mobile-signout"
              onClick={() => void logout()}
              aria-label={t("logout")}
              disabled={signoutPending}
            >
              <LogOut size={18} aria-hidden="true" />
            </Button>
            <details className="mobile-more" ref={mobileMore}>
              <summary
                aria-label={t("more")}
                aria-controls="mobile-shell-navigation"
              >
                <Menu size={20} aria-hidden="true" />
              </summary>
              <div className="mobile-menu-panel">
                {!limitedAccount && !previewMode && (
                  <form
                    className="global-search mobile-global-search"
                    role="search"
                    onSubmit={(event) => {
                      event.preventDefault();
                      navigate(`/search?q=${encodeURIComponent(search)}`);
                      mobileMore.current?.removeAttribute("open");
                      mobileMore.current?.querySelector("summary")?.focus();
                    }}
                  >
                    <Search size={18} aria-hidden="true" />
                    <label htmlFor="mobile-global-search" className="sr-only">
                      {t("search")}
                    </label>
                    <input
                      id="mobile-global-search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t("portalSearch")}
                    />
                  </form>
                )}
                {profile.data?.active &&
                  online &&
                  !guestOnly &&
                  !previewMode && (
                    <NotificationsMenu
                      id={session!.user.id}
                      zone={profile.data.time_zone}
                    />
                  )}
                <PortalNavigation
                  id="mobile-shell-navigation"
                  items={visibleNavigation}
                  ariaLabel={t("menu")}
                  renderLabel={t}
                  onItemClick={() => {
                    mobileMore.current?.removeAttribute("open");
                    mobileMore.current?.querySelector("summary")?.focus();
                  }}
                />
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          {signoutFailed && <Notice kind="error">{t("error")}</Notice>}
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
          ) : previewMode && previewAllowed ? (
            <RolePreview role={previewMode} path={location.pathname} />
          ) : limitedAccount ? (
            <Outlet />
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
                  <Outlet />
                </Suspense>
              </PermanentDeletionProvider>
            </>
          )}
        </main>
      </div>
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
    </div>
  );
}

/** Return from a job detail view to the job list. */
export function BackLink() {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" asChild>
      <NavLink to="/jobs">
        <ChevronLeft size={18} />
        {t("back")}
      </NavLink>
    </Button>
  );
}
