/**
 * Shared desktop/mobile shell for navigation, search, notifications and preferences.
 * Loaded capabilities shape visible actions and guidance; the backend authorizes access.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AnnouncementBanners } from "../features/announcements/announcements";
import {
  MessagesSquare,
  FolderOpen,
  BookOpen,
  GraduationCap,
  Building2,
  FileCheck2,
  Wallet,
  MessageCircle,
  Menu,
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  Home,
  LogOut,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
  Star,
  PanelLeftClose,
  PanelLeftOpen,
  ListChecks,
  ClipboardCheck,
  LifeBuoy,
  ArrowRightLeft,
  Inbox,
  Compass,
  X,
} from "lucide-react";
import { WelcomeGuideEntry } from "../features/onboarding/welcome";
import { NotificationsMenu } from "../features/notifications/notifications";
import { useAuth } from "../features/auth/auth-context";
import { useAuthorizationRefresh } from "../features/auth/authorization-refresh";
import { db } from "../lib/supabase";
import { permissionsQuery, profileQuery, userRolesQuery } from "../lib/queries";
import { Button } from "../components/ui/button";
import { ErrorState, Loading, Notice } from "../components/common";
import "../features/learning/i18n";
import "../features/workbench/i18n";
import "../features/workbench/finance-i18n";
import { Preferences } from "../components/preferences";
import { PortalTour } from "../features/help/tour";
import { OfflineSchedule } from "../features/calendar/offline";
import { clearOfflineSchedule } from "../features/calendar/offline-store";
import { useOnline } from "../lib/online";
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
  const sidebarSearchInput = useRef<HTMLInputElement>(null);
  const sidebarSearchButton = useRef<HTMLButtonElement>(null);
  const restoreSearchFocus = useRef(false);
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
  // Match the Royal workspace rail default and remember only this visual choice.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("luminovia.sidebar-collapsed") !== "false";
    } catch {
      return true;
    }
  });
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const previousActor = useRef(actor);
  useEffect(() => {
    if (previousActor.current === actor) return;
    previousActor.current = actor;
    setSearch("");
    setSearchOpen(false);
  }, [actor]);
  const [signoutFailed, setSignoutFailed] = useState(false);
  const [signoutPending, setSignoutPending] = useState(false);
  const profile = useQuery(profileQuery(session!.user.id));
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const roles = useQuery(userRolesQuery(session!.user.id));
  useAuthorizationRefresh(session!.user.id, roles.data, permissions.data);
  const online = useOnline();
  useEffect(() => {
    if (searchOpen && collapsed) sidebarSearchInput.current?.focus();
    if (!searchOpen && restoreSearchFocus.current) {
      restoreSearchFocus.current = false;
      sidebarSearchButton.current?.focus();
    }
  }, [searchOpen, collapsed]);
  function closeSidebarSearch() {
    if (collapsed) restoreSearchFocus.current = true;
    setSearchOpen(false);
  }
  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("luminovia.sidebar-collapsed", String(next));
      } catch {
        // Keep the current shell usable when browser storage is unavailable.
      }
      return next;
    });
  }
  const profileDenied =
    profile.data?.active === false || (profile.isSuccess && !profile.data);
  const minimalOffline =
    !online && !profileDenied && (profile.isPending || profile.isError);
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
  const clientPortalAccess =
    roles.data?.some((role) => ["owner", "admin", "client"].includes(role)) ??
    false;
  const reviews =
    roles.data?.some((role) =>
      ["owner", "admin", "participant"].includes(role),
    ) ?? false;
  const manage = Boolean(
    permissions.data?.includes("jobs.manage") ||
    permissions.data?.includes("announcements.manage"),
  );
  const navigation = [
    { to: "/", icon: Home, label: "home" },
    ...(staff ? [{ to: "/jobs", icon: BriefcaseBusiness, label: "jobs" }] : []),
    { to: "/calendar", icon: CalendarDays, label: "calendar" },
    { to: "/chats", icon: MessagesSquare, label: "chats" },
    { to: "/files", icon: FolderOpen, label: "files" },
    { to: "/search", icon: Search, label: "portalSearch" },
    { to: "/courses", icon: GraduationCap, label: "courses" },
    ...(staff
      ? [
          { to: "/readiness", icon: ListChecks, label: "courseReadiness" },
          { to: "/replacements", icon: ArrowRightLeft, label: "replacements" },
        ]
      : []),
    ...(staff || clientPortalAccess
      ? [{ to: "/delivery", icon: ClipboardCheck, label: "teachingDelivery" }]
      : []),
    { to: "/support", icon: LifeBuoy, label: "supportDesk" },
    { to: "/learning", icon: BookOpen, label: "learning:hub" },
    { to: "/workbench", icon: FileCheck2, label: "workbench:title" },
    ...(staff
      ? [{ to: "/timesheets", icon: Wallet, label: "financeOps:timesheets" }]
      : []),
    ...(manage
      ? [
          {
            to: "/control-center",
            icon: Settings2,
            label: "financeOps:controlCenter",
          },
        ]
      : []),
    { to: "/people", icon: Users, label: "staffDirectory" },
    ...(clientPortalAccess
      ? [{ to: "/client", icon: Building2, label: "clientPortal" }]
      : []),
    ...(reviews ? [{ to: "/my-reviews", icon: Star, label: "myReviews" }] : []),
    ...(teaching || permissions.data?.includes("contracts.read")
      ? [{ to: "/contracts", icon: FileCheck2, label: "contracts" }]
      : []),
    ...(teaching || permissions.data?.includes("finance.manage")
      ? [{ to: "/finance", icon: Wallet, label: "finance" }]
      : []),
    ...(permissions.data?.includes("organisations.manage")
      ? [
          { to: "/clients", icon: Building2, label: "clients" },
          { to: "/enquiries", icon: Inbox, label: "websiteEnquiries" },
        ]
      : []),
    ...(staff ? [{ to: "/wiki", icon: BookOpen, label: "wiki" }] : []),
    ...(staff ? [{ to: "/forum", icon: MessageCircle, label: "forum" }] : []),
    { to: "/notifications", icon: MessageCircle, label: "notifications" },
    { to: "/announcements", icon: MessageCircle, label: "announcements" },
    { to: "/topics", icon: BookOpen, label: "topics" },
    ...(staff
      ? [{ to: "/availability", icon: CalendarDays, label: "availability" }]
      : []),
    { to: "/settings", icon: Settings2, label: "settings" },
    { to: "/profile", icon: UserRound, label: "profile" },
    { to: "/security", icon: ShieldCheck, label: "security" },
    { to: "/help", icon: BookOpen, label: "helpGuides" },
    { to: "/welcome", icon: Compass, label: "welcome:nav" },
    ...(manage ? [{ to: "/admin", icon: Settings2, label: "admin" }] : []),
  ];
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
  return (
    <div
      className={`app-shell ${collapsed ? "is-collapsed" : ""} ${searchOpen ? "has-sidebar-search-open" : ""}`}
    >
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <aside className="sidebar" aria-label={t("menu")}>
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
        <form
          className={`global-search sidebar-global-search ${collapsed && !searchOpen ? "is-icon-only" : ""}`}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(`/search?q=${encodeURIComponent(search)}`);
            closeSidebarSearch();
          }}
        >
          {collapsed && !searchOpen ? (
            <Button
              ref={sidebarSearchButton}
              type="button"
              variant="ghost"
              aria-label={t("search")}
              aria-describedby="sidebar-nav-tooltip"
              onClick={() => setSearchOpen(true)}
              onMouseEnter={(event) =>
                showRailTooltip("search", event.currentTarget)
              }
              onMouseLeave={() => setRailTooltip(null)}
              onFocus={(event) =>
                showRailTooltip("search", event.currentTarget)
              }
              onBlur={() => setRailTooltip(null)}
            >
              <Search size={19} aria-hidden="true" />
            </Button>
          ) : (
            <>
              <Search size={18} aria-hidden="true" />
              <label htmlFor="sidebar-global-search" className="sr-only">
                {t("search")}
              </label>
              <input
                id="sidebar-global-search"
                ref={sidebarSearchInput}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("portalSearch")}
              />
              {collapsed && (
                <button
                  type="button"
                  className="sidebar-search-close"
                  aria-label={t("close")}
                  onClick={closeSidebarSearch}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </form>
        {profile.data?.active && !minimalOffline && (
          <div
            className="sidebar-notifications"
            data-tooltip={t("notifications")}
          >
            <NotificationsMenu
              id={session!.user.id}
              zone={profile.data.time_zone}
            />
          </div>
        )}
        <nav aria-label={t("menu")}>
          {navigation.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              aria-label={collapsed ? t(label) : undefined}
              aria-describedby={collapsed ? "sidebar-nav-tooltip" : undefined}
              onMouseEnter={(event) =>
                showRailTooltip(label, event.currentTarget)
              }
              onMouseLeave={(event) => {
                if (document.activeElement !== event.currentTarget) {
                  setRailTooltip(null);
                }
              }}
              onFocus={(event) => showRailTooltip(label, event.currentTarget)}
              onBlur={(event) => {
                if (!event.currentTarget.matches(":hover")) {
                  setRailTooltip(null);
                }
              }}
            >
              <Icon size={20} aria-hidden="true" />
              <span className="sidebar-link-label">{t(label)}</span>
            </NavLink>
          ))}
        </nav>
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
          <div className="topbar-actions">
            <Preferences />
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
                {profile.data?.active && !minimalOffline && (
                  <NotificationsMenu
                    id={session!.user.id}
                    zone={profile.data.time_zone}
                  />
                )}
                <nav id="mobile-shell-navigation" aria-label={t("menu")}>
                  {navigation.map(({ to, icon: Icon, label }) => (
                    <NavLink key={to} to={to} end={to === "/"}>
                      <Icon size={18} aria-hidden="true" />
                      {t(label)}
                    </NavLink>
                  ))}
                </nav>
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          {signoutFailed && <Notice kind="error">{t("error")}</Notice>}
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
              >
                <WelcomeGuideEntry />
              </PortalTour>
              <Outlet />
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
