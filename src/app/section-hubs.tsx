/** Shared entry points for related workflows, retaining server-scoped module data. */
import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loading } from "../components/common";
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
const Replacements = lazy(() =>
  import("../features/replacements/replacements").then((m) => ({
    default: m.ReplacementMarketplacePage,
  })),
);
const Wiki = lazy(() =>
  import("../features/knowledge/wiki").then((m) => ({ default: m.WikiPage })),
);
const Help = lazy(() =>
  import("../features/help/help").then((m) => ({ default: m.HelpCenter })),
);
const Forum = lazy(() =>
  import("../features/knowledge/forum").then((m) => ({ default: m.ForumPage })),
);
const Announcements = lazy(() =>
  import("../features/announcements/announcements").then((m) => ({
    default: m.AnnouncementsPage,
  })),
);
const Notifications = lazy(() =>
  import("../features/notifications/notifications").then((m) => ({
    default: m.NotificationsPage,
  })),
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
    ["replacements", "Vertretungen", "Replacements", Replacements],
    ["reviews", "Dozent:innen bewerten", "Review lecturers", Reviews],
  ],
  knowledge: [
    ["wiki", "Wiki", "Wiki", Wiki],
    ["help", "Hilfe & FAQ", "Help & FAQ", Help],
  ],
  updates: [
    ["forum", "Forum", "Forum", Forum],
    ["announcements", "Ankündigungen", "Announcements", Announcements],
    ["notifications", "Benachrichtigungen", "Notifications", Notifications],
  ],
} as const;
export function SectionHub({ kind }: { kind: keyof typeof sections }) {
  const { i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const items = sections[kind];
  const selected =
    items.find((item) => item[0] === params.get("section")) ?? items[0];
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
            className="button button-secondary"
            aria-current={item === selected ? "page" : undefined}
            onClick={() => setParams({ section: item[0] })}
          >
            {item[i18n.language.startsWith("de") ? 1 : 2]}
          </button>
        ))}
      </nav>
      <Suspense fallback={<Loading />}>
        <Page />
      </Suspense>
    </>
  );
}
