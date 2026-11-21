/** Lists current courses using only the signed-in actor's live access projection. */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clock,
  MessageCircle,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { userRolesQuery } from "../../lib/queries";
import { useAuth } from "../auth/auth-context";
import { isParticipantOnly } from "../auth/guest-navigation";
import { courseHubQuery, type CourseOverview } from "./api";
import { CompanyInvitations } from "./company-invitations";
import "./i18n";
import "./learning.css";

const phases = ["current", "upcoming", "completed", "unscheduled"] as const;
type Phase = (typeof phases)[number];

/** Classify in one clock snapshot for the whole list. Instants already include an offset. */
function phase(course: CourseOverview, now: number): Phase {
  if (!course.starts_at || !course.ends_at) return "unscheduled";
  if (Date.parse(course.ends_at) <= now) return "completed";
  return Date.parse(course.starts_at) > now ? "upcoming" : "current";
}

function CourseCard({ course }: { course: CourseOverview }) {
  const { t, i18n } = useTranslation("learning");
  const start = course.next_start_at ?? course.starts_at;
  const workspace = `/courses/${course.id}/workspace`;
  return (
    <article className="panel learning-card">
      <div className="course-card-label">
        <BookOpen size={18} aria-hidden="true" />
        {course.organisation_name && <span>{course.organisation_name}</span>}
      </div>
      <h3>
        {course.lms_enabled ? (
          <Link to={workspace}>{course.title}</Link>
        ) : (
          course.title
        )}
      </h3>
      <div className="course-card-facts">
        <span>
          <CalendarDays size={16} aria-hidden="true" />
          {start
            ? dateTime(start, i18n.language, course.time_zone)
            : t("unscheduled")}
        </span>
        <span>
          <Clock size={16} aria-hidden="true" />
          {course.time_zone}
        </span>
      </div>
      <div className="course-card-actions">
        {course.lms_enabled ? (
          <>
            <Button asChild>
              <Link to={workspace}>
                {t("openWorkspace")} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to={workspace + "#course-chat"}>
                <MessageCircle size={16} aria-hidden="true" /> {t("courseChat")}
              </Link>
            </Button>
          </>
        ) : (
          <span className="badge">{t("premiumOffCourseBadge")}</span>
        )}
      </div>
    </article>
  );
}

/** Refresh the authorised list before displaying retained query data on a new visit. */
export function LearningHubPage({ academy = false }: { academy?: boolean }) {
  const actor = useAuth().session!.user.id;
  const { t } = useTranslation("learning");
  const online = useOnline();
  const roles = useQuery({ ...userRolesQuery(actor), enabled: !academy });
  const query = useQuery({
    ...courseHubQuery(actor),
    enabled: online,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 10_000,
    retry: false,
  });

  return (
    <>
      <PageHeading title={t("hub")} description={t("hubHelp")} />
      {!online ? (
        <Notice>{t("workspaceOffline")}</Notice>
      ) : (
        <>
          {!academy && isParticipantOnly(roles.data) && (
            <CompanyInvitations actor={actor} />
          )}
          {query.isPending ||
          (query.isFetching && !query.isFetchedAfterMount) ? (
            <Loading />
          ) : query.isError ? (
            <ErrorState retry={() => void query.refetch()} />
          ) : query.data.length === 0 ? (
            <div className="empty-state">{t("noCourses")}</div>
          ) : (
            <div className="course-hub-groups">
              {phases.map((group) => {
                const courses = query.data.filter(
                  (course) => phase(course, query.dataUpdatedAt) === group,
                );
                if (courses.length === 0) return null;
                if (group === "upcoming") courses.reverse();
                return (
                  <section
                    className="course-hub-group"
                    data-phase={group}
                    aria-labelledby={`course-phase-${group}`}
                    key={group}
                  >
                    <h2 id={`course-phase-${group}`}>{t(`phase.${group}`)}</h2>
                    <div className="learning-grid">
                      {courses.map((course) => (
                        <CourseCard key={course.id} course={course} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
