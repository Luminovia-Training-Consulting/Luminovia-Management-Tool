/** Lists current courses using only the signed-in actor's live access projection. */
import { PublishedExamResults } from "./timed-exam";
import { useContext, lazy, Suspense, useState } from "react";
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
import { permissionsQuery, userRolesQuery } from "../../lib/queries";
import { useAuth } from "../auth/auth-context";
import { academyPremiumContext } from "../auth/academy-lms-package";
import { AcademyCompanyLecturerBlocks } from "../operations/company-lecturer-blocks";
import { courseHubQuery, type CourseOverview } from "./api";
import {
  coursePhase,
  coursePhases,
  type CoursePhaseSelection,
} from "./course-phase";
import { CoursePhaseFilter } from "./course-phase-filter";
import { CompanyInvitations } from "./company-invitations";
import { AcademyCourseDraft } from "./academy-draft";
import { LearningPrograms } from "./learning-programs";
import "./i18n";
import "./learning.css";

const AcademyCourseArchive = lazy(() =>
  import("./academy-course-archive").then(({ AcademyCourseArchive }) => ({
    default: AcademyCourseArchive,
  })),
);

const MaterialLibrary = lazy(() =>
  import("./material-library").then(({ MaterialLibrary }) => ({
    default: MaterialLibrary,
  })),
);

const PersonalPortfolio = lazy(() =>
  import("./portfolio").then((module) => ({
    default: module.PersonalPortfolio,
  })),
);

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
        <Link to={workspace}>{course.title}</Link>
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
        <Button asChild>
          <Link to={workspace}>
            {t("openWorkspace")} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </Button>
        {course.lms_enabled ? (
          <Button asChild variant="secondary">
            <Link to={workspace + "#course-chat"}>
              <MessageCircle size={16} aria-hidden="true" /> {t("courseChat")}
            </Link>
          </Button>
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
  const [params] = useSearchParams();
  const materials = params.get("view") === "materials";
  const roles = useQuery({
    ...userRolesQuery(actor),
    enabled: !academy || materials,
  });
  const permissions = useQuery({
    ...permissionsQuery(actor),
    enabled: materials,
  });
  const canBrowseCatalogue =
    roles.data?.includes("lecturer") === true ||
    permissions.data?.includes("courses.manage") === true;
  const results = params.get("view") === "results";
  const programmes = params.get("view") === "programmes";
  const portfolio = params.get("view") === "portfolio";
  const premium = useContext(academyPremiumContext);
  const dashboard = !materials && !results && !programmes && !portfolio;
  const [selection, setSelection] = useState<CoursePhaseSelection>("all");
  const query = useQuery({
    ...courseHubQuery(actor),
    enabled: !programmes && !portfolio,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 10_000,
    retry: false,
  });

  return (
    <div className="course-learning-hub">
      {(academy || roles.data?.includes("participant") || !materials) && (
        <nav className="course-learning-nav" aria-label={t("hub")}>
          <Button asChild variant={dashboard ? "default" : "secondary"}>
            <Link to="/learning" aria-current={dashboard ? "page" : undefined}>
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
          <Button asChild variant={programmes ? "default" : "secondary"}>
            <Link
              to="/learning?view=programmes"
              aria-current={programmes ? "page" : undefined}
            >
              {t("title", { ns: "learningPrograms" })}
            </Link>
          </Button>
          {premium && (academy || roles.data?.includes("participant")) && (
            <Button asChild variant={portfolio ? "default" : "secondary"}>
              <Link
                to="/learning?view=portfolio"
                aria-current={portfolio ? "page" : undefined}
              >
                {t("portfolio")}
              </Link>
            </Button>
          )}
          {premium && (
            <Button asChild variant={results ? "default" : "secondary"}>
              <Link
                to="/learning?view=results"
                aria-current={results ? "page" : undefined}
              >
                {t("results", { ns: "timedExam" })}
              </Link>
            </Button>
          )}
        </nav>
      )}
      {dashboard && academy === "active" && (
        <AcademyCourseDraft actor={actor} />
      )}
      {dashboard && academy && (
        <Suspense fallback={null}>
          <AcademyCourseArchive
            key={actor}
            actor={actor}
            readOnly={academy === "grace"}
          />
        </Suspense>
      )}
      {dashboard && academy && <AcademyCompanyLecturerBlocks actor={actor} />}
      {dashboard && !academy && roles.data?.includes("participant") && (
        <CompanyInvitations actor={actor} />
      )}
      {!premium && (portfolio || results) ? (
        <Notice>{t("premiumOff")}</Notice>
      ) : programmes ? (
        <LearningPrograms actor={actor} />
      ) : portfolio ? (
        <Suspense fallback={<Loading />}>
          <PersonalPortfolio actor={actor} readOnly={academy === "grace"} />
        </Suspense>
      ) : results ? (
        <PublishedExamResults actor={actor} />
      ) : query.isPending || !query.isFetchedAfterMount ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : materials ? (
        <Suspense fallback={<Loading />}>
          <MaterialLibrary
            actor={actor}
            courses={query.data}
            readOnly={academy === "grace"}
            academy={academy === "active"}
            canBrowseCatalogue={canBrowseCatalogue}
          />
        </Suspense>
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
    </div>
  );
}
