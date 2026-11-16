import { useState } from "react";
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
  claimsQuery,
  expertiseQuery,
  jobsQuery,
  profileQuery,
  userRolesQuery,
} from "../../lib/queries";
import { JobCard } from "../jobs/jobs";
import { Button } from "../../components/ui/button";
import { ErrorState, Loading, TextLink } from "../../components/common";
import { validZone } from "../../lib/dates";
import { DashboardCalendarPreview, DashboardWidgets } from "./widgets";
import { DashboardReadinessWidget } from "../readiness/widget";
import "./i18n";
export function Dashboard() {
  const { t, i18n } = useTranslation();
  const [openedAt] = useState(() => Date.now());
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
  const jobs = useQuery({ ...jobsQuery, enabled: staff });
  const claims = useQuery({ ...claimsQuery(session!.user.id), enabled: staff });
  const expertise = useQuery({
    ...expertiseQuery(session!.user.id),
    enabled: staff,
  });
  if (roles.isPending || (staff && (jobs.isPending || claims.isPending)))
    return <Loading />;
  if (roles.isError || (staff && (jobs.isError || claims.isError)))
    return (
      <ErrorState
        retry={() => {
          void roles.refetch();
          void jobs.refetch();
          void claims.refetch();
        }}
      />
    );
  const availableJobs = jobs.data ?? [];
  const ownClaims = claims.data ?? [];
  const now = Math.max(openedAt, jobs.dataUpdatedAt, expertise.dataUpdatedAt);
  const open = availableJobs.filter(
    (j) =>
      j.status === "published" &&
      (!j.claim_deadline || Date.parse(j.claim_deadline) > now),
  );
  const verified = new Set(
    (expertise.data ?? [])
      .filter(
        (item) =>
          item.verified &&
          (!item.valid_until || Date.parse(item.valid_until) > now),
      )
      .map((item) => item.topic_id),
  );
  const matching = open.filter(
    (job) =>
      job.job_requirements.length > 0 &&
      job.job_requirements.every((requirement) =>
        verified.has(requirement.topic_id),
      ),
  );
  const suggested = matching.length ? matching : open;
  const next = ownClaims
    .flatMap((c) =>
      c.assignment_sessions.map((s) => ({
        ...s,
        job: availableJobs.find((j) => j.id === c.job_id),
      })),
    )
    .filter((s) => new Date(s.ends_at) > new Date())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
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
              number: open.length,
              icon: BriefcaseBusiness,
              color: "mint",
              to: "/jobs",
            },
            {
              label: "myAssignments",
              number: ownClaims.length,
              icon: GraduationCap,
              color: "peach",
              to: "/calendar",
            },
            {
              label: "nextSessions",
              number: next.length,
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
              <h2>{matching.length ? dashboard("matches") : t("openJobs")}</h2>
              <TextLink to="/jobs">{t("all")}</TextLink>
            </div>
            {matching.length > 0 && (
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
        jobs={availableJobs}
        jobsAsOf={jobs.dataUpdatedAt}
      />
      {staff && <DashboardReadinessWidget actor={session!.user.id} />}
    </>
  );
}
