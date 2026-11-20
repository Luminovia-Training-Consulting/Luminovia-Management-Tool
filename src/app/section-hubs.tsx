/** Shared entry points for related workflows, retaining server-scoped module data. */
import {lazy, Suspense} from "react";
import {Navigate, useSearchParams} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {ErrorState, Loading} from "../components/common";
import {useQuery} from "@tanstack/react-query";
import {useAuth} from "../features/auth/auth-context";
import {isGuestOnly} from "../features/auth/guest-navigation";
import {knowledgeAccessQuery} from "../features/knowledge/api";
import {userRolesQuery} from "../lib/queries";

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
    import("../features/knowledge/wiki").then((m) => ({default: m.WikiPage})),
);
const Help = lazy(() =>
    import("../features/help/help").then((m) => ({default: m.HelpCenter})),
);
const Support = lazy(() =>
    import("../features/support/support").then((m) => ({
        default: m.SupportDeskPage,
    })),
);
const Forum = lazy(() =>
    import("../features/knowledge/forum").then((m) => ({default: m.ForumPage})),
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
        ["reviews", "Dozent:innen bewerten", "Review lecturers", Reviews],
    ],
    knowledge: [
        ["wiki", "Wiki", "Wiki", Wiki],
        ["forum", "Forum", "Forum", Forum],
        ["help", "Hilfe & FAQ", "Help & FAQ", Help],
        ["support", "Support", "Support", Support],
    ],
    updates: [
        ["forum", "Forum", "Forum", Forum],
        ["announcements", "Ankündigungen", "Announcements", Announcements],
        ["notifications", "Benachrichtigungen", "Notifications", Notifications],
    ],
} as const;

export function SectionHub({kind}: { kind: keyof typeof sections }) {
    const {i18n} = useTranslation();
    const [params, setParams] = useSearchParams();
    const actor = useAuth().session!.user.id;
    const roles = useQuery(userRolesQuery(actor));
    const knowledge = useQuery({
        ...knowledgeAccessQuery(actor),
        enabled: kind === "knowledge" || kind === "updates",
    });
    const staff = roles.data?.some((role) =>
        ["owner", "admin", "management", "lecturer", "senior_lecturer"].includes(
            role,
        ),
    );
    if (roles.isPending) return <Loading/>;
    if (roles.isError) return <ErrorState retry={() => void roles.refetch()}/>;
    const items = sections[kind].filter((item) => {
        if (isGuestOnly(roles.data))
            return kind === "knowledge" && item[0] === "help";
        if (item[0] === "forum") return Boolean(knowledge.data?.can_author);
        if (kind === "courses" && item[0] === "readiness") return Boolean(staff);
        if (kind === "knowledge" && item[0] === "wiki") return staff;
        return (
            item[0] !== "reviews" ||
            roles.data?.some((role) => ["client", "owner", "admin"].includes(role))
        );
    });
    const selected =
        items.find((item) => item[0] === params.get("section")) ?? items[0];
    if (!selected) return <Navigate to="/profile" replace/>;
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
                        onClick={() => setParams({section: item[0]})}
                    >
                        {item[i18n.language.startsWith("de") ? 1 : 2]}
                    </button>
                ))}
            </nav>
            <Suspense fallback={<Loading/>}>
                {kind === "knowledge" && selected[0] === "help" ? (
                    <Help embedded/>
                ) : (
                    <Page/>
                )}
                {kind === "courses" && selected[0] === "catalogue" && (
                    <details className="panel replacement-discovery">
                        <summary>
                            {i18n.language.startsWith("de")
                                ? "Vertretung für einen Kurs finden oder übernehmen"
                                : "Find or claim a course replacement"}
                        </summary>
                        <Replacements/>
                    </details>
                )}
            </Suspense>
        </>
    );
}