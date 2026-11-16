/**
 * Personal dashboard with matching offers, confirmed assignments and feature widgets. Derive
 * metrics from loaded authorized projections; management views follow current capabilities.
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
import { Button } from "../../components/ui/button";
import { ErrorState, Loading, TextLink } from "../../components/common";
import { validZone } from "../../lib/dates";
import { DashboardCalendarPreview, DashboardWidgets } from "./widgets";
import "./i18n";
/** Compose personal entry points, actual offers and confirmed assignments from shared queries. */
export function Dashboard() {
  const { t, i18n } = useTranslation();
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
    <>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">{t("workspace")}</p>
          <h1>
            {t("greeting", {
              name: profile.data?.display_name.split(" ")[0] || "Luminovia",
            })}
          </h1>
        </div>
        <span className="date-chip">
          {new Intl.DateTimeFormat(i18n.language, {
            dateStyle: "full",
            timeZone: zone,
          }).format(new Date())}
        </span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-label">
            <span className="little-star">✳</span> TRAINING & CONSULTING
          </span>
          <h2>{t("portal")}</h2>
          <p>{t("heroText")}</p>
          <Button asChild>
            <Link to={destination}>
              {t(
                staff
                  ? "explore"
                  : clientAccount
                    ? "requestCourses"
                    : "myCourses",
              )}
              <ArrowUpRight size={19} />
            </Link>
          </Button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="arc arc-one" />
          <div className="arc arc-two" />
          <div className="arc arc-three" />
          <span className="hero-orbit">✳</span>
          <span className="hero-art-caption">{t("connect")}</span>
        </div>
      </section>
      {staff && (
        <div className="kpi-grid">
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
            <Link key={label} className={`kpi-tile ${color}`} to={to}>
              <div>
                <span>{t(label)}</span>
                <strong>{number}</strong>
              </div>
              <Icon size={25} />
              <ArrowUpRight size={16} className="kpi-arrow" />
            </Link>
          ))}
        </div>
      )}
      <FinancialSummaryCards />
      {staff ? (
        <div className="dashboard-lower">
          <section>
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
                <BriefcaseBusiness />
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
        <section className="panel">
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
    </>
  );
}
