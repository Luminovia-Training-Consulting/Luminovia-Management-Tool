/**
 * Role-adapted dashboard with server-aggregated job counts, bounded matching
 * suggestions and personal widgets. Preview-array length never replaces totals;
 * current roles/capabilities gate the actor-scoped queries.
 */
import { FinancialSummaryCards } from "../commercial/financial-summary-cards";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import {
  hasJobStaffRole,
  hasTeachingRole,
} from "../auth/internal-capabilities";
import { profileQuery, userRolesQuery } from "../../lib/queries";
import { dashboardExpertiseCountQuery } from "./api";
import { JobCard } from "../jobs/card";
import { jobDashboardQuery } from "../jobs/discovery-api";
import { ErrorState, Loading, Notice, TextLink } from "../../components/common";
import { dateTime, validZone } from "../../lib/dates";
import {
  DashboardCalendarPreview,
  DashboardShortcuts,
  DashboardWidgets,
} from "./widgets";
import { DashboardCustomization } from "./personal";
import { notificationPreviewQuery } from "../notifications/api";
import { DashboardReadinessWidget } from "../readiness/widget";
import "./i18n";
import "./dashboard.css";

/** Compose personal entry points, actual offers and confirmed assignments from shared queries. */
export function Dashboard() {
  const { t, i18n } = useTranslation();
  const dashboard = useTranslation("dashboard").t;
  const inbox = useTranslation("inbox").t;
  const { session } = useAuth();
  const profile = useQuery(profileQuery(session!.user.id));
  const roles = useQuery(userRolesQuery(session!.user.id));
  const staff = hasJobStaffRole(roles.data);
  const teaching = hasTeachingRole(roles.data);
  const clientAccount = Boolean(roles.data?.includes("client"));
  const jobs = useQuery({
    ...jobDashboardQuery(session!.user.id),
    enabled: roles.isSuccess && staff,
  });
  const expertise = useQuery({
    ...dashboardExpertiseCountQuery(session!.user.id),
    enabled: roles.isSuccess && teaching,
  });
  const notifications = useQuery({
    ...notificationPreviewQuery(session!.user.id),
    enabled: roles.isSuccess && teaching,
  });
  const removals = notifications.data?.items.filter(
    (item) =>
      item.kind === "claim_cancelled" &&
      item.assignment_removed &&
      !item.read_at,
  );
  if (roles.isPending) return <Loading />;
  if (roles.isError) return <ErrorState retry={() => void roles.refetch()} />;
  // Keep independent widgets usable while the authorized job summary loads.
  const jobSummary = jobs.isSuccess ? jobs.data : undefined;
  const suggested = jobSummary?.suggestions ?? [];
  const matching = teaching && jobSummary?.matching;
  const next = jobSummary?.next_assignments ?? [];
  const expertiseCount = expertise.isSuccess ? expertise.data : undefined;
  const zone =
    profile.data?.time_zone && validZone(profile.data.time_zone)
      ? profile.data.time_zone
      : "Europe/Berlin";
  return (
    <section className="dashboard-page" aria-label={t("workspace")}>
      <header className="dashboard-welcome">
        <div className="dashboard-welcome-copy">
          <h1>
            {t("greeting", {
              name: profile.data?.display_name.split(" ")[0] || "Luminovia",
            })}
          </h1>
          <p>{dashboard("workspaceIntro")}</p>
        </div>
        <DashboardCustomization
          actor={session!.user.id}
          key={session!.user.id}
        />
      </header>
      {teaching &&
        removals?.map((item) => (
          <Notice key={item.id} kind="error">
            <strong>{inbox("lecturerRemoved")}</strong>
            <p>{item.title}</p>
            {item.removal_reason && <p>{item.removal_reason}</p>}
            <Link to="/notifications">{inbox("open")}</Link>
          </Notice>
        ))}
      {staff && (jobSummary || (teaching && expertiseCount !== undefined)) && (
        <div className="dashboard-metrics">
          {[
            {
              label: "openJobs",
              number: jobSummary?.open_count,
              icon: BriefcaseBusiness,
              color: "mint",
              to: "/jobs",
            },
            {
              label: "myAssignments",
              number: jobSummary?.assignment_count,
              icon: GraduationCap,
              color: "peach",
              to: "/calendar",
            },
            {
              label: "nextSessions",
              number: jobSummary?.next_session_count,
              icon: CalendarDays,
              color: "yellow",
              to: "/calendar",
            },
            {
              label: "expertise",
              number: expertiseCount,
              icon: Sparkles,
              color: "lilac",
              to: "/profile",
            },
          ]
            .filter(
              ({ label, number }) =>
                number !== undefined && (teaching || label === "openJobs"),
            )
            .map(({ label, number, icon: Icon, color, to }) => (
              <Link
                key={label}
                className={`dashboard-metric dashboard-metric--${color}`}
                to={to}
              >
                <span>{t(label)}</span>
                <strong>{number}</strong>
                <Icon size={22} aria-hidden="true" />
                <ArrowUpRight
                  size={16}
                  className="dashboard-metric-arrow"
                  aria-hidden="true"
                />
              </Link>
            ))}
        </div>
      )}
      <DashboardShortcuts staff={staff} clientAccount={clientAccount} />
      {staff ? (
        <div className="dashboard-overview">
          {teaching && jobSummary && (
            <section
              className="panel dashboard-assignments"
              aria-label={dashboard("nextAssignments")}
            >
              <div className="section-heading">
                <h2>{dashboard("nextAssignments")}</h2>
                <CalendarDays size={22} aria-hidden="true" />
              </div>
              {next.length ? (
                <ol className="dashboard-preview-list">
                  {next.slice(0, 3).map((assignment) => (
                    <li key={assignment.id}>
                      <Link
                        to={
                          assignment.job
                            ? `/jobs/${assignment.job.id}`
                            : "/calendar"
                        }
                      >
                        {assignment.job?.title ?? dashboard("assignment")}
                      </Link>
                      <small>
                        {dateTime(assignment.starts_at, i18n.language, zone)}
                      </small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">{dashboard("noConfirmedAssignments")}</p>
              )}
              <TextLink to="/calendar">{dashboard("openCalendar")}</TextLink>
            </section>
          )}
          <DashboardReadinessWidget actor={session!.user.id} />
          <DashboardCalendarPreview
            actor={session!.user.id}
            zone={zone}
            assignments={teaching ? next : []}
          />
        </div>
      ) : null}
      {(!staff || clientAccount) && (
        <section className="panel dashboard-account-destination">
          <h2>{t(clientAccount ? "clientPortal" : "myCourses")}</h2>
          <div className="dashboard-destination-actions">
            <TextLink to={clientAccount ? "/client" : "/courses"}>
              {t(clientAccount ? "requestCourses" : "courses")}
            </TextLink>
            {clientAccount && (
              <TextLink to="/my-reviews">
                {dashboard("companyReviews")}
              </TextLink>
            )}
          </div>
        </section>
      )}
      {!staff && (
        <DashboardCalendarPreview
          actor={session!.user.id}
          zone={zone}
          assignments={[]}
        />
      )}
      <DashboardWidgets
        actor={session!.user.id}
        zone={zone}
        teaching={teaching}
        jobCounts={jobSummary?.management ?? undefined}
      />
      {staff && (
        <div className="dashboard-offers">
          <section aria-label={matching ? dashboard("matches") : t("openJobs")}>
            <div className="section-heading">
              <h2>{matching ? dashboard("matches") : t("openJobs")}</h2>
              <TextLink to="/jobs">{t("all")}</TextLink>
            </div>
            {matching && (
              <p className="dashboard-matching-hint">
                {dashboard("matchingHint")}
              </p>
            )}
            {jobs.isPending ? (
              <Loading />
            ) : jobs.isError ? (
              <ErrorState retry={() => void jobs.refetch()} />
            ) : suggested.length ? (
              <div className="dashboard-jobs">
                {suggested.slice(0, 2).map((job, index) => (
                  <JobCard key={job.id} job={job} index={index} />
                ))}
              </div>
            ) : (
              <div className="panel empty-state">
                <BriefcaseBusiness aria-hidden="true" />
                <p>{t("noJobs")}</p>
              </div>
            )}
          </section>
        </div>
      )}
      <FinancialSummaryCards />
    </section>
  );
}
