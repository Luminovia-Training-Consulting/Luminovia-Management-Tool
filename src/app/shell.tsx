import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
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
  ChevronRight,
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
} from "lucide-react";
import { NotificationsMenu } from "../features/notifications/notifications";
import { Avatar } from "../features/profile/avatar";
import { useAuth } from "../features/auth/auth-context";
import { db } from "../lib/supabase";
import { permissionsQuery, profileQuery, userRolesQuery } from "../lib/queries";
import { Button } from "../components/ui/button";
import { ErrorState, Loading, Notice } from "../components/common";
import { readPreference, writePreference } from "../lib/preferences";
export function Preferences() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState(() => {
    const saved = readPreference("theme");
    return saved && ["light", "dark", "system"].includes(saved)
      ? saved
      : "system";
  });
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    writePreference("theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return (
    <div className="preferences">
      <label className="sr-only" htmlFor="language">
        {t("language")}
      </label>
      <select
        id="language"
        aria-label={t("language")}
        value={i18n.language}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
      >
        <option value="de">DE</option>
        <option value="en">EN</option>
      </select>
      <label className="sr-only" htmlFor="theme">
        {t("theme")}
      </label>
      <select
        id="theme"
        aria-label={t("theme")}
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
      >
        <option value="system">◐ {t("system")}</option>
        <option value="light">☀ {t("light")}</option>
        <option value="dark">☾ {t("dark")}</option>
      </select>
    </div>
  );
}
export function Shell() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [signoutFailed, setSignoutFailed] = useState(false);
  const [signoutPending, setSignoutPending] = useState(false);
  const profile = useQuery(profileQuery(session!.user.id));
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const roles = useQuery(userRolesQuery(session!.user.id));
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
      ? [{ to: "/clients", icon: Building2, label: "clients" }]
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
    ...(manage ? [{ to: "/admin", icon: Settings2, label: "admin" }] : []),
  ];
  const mobilePrimary = [
    "/",
    staff ? "/jobs" : clientPortalAccess ? "/client" : "/courses",
    "/calendar",
    "/chats",
  ].flatMap((path) => {
    const item = navigation.find((link) => link.to === path);
    return item ? [item] : [];
  });
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
  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <aside className="sidebar">
        <NavLink className="sidebar-brand" to="/">
          <img src="/brand/luminovia-logo-mark-160.webp" alt="" />
          <span>
            Luminovia <small>PORTAL</small>
          </span>
        </NavLink>
        <div className="rainbow" />
        <p className="sidebar-kicker">{t("workspace")}</p>
        <nav aria-label={t("menu")}>
          {navigation.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              title={collapsed ? t(label) : undefined}
            >
              <Icon size={21} />
              <span>{t(label)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="little-star">✳</span>
            <p>{t("tagline")}</p>
          </div>
          <Button
            variant="ghost"
            className="collapse-button"
            aria-label={t(collapsed ? "expand" : "collapse")}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={20} />
            ) : (
              <PanelLeftClose size={20} />
            )}
            <span>{t("collapse")}</span>
          </Button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Luminovia</span>
            <ChevronRight size={14} />
            <strong>Portal</strong>
          </div>
          <form
            className="global-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/search?q=${encodeURIComponent(search)}`);
            }}
          >
            <Search size={18} />
            <label htmlFor="global-search" className="sr-only">
              {t("search")}
            </label>
            <input
              id="global-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("portalSearch")}
            />
          </form>
          <div className="topbar-actions">
            {profile.data && (
              <NotificationsMenu
                id={session!.user.id}
                zone={profile.data.time_zone}
              />
            )}
            <Preferences />
            <details className="mobile-more">
              <summary aria-label={t("more")}>
                <Menu size={20} />
              </summary>
              <nav>
                {navigation
                  .filter(
                    (item) =>
                      item.to !== "/profile" &&
                      !mobilePrimary.some((primary) => primary.to === item.to),
                  )
                  .map(({ to, label }) => (
                    <NavLink key={to} to={to}>
                      {t(label)}
                    </NavLink>
                  ))}
              </nav>
            </details>
            <NavLink to="/profile" className="avatar" aria-label={t("profile")}>
              <Avatar
                userId={session!.user.id}
                name={profile.data?.display_name || session!.user.email || "L"}
                decorative
              />
            </NavLink>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void logout()}
              aria-label={t("logout")}
              disabled={signoutPending}
            >
              <LogOut size={18} />
            </Button>
          </div>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          {signoutFailed && <Notice kind="error">{t("error")}</Notice>}
          {profile.isPending ? (
            <Loading />
          ) : profile.isError ? (
            <ErrorState retry={() => void profile.refetch()} />
          ) : !profile.data?.active ? (
            <Notice kind="error">{t("profileMissing")}</Notice>
          ) : (
            <>
              <AnnouncementBanners actor={session!.user.id} />
              <Outlet />
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            © {new Date().getFullYear()} Luminovia Training & Consulting
          </span>
          <span>IT · AI · BUSINESS</span>
        </footer>
      </div>
      <nav className="mobile-nav" aria-label={t("menu")}>
        {mobilePrimary.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"}>
            <Icon size={20} />
            <span>{t(label)}</span>
          </NavLink>
        ))}
        <NavLink to="/profile">
          <UserRound size={20} />
          <span>{t("profile")}</span>
        </NavLink>
      </nav>
    </div>
  );
}
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
