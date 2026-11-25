/** Shared entry points for related workflows, retaining server-scoped module data. */
import { lazy, Suspense, type ReactNode } from "react";
import {
  Navigate,
  Outlet,
  useLocation,
  useMatch,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageNotFound } from "../components/page-not-found";
import { isDatabasePermissionDenied } from "../lib/database-errors";
import { SectionButton, SectionLink } from "../components/section-card";
import { ErrorState, Loading } from "../components/common";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../features/auth/auth-context";
import { isGuestOnly } from "../features/auth/guest-navigation";
import {
  hasJobStaffRole,
  hasTeachingRole,
} from "../features/auth/internal-capabilities";
import { knowledgeAccessQuery } from "../features/knowledge/api";
import { permissionsQuery, userRolesQuery } from "../lib/queries";

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
const Delivery = lazy(() =>
  import("../features/changes/delivery").then((m) => ({
    default: m.DeliveryPage,
  })),
);
const sections = {
  courses: [
    [
      "catalogue",
      "Kurse",
      "Courses",
      Courses,
      "Durchführungen und Vorlagen verwalten.",
      "Manage course runs and templates.",
    ],
    [
      "readiness",
      "Kursbereitschaft",
      "Readiness",
      Readiness,
      "Prüfe, was vor dem Kursstart noch offen ist.",
      "Check what is still needed before a course starts.",
    ],
    [
      "delivery",
      "Durchführung",
      "Delivery",
      Delivery,
      "Unterrichtstermine und Nachweise einsehen.",
      "View teaching sessions and delivery records.",
    ],
    [
      "reviews",
      "Dozent:innen bewerten",
      "Review lecturers",
      Reviews,
      "Feedback zu abgeschlossenen Kursen abgeben.",
      "Give feedback on completed courses.",
    ],
  ],
  assistance: [
    [
      "help",
      "Hilfe & FAQ",
      "Help & FAQ",
      Help,
      "Anleitungen und Antworten finden.",
      "Find guides and answers.",
    ],
    [
      "support",
      "Support",
      "Support",
      Support,
      "Tickets erstellen und Antworten verfolgen.",
      "Create tickets and follow replies.",
    ],
  ],
} as const;

export function SectionHub({
  kind,
  current,
  children,
}: {
  kind: keyof typeof sections;
  current?: string;
  children?: ReactNode;
}) {
  const { i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const actor = useAuth().session!.user.id;
  const roles = useQuery(userRolesQuery(actor));
  const permissions = useQuery({
    ...permissionsQuery(actor),
    enabled: kind === "courses",
  });
  const staff = hasJobStaffRole(roles.data);
  const de = i18n.language.startsWith("de");
  if (roles.isPending) return <Loading />;
  if (roles.isError) return <ErrorState retry={() => void roles.refetch()} />;
  const deliveryByRole =
    hasTeachingRole(roles.data) || roles.data.includes("client");
  const deliveryByPermission =
    permissions.isSuccess &&
    permissions.data.some(
      (permission) =>
        permission === "courses.manage" || permission === "finance.manage",
    );
  const items = sections[kind].filter((item) => {
    if (isGuestOnly(roles.data))
      return kind === "assistance" && item[0] === "help";
    if (item[0] === "readiness") return staff;
    if (item[0] === "delivery") return deliveryByRole || deliveryByPermission;
    return (
      item[0] !== "reviews" ||
      roles.data.some((role) =>
        ["client", "owner", "admin", "participant"].includes(role),
      )
    );
  });
  // A delegated delivery grant is only known after the permission read.
  if (kind === "courses" && current === "delivery" && !deliveryByRole) {
    if (permissions.isPending) return <Loading />;
    if (permissions.isError && !isDatabasePermissionDenied(permissions.error))
      return <ErrorState retry={() => void permissions.refetch()} />;
  }
  // Direct links never mount a page hidden by the hub's audience rules.
  if (current && !items.some(([id]) => id === current)) return <PageNotFound />;
  const selected =
    items.find((item) => item[0] === params.get("section")) ?? items[0];
  if (!selected) return children ?? <Navigate to="/profile" replace />;
  const Page = selected[3];
  return (
    <>
      <nav
        className="section-navigation"
        aria-label={
          kind === "courses"
            ? de
              ? "Kursbereiche"
              : "Course sections"
            : de
              ? "Hilfebereiche"
              : "Help sections"
        }
      >
        {items.map(([id, german, english, , descriptionDe, descriptionEn]) => {
          const props = {
            title: de ? german : english,
            description: de ? descriptionDe : descriptionEn,
            "aria-current":
              (current ?? selected[0]) === id ? ("page" as const) : undefined,
          };
          return current ? (
            <SectionLink key={id} {...props} to={`/${kind}?section=${id}`} />
          ) : (
            <SectionButton
              key={id}
              {...props}
              onClick={() => setParams({ section: id })}
            />
          );
        })}
      </nav>
      <Suspense fallback={<Loading />}>
        {children ??
          (kind === "assistance" && selected[0] === "help" ? (
            <Help embedded />
          ) : (
            <Page />
          ))}
      </Suspense>
    </>
  );
}

/** One workspace with stable URLs for rooms and discussion threads. */
export function CommunicationWorkspace() {
  const { t, i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const actor = useAuth().session!.user.id;
  const knowledge = useQuery(knowledgeAccessQuery(actor));
  const forum = useMatch("/chats/forum");

  if (forum && isDatabasePermissionDenied(knowledge.error))
    return <PageNotFound />;
  if (forum && knowledge.isPending) return <Loading />;
  if (forum && knowledge.isError)
    return <ErrorState retry={() => void knowledge.refetch()} />;
  if (forum && !knowledge.data?.can_author) return <PageNotFound />;

  return (
    <>
      <nav className="section-navigation" aria-label={t("chats")}>
        <SectionLink
          to="/chats"
          title={t("chats")}
          description={
            de
              ? "Öffne Direktnachrichten, Gruppen und Kurschats."
              : "Open direct messages, groups and course chats."
          }
          aria-current={forum ? undefined : "page"}
        />
        {knowledge.isSuccess && knowledge.data.can_author && (
          <SectionLink
            to="/chats/forum"
            title="Forum"
            description={
              de
                ? "Diskutiere im Team und lies Fachartikel."
                : "Join team discussions and read articles."
            }
            aria-current={forum ? "page" : undefined}
          />
        )}
      </nav>
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
  if (articles && !canReadArticles) return <PageNotFound />;
  return (
    <>
      {canReadArticles && (
        <nav
          className="section-navigation"
          aria-label={de ? "Forum-Inhalte" : "Forum content"}
        >
          <SectionButton
            title={de ? "Diskussionen" : "Discussions"}
            description={
              de
                ? "Fragen stellen und Erfahrungen austauschen."
                : "Ask questions and share experiences."
            }
            aria-current={!articles ? "page" : undefined}
            onClick={() => {
              if (articles) setParams({});
            }}
          />
          <SectionButton
            title={de ? "Fachartikel" : "Articles"}
            description={
              de
                ? "Wissen zu Kursen und zur Portalnutzung nachlesen."
                : "Read about courses and using the portal."
            }
            aria-current={articles ? "page" : undefined}
            onClick={() => {
              if (!articles) setParams({ view: "articles" });
            }}
          />
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
