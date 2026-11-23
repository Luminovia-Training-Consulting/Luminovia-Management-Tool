/** Shared entry points for related workflows, retaining server-scoped module data. */
import { lazy, Suspense } from "react";
import {
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useMatch,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading } from "../components/common";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../features/auth/auth-context";
import { isGuestOnly } from "../features/auth/guest-navigation";
import { hasJobStaffRole } from "../features/auth/internal-capabilities";
import { knowledgeAccessQuery } from "../features/knowledge/api";
import { userRolesQuery } from "../lib/queries";

const Courses = lazy(() =>
  import("../features/operations/courses").then((m) => ({
    default: m.CoursesPage,
  })),
);
const Readiness = lazy(() =>
  import("../features/readiness/readiness").then((m) => ({
    default: m.CourseReadinessPage,
  })),
);
const Articles = lazy(() =>
  import("../features/knowledge/articles").then((m) => ({
    default: m.KnowledgeArticles,
  })),
);
const Help = lazy(() =>
  import("../features/help/help").then((m) => ({ default: m.HelpCenter })),
);
const Support = lazy(() =>
  import("../features/support/support").then((m) => ({
    default: m.SupportDeskPage,
  })),
);
const Forum = lazy(() =>
  import("../features/knowledge/forum").then((m) => ({ default: m.ForumPage })),
);
const Reviews = lazy(() =>
  import("../features/people/reviews").then((m) => ({
    default: m.MyCourseReviews,
  })),
);
const sections = {
  courses: [
    ["catalogue", "Kurse", "Courses", Courses],
    ["readiness", "Kursbereitschaft", "Readiness", Readiness],
    ["reviews", "Dozent:innen bewerten", "Review lecturers", Reviews],
  ],
  assistance: [
    ["help", "Hilfe & FAQ", "Help & FAQ", Help],
    ["support", "Support", "Support", Support],
  ],
} as const;

export function SectionHub({ kind }: { kind: keyof typeof sections }) {
  const { i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const actor = useAuth().session!.user.id;
  const roles = useQuery(userRolesQuery(actor));
  const staff = hasJobStaffRole(roles.data);
  if (roles.isPending) return <Loading />;
  if (roles.isError) return <ErrorState retry={() => void roles.refetch()} />;
  const items = sections[kind].filter((item) => {
    if (isGuestOnly(roles.data))
      return kind === "assistance" && item[0] === "help";
    if (kind === "courses" && item[0] === "readiness") return Boolean(staff);
    return (
      item[0] !== "reviews" ||
      roles.data?.some((role) => ["client", "owner", "admin"].includes(role))
    );
  });
  const selected =
    items.find((item) => item[0] === params.get("section")) ?? items[0];
  if (!selected) return <Navigate to="/profile" replace />;
  const Page = selected[3];
  return (
    <>
      <nav
        className="admin-tabs"
        aria-label={i18n.language.startsWith("de") ? "Bereiche" : "Sections"}
      >
        {items.map((item) => (
          <button
            key={item[0]}
            className={
              item === selected
                ? "button button-primary"
                : "button button-secondary"
            }
            aria-current={item === selected ? "page" : undefined}
            onClick={() => setParams({ section: item[0] })}
          >
            {item[i18n.language.startsWith("de") ? 1 : 2]}
          </button>
        ))}
      </nav>
      <Suspense fallback={<Loading />}>
        {kind === "assistance" && selected[0] === "help" ? (
          <Help embedded />
        ) : (
          <Page />
        )}
      </Suspense>
    </>
  );
}

/** One workspace with stable URLs for rooms and discussion threads. */
export function CommunicationWorkspace() {
  const { i18n } = useTranslation();
  const actor = useAuth().session!.user.id;
  const knowledge = useQuery(knowledgeAccessQuery(actor));
  const forum = useMatch("/chats/forum");
  const de = i18n.language.startsWith("de");

  if (forum && knowledge.isPending) return <Loading />;
  if (forum && knowledge.isError)
    return <ErrorState retry={() => void knowledge.refetch()} />;
  if (forum && !knowledge.data?.can_author)
    return <Navigate to="/chats" replace />;

  return (
    <>
      {knowledge.data?.can_author && (
        <nav
          className="admin-tabs"
          aria-label={de ? "Austausch" : "Communication"}
        >
          <NavLink to="/chats" end>
            Chats
          </NavLink>
          <NavLink to="/chats/forum" end>
            Forum
          </NavLink>
        </nav>
      )}
      <Outlet />
    </>
  );
}

export function CommunicationForum() {
  const { i18n } = useTranslation();
  const actor = useAuth().session!.user.id;
  const roles = useQuery(userRolesQuery(actor));
  const [params, setParams] = useSearchParams();
  const articles = params.get("view") === "articles";
  const de = i18n.language.startsWith("de");
  if (roles.isPending) return <Loading />;
  if (roles.isError) return <ErrorState retry={() => void roles.refetch()} />;
  const canReadArticles = hasJobStaffRole(roles.data);
  if (articles && !canReadArticles)
    return <Navigate to="/chats/forum" replace />;
  return (
    <>
      {canReadArticles && (
        <nav
          className="admin-tabs"
          aria-label={de ? "Forum-Inhalte" : "Forum content"}
        >
          <button
            className={
              articles ? "button button-secondary" : "button button-primary"
            }
            aria-current={!articles ? "page" : undefined}
            onClick={() => {
              if (articles) setParams({});
            }}
          >
            {de ? "Diskussionen" : "Discussions"}
          </button>
          <button
            className={
              articles ? "button button-primary" : "button button-secondary"
            }
            aria-current={articles ? "page" : undefined}
            onClick={() => {
              if (!articles) setParams({ view: "articles" });
            }}
          >
            {de ? "Fachartikel" : "Articles"}
          </button>
        </nav>
      )}
      <Suspense fallback={<Loading />}>
        {articles ? <Articles /> : <Forum />}
      </Suspense>
    </>
  );
}

export function LegacyWikiRoute() {
  const { search, hash } = useLocation();
  const actor = useAuth().session!.user.id;
  const roles = useQuery(userRolesQuery(actor));
  if (roles.isPending) return <Loading />;
  if (roles.isError) return <ErrorState retry={() => void roles.refetch()} />;
  const params = new URLSearchParams(search);
  const section = params.get("section");
  params.delete("section");
  let pathname = "/chats/forum";
  if (section === "help" || section === "support" || isGuestOnly(roles.data)) {
    pathname = "/assistance";
    if (section === "support") params.set("section", "support");
  } else if (section !== "forum" && hasJobStaffRole(roles.data)) {
    params.set("view", "articles");
  }
  return (
    <Navigate to={{ pathname, search: params.toString(), hash }} replace />
  );
}

export function LegacyForumRoute() {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  const section = params.get("section");
  if (section === "announcements" || section === "notifications") {
    params.delete("section");
    return (
      <Navigate
        to={{ pathname: `/${section}`, search: params.toString(), hash }}
        replace
      />
    );
  }
  return <Navigate to={{ pathname: "/chats/forum", search, hash }} replace />;
}
