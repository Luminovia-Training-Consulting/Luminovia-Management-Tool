/**
 * Role-adapted dashboard with server-aggregated job counts, bounded matching
 * suggestions and personal widgets. Preview-array length never replaces totals;
 * current roles/capabilities gate the actor-scoped queries.
 */
import { FinancialSummaryCards } from "../commercial/revenue";
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
  expertiseQuery,
  profileQuery,
  userRolesQuery,
} from "../../lib/queries";
import { JobCard } from "../jobs/jobs";
import { jobDashboardQuery } from "../jobs/discovery-api";
import { ErrorState, Loading, TextLink } from "../../components/common";
import { validZone } from "../../lib/dates";
import { DashboardCalendarPreview, DashboardWidgets } from "./widgets";
import { DashboardReadinessWidget } from "../readiness/widget";
import "./i18n";
import "./dashboard.css";

/** Compose personal entry points, actual offers and confirmed assignments from shared queries. */
export function Dashboard() {
  const { t } = useTranslation();
  const dashboard = useTranslation("dashboard").t;
  const { session } = useAuth();
  const profile = useQuery(profileQuery(session!.user.id));
  const roles = useQuery(userRolesQuery(session!.user.id));
  const staff =
    roles.data?.some((role) =>
      ["owner", "admin", "management", "lecturer", "senior_lecturer"].includes(
        role,
      ),
    ) ?? false;
  const clientAccount = Boolean(roles.data?.includes("client")) && !staff;
  const destination = staff ? "/jobs" : clientAccount ? "/client" : "/courses";
  const jobs = useQuery({
    ...jobDashboardQuery(session!.user.id),
    enabled: staff,
  });
  const expertise = useQuery({
    ...expertiseQuery(session!.user.id),
    enabled: staff,
  });
  if (roles.isPending || (staff && jobs.isPending)) return <Loading />;
  if (roles.isError || (staff && jobs.isError))
    return (
      <ErrorState
        retry={() => {
          void roles.refetch();
          void jobs.refetch();
        }}
      />
    );
  // Counts are authoritative aggregates, not the length of a truncated preview.
  const availableJobs = jobs.data?.suggestions ?? [];
  const matching = jobs.data?.matching ?? false;
  const suggested = availableJobs;
  const next = jobs.data?.next_assignments ?? [];
  const zone =
    profile.data?.time_zone && validZone(profile.data.time_zone)
      ? profile.data.time_zone
      : "Europe/Berlin";
  return (
    <section className="dashboard-page" aria-label={t("workspace")}>
      <h1>
        {t("greeting", {
          name: profile.data?.display_name.split(" ")[0] || "Luminovia",
        })}
      </h1>
      {staff && (
        <div className="dashboard-metrics">
          {[
            {
              label: "openJobs",
              number: jobs.data?.open_count ?? 0,
              icon: BriefcaseBusiness,
              color: "mint",
              to: "/jobs",
            },
            {
              label: "myAssignments",
              number: jobs.data?.assignment_count ?? 0,
              icon: GraduationCap,
              color: "peach",
              to: "/calendar",
            },
            {
              label: "nextSessions",
              number: jobs.data?.next_session_count ?? 0,
              icon: CalendarDays,
              color: "yellow",
              to: "/calendar",
            },
            {
              label: "expertise",
              number: expertise.data?.length ?? 0,
              icon: Sparkles,
              color: "lilac",
              to: "/profile",
            },
          ].map(({ label, number, icon: Icon, color, to }) => (
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
      <FinancialSummaryCards />
      {staff ? (
        <div className="dashboard-lower">
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
            {suggested.length ? (
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
          <DashboardCalendarPreview
            actor={session!.user.id}
            zone={zone}
            assignments={next}
          />
        </div>
      ) : (
        <section className="panel dashboard-account-destination">
          <h2>{t(clientAccount ? "clientPortal" : "myCourses")}</h2>
          <TextLink to={destination}>
            {t(clientAccount ? "requestCourses" : "courses")}
          </TextLink>
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
        staff={staff}
        clientAccount={clientAccount}
        jobCounts={jobs.data?.management ?? undefined}
      />
      {staff && <DashboardReadinessWidget actor={session!.user.id} />}
    </section>
  );
}
