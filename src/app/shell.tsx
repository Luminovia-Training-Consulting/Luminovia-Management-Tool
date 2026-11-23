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
  ChartNoAxesCombined,
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
  Wallet,
} from "lucide-react";
import { Avatar } from "../features/profile/avatar";
import { PortalNavigation } from "../components/portal-navigation";
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
import { useAuth } from "../features/auth/auth-context";
import { useAuthorizationRefresh } from "../features/auth/authorization-refresh";
import { useSignOut } from "../features/auth/sign-out-state";
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
import { uiLocalChangeEvent } from "../lib/preferences";

/**
 * Render private navigation and the actor-scoped tour; confirm sign-out before clearing private
 * queries. The layout adapts Royal's KW UI `workspace-shell` pattern
 * (`kw-landingpage` 794d46f45b48ca2642e8e589d7be4cb8a5fa6c1d,
 * `app/components/workspace/WorkspaceShell.vue`): collapsed icon rail,
 * named focus/hover tooltips, a compact action toolbar and a complete mobile disclosure. React
 * Router, Supabase-backed capability filtering and Luminovia's existing palette remain authoritative.
 */
const financeNavItem = { to: "/finance", icon: Wallet, label: "finance" };

export function Shell() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const actor = session!.user.id;
  const navigate = useNavigate();
  const location = useLocation();
  const { attributes: mobileDisclosure, close: closeMobileMore } =
    useDismissibleDisclosure(location.key, true);
  const { attributes: accountDisclosure } = useDismissibleDisclosure(
    location.key,
  );
  const [railTooltip, setRailTooltip] = useState<{
    label: string;
    top: number;
    left: number;
  } | null>(null);
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
  const teaching = roles.isSuccess && hasTeachingRole(roles.data);
  const staff = roles.isSuccess && hasJobStaffRole(roles.data);
  const clientPortalAccess = roles.data?.includes("client") ?? false;
  const learnerAccess = roles.data?.includes("participant") ?? false;
  const financeAccess = financeWorkspaceAccess(roles.data, permissions.data);
  const manage = Boolean(
    permissions.data?.includes("jobs.manage") ||
    permissions.data?.includes("announcements.manage"),
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
          { to: "/settings", icon: Settings2, label: "settings" },
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
          ...(permissions.data?.includes("organisations.manage")
            ? [{ to: "/clients", icon: Building2, label: "companies" }]
            : []),
          { to: "/people", icon: Users, label: "staffDirectory" },
          { to: "/chats", icon: MessagesSquare, label: "communication" },
          { to: "/files", icon: FolderOpen, label: "files" },
          ...(teaching || permissions.data?.includes("contracts.read")
            ? [{ to: "/contracts", icon: FileCheck2, label: "contracts" }]
            : []),
          ...(portalInternalEdition &&
          (financeAccess.overview ||
            financeAccess.accounting ||
            financeAccess.analytics)
            ? [financeNavItem]
            : []),
          ...(permissions.data?.includes("jobs.manage")
            ? [
                {
                  to: "/control-center",
                  icon: ChartNoAxesCombined,
                  label: "controlCenter",
                },
              ]
            : []),
          ...(staff || clientPortalAccess
            ? [{ to: "/changes", icon: FileCheck2, label: "assignmentChanges" }]
            : []),
          ...(clientPortalAccess
            ? [{ to: "/client", icon: Building2, label: "clientPortal" }]
            : []),
          { to: "/assistance", icon: BookOpen, label: "helpSupport" },
          { to: "/topics", icon: BookOpen, label: "topics" },
          ...(manage
            ? [{ to: "/admin", icon: Settings2, label: "admin" }]
            : []),
          { to: "/settings", icon: Settings2, label: "settings" },
          { to: "/profile", icon: UserRound, label: "profile" },
        ];
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
  if (online && !profileDenied && !profile.isError && !limitedAccount) {
    const companyJobDetail =
      clientPortalAccess &&
      /^\/jobs\/[0-9a-f-]{36}\/?$/i.test(location.pathname);
    if (
      !staff &&
      !companyJobDetail &&
      /^\/(?:jobs(?:\/|$)|replacements\/?$)/.test(location.pathname)
    )
      return <Navigate to={clientPortalAccess ? "/client" : "/"} replace />;
    if (
      /^\/finance\/?$/.test(location.pathname) &&
      ["claim", "series"].some((key) =>
        new URLSearchParams(location.search).has(key),
      )
    ) {
      if (permissions.isPending) return <Loading />;
      if (permissions.isError)
        return <ErrorState retry={() => void permissions.refetch()} />;
      if (!financeAccess.overview)
        return <Navigate to={clientPortalAccess ? "/client" : "/"} replace />;
    }
  }
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
          items={navigation.filter(
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
          {!limitedAccount && (
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
            {profile.data?.active && online && !guestOnly && (
              <NotificationsMenu id={actor} zone={profile.data.time_zone} />
            )}
            <Preferences onSave={saveUiPreferences} />
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
            <details className="mobile-more" {...mobileDisclosure}>
              <summary
                aria-label={t("more")}
                aria-controls="mobile-shell-navigation"
              >
                <Menu size={20} aria-hidden="true" />
              </summary>
              <div className="mobile-menu-panel">
                <PortalNavigation
                  id="mobile-shell-navigation"
                  items={navigation}
                  ariaLabel={t("menu")}
                  renderLabel={t}
                  onItemClick={() => closeMobileMore(true)}
                />
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          {signoutFailed && <Notice kind="error">{t("signOutFailed")}</Notice>}
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
