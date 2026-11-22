/** Lists current courses using only the signed-in actor's live access projection. */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { AcademyCompanyLecturerBlocks } from "../operations/company-lecturer-blocks";
import { courseHubQuery, type CourseOverview } from "./api";
import {
  coursePhase,
  coursePhases,
  type CoursePhaseSelection,
} from "./course-phase";
import { CoursePhaseFilter } from "./course-phase-filter";
import { CompanyInvitations } from "./company-invitations";
import { MaterialLibrary } from "./material-library";
import { AcademyCourseDraft } from "./academy-draft";
import "./i18n";
import "./learning.css";

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

/** Refresh the authorised list on navigation and reconnect before displaying any cached courses. */
export function LearningHubPage({ academy }: { academy?: "active" | "grace" }) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  return (
    <>
      <PageHeading
        title={t("hub")}
        description={t("hubHelp")}
        action={
          <Button asChild variant="secondary">
            <Link
              to={
                academy
                  ? "/help?topic=academy-classes"
                  : "/help?topic=lms-learning"
              }
            >
              {t("helpGuides", { ns: "translation" })}
            </Link>
          </Button>
        }
      />
      {online ? (
        <ConnectedLearningHub academy={academy} />
      ) : (
        <Notice>{t("workspaceOffline")}</Notice>
      )}
    </>
  );
}

function ConnectedLearningHub({ academy }: { academy?: "active" | "grace" }) {
  const actor = useAuth().session!.user.id;
  const { t } = useTranslation("learning");
  const roles = useQuery({ ...userRolesQuery(actor), enabled: !academy });
  const [params] = useSearchParams();
  const materials = params.get("view") === "materials";
  const [selection, setSelection] = useState<CoursePhaseSelection>("all");
  const query = useQuery({
    ...courseHubQuery(actor),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 10_000,
    retry: false,
  });

  return (
    <>
      <nav className="page-actions" aria-label={t("hub")}>
        <Button asChild variant={materials ? "secondary" : "default"}>
          <Link to="/learning" aria-current={materials ? undefined : "page"}>
            {t("hub")}
          </Link>
        </Button>
        <Button asChild variant={materials ? "default" : "secondary"}>
          <Link
            to="/learning?view=materials"
            aria-current={materials ? "page" : undefined}
          >
            {t("materialLibrary")}
          </Link>
        </Button>
      </nav>
      {!materials && academy === "active" && (
        <AcademyCourseDraft actor={actor} />
      )}
      {!materials && academy && <AcademyCompanyLecturerBlocks actor={actor} />}
      {!materials && !academy && roles.data?.includes("participant") && (
        <CompanyInvitations actor={actor} />
      )}
      {query.isPending || !query.isFetchedAfterMount ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : materials ? (
        <MaterialLibrary
          actor={actor}
          courses={query.data.filter((course) => course.lms_enabled)}
          readOnly={academy === "grace"}
        />
      ) : query.data.length === 0 ? (
        <div className="empty-state">{t("noCourses")}</div>
      ) : (
        <div className="course-hub-groups">
          <section className="panel course-hub-filter">
            <CoursePhaseFilter
              id="learning-course-phase"
              value={selection}
              onChange={setSelection}
            />
          </section>
          {selection !== "all" &&
            !query.data.some(
              (course) =>
                coursePhase(
                  course.starts_at,
                  course.ends_at,
                  query.dataUpdatedAt,
                ) === selection,
            ) && <div className="empty-state">{t("noCoursesInPhase")}</div>}
          {coursePhases
            .filter((group) => selection === "all" || group === selection)
            .map((group) => {
              const courses = query.data.filter(
                (course) =>
                  coursePhase(
                    course.starts_at,
                    course.ends_at,
                    query.dataUpdatedAt,
                  ) === group,
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
  );
}
