/**
 * Small calendar, activity, file and contract previews sharing query observers. Errors outrank
 * retained data; the dashboard does not start a second background fetch of complete inbox
 * history.
 */
import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bell,
  CalendarDays,
  FileCheck2,
  Files,
  ListChecks,
  MessageCircle,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { TextLink } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { permissionsQuery } from "../../lib/queries";
import { chatUnreadCountQuery } from "../chat/api";
import { notificationPreviewQuery } from "../notifications/api";
import {
  nextPersonalEventsQuery,
  pendingContractPreviewQuery,
  recentDocumentsQuery,
} from "./api";
import { PersonalizedWidgets, TeachingDayWidget } from "./personal";
import "./i18n";
import "./widgets.css";

/** Minimal shared query state for independent widget loading/error presentation. */
interface State {
  isPending: boolean;
  isError: boolean;
  isFetching?: boolean;
  refetch: () => unknown;
}

/** Prioritize errors over retained data and offer a targeted refetch for this widget. */
function WidgetState({
  state,
  children,
}: {
  state: State;
  children: ReactNode;
}) {
  const { t } = useTranslation("dashboard");
  // Explicit errors win over retained data: do not render a previously allowed
  // preview after an access-denied response or an account transition.
  if (state.isError)
    return (
      <div className="dashboard-widget-error" role="alert">
        <p>{t("widgetError")}</p>
        <Button
          variant="ghost"
          disabled={state.isFetching}
          onClick={() => void state.refetch()}
        >
          {t("retry")}
        </Button>
      </div>
    );
  if (state.isPending)
    return (
      <p className="muted" role="status">
        {t("loading")}
      </p>
    );
  return children;
}

/** Confirmed appointment interval with an optional job link for the dashboard preview. */
export interface CalendarAssignment {
  id: string;
  starts_at: string;
  ends_at: string;
  job?: { id: string; title: string };
}

/** Merge own private events and confirmed assignments, discard past entries and bound the preview. */
export function DashboardCalendarPreview({
  actor,
  zone,
  assignments,
}: {
  actor: string;
  zone: string;
  assignments: CalendarAssignment[];
}) {
  const { t, i18n } = useTranslation("dashboard");
  const personal = useQuery(nextPersonalEventsQuery(actor));
  const [openedAt] = useState(() => Date.now());
  const now = Math.max(openedAt, personal.dataUpdatedAt);
  const entries = [
    ...(personal.isError
      ? []
      : (personal.data ?? []).filter((event) => event.user_id === actor)
    ).map((event) => ({
      id: `personal-${event.id}`,
      title: event.title,
      start: event.starts_at,
      end: event.ends_at,
      kind: "personal",
      href: "/calendar",
    })),
    ...assignments.map((event) => ({
      id: `assignment-${event.id}`,
      title: event.job?.title ?? t("assignment"),
      start: event.starts_at,
      end: event.ends_at,
      kind: "assignment",
      href: event.job ? `/jobs/${event.job.id}` : "/calendar",
    })),
  ]
    .filter((event) => Date.parse(event.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 5);
  return (
    <section
      className="panel dashboard-widget dashboard-calendar"
      aria-label={t("calendar")}
    >
      <div className="section-heading">
        <h2>{t("calendar")}</h2>
        <CalendarDays size={22} aria-hidden="true" />
      </div>
      <p className="muted dashboard-widget-hint">{t("calendarHint")}</p>
      <p className="muted dashboard-widget-hint">
        {t("calendarZone", { zone })}
      </p>
      <WidgetState state={personal}>
        {entries.length === 0 && <p className="muted">{t("noEvents")}</p>}
      </WidgetState>
      {/* A private calendar read must not block independently authorized assignments. */}
      {entries.length > 0 && (
        <ol className="dashboard-preview-list">
          {entries.map((event) => (
            <li key={event.id}>
              <Link to={event.href}>{event.title}</Link>
              <small>
                {t(event.kind)} · {dateTime(event.start, i18n.language, zone)}
              </small>
            </li>
          ))}
        </ol>
      )}
      <div className="dashboard-widget-footer">
        <TextLink to="/calendar">{t("openCalendar")}</TextLink>
        <Button
          variant="ghost"
          aria-label={t("calendarRefresh")}
          disabled={personal.isFetching}
          onClick={() => void personal.refetch()}
        >
          <CalendarDays size={17} aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

/** Observe the shared inbox and chat unread count without polling their history. */
function Activity({ actor, zone }: { actor: string; zone: string }) {
  const { t, i18n } = useTranslation("dashboard");
  // The same preview key is observed by the shell. Do not add an inbox-history
  // request or a second timer.
  const notifications = useQuery({
    ...notificationPreviewQuery(actor),
    // The shell owns the single 30-second poll; this observer only reads its
    // shared cache and performs normal stale focus/reconnect revalidation.
    refetchInterval: false,
  });
  const unread = useQuery(chatUnreadCountQuery(actor));
  return (
    <section
      className="panel dashboard-widget dashboard-activity"
      aria-label={t("activity")}
    >
      <div className="section-heading">
        <h2>{t("activity")}</h2>
        <Bell size={22} aria-hidden="true" />
      </div>
      <WidgetState state={notifications}>
        <p className="dashboard-count">
          {t("unreadNotifications", {
            count: notifications.data?.unread_count ?? 0,
          })}
        </p>
        {notifications.data?.items.length ? (
          <ul className="dashboard-preview-list">
            {notifications.data.items.slice(0, 3).map((item) => (
              <li key={item.id}>
                {item.href ? (
                  <Link to={item.href}>
                    {item.title || t("unknownActivity")}
                  </Link>
                ) : (
                  <span>{item.title || t("unknownActivity")}</span>
                )}
                <small>
                  {dateTime(item.created_at, i18n.language, zone)}
                  {!item.href && ` · ${t("noPreviewLink")}`}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("noNotifications")}</p>
        )}
      </WidgetState>
      <WidgetState state={unread}>
        <p className="dashboard-unread">
          <MessageCircle size={17} aria-hidden="true" />
          {t("unreadMessages", { count: unread.data ?? 0 })}
        </p>
      </WidgetState>
      <div className="dashboard-widget-footer">
        <TextLink to="/notifications">{t("allNotifications")}</TextLink>
        <TextLink to="/chats">{t("chats")}</TextLink>
      </div>
    </section>
  );
}

/** Show only the actor's currently relevant contract acknowledgements, not another person's contract state. */
function PendingContracts({ actor, zone }: { actor: string; zone: string }) {
  const { t, i18n } = useTranslation("dashboard");
  const contracts = useQuery(pendingContractPreviewQuery(actor));
  const pending = contracts.data ?? [];
  return (
    <section
      className="panel dashboard-widget dashboard-contracts"
      aria-label={t("pendingContracts")}
    >
      <div className="section-heading">
        <h2>{t("pendingContracts")}</h2>
        <FileCheck2 size={22} aria-hidden="true" />
      </div>
      <p className="muted dashboard-widget-hint">{t("contractHint")}</p>
      <WidgetState state={contracts}>
        {pending.length ? (
          <ul className="dashboard-preview-list">
            {pending.map((contract) => (
              <li key={contract.id}>
                <Link to="/profile/contracts">{contract.title}</Link>
                {contract.expires_at && (
                  <small>
                    {t("validUntil", {
                      date: dateTime(contract.expires_at, i18n.language, zone),
                    })}
                  </small>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("noContracts")}</p>
        )}
      </WidgetState>
      <TextLink to="/profile/contracts">{t("reviewContracts")}</TextLink>
    </section>
  );
}

/** Show a small permitted metadata preview; actual downloads retain independent authorization. */
function RecentDocuments({ actor, zone }: { actor: string; zone: string }) {
  const { t, i18n } = useTranslation("dashboard");
  const files = useQuery(recentDocumentsQuery(actor));
  return (
    <section
      className="panel dashboard-widget dashboard-files"
      aria-label={t("recentDocuments")}
    >
      <div className="section-heading">
        <h2>{t("recentDocuments")}</h2>
        <Files size={22} aria-hidden="true" />
      </div>
      <p className="muted dashboard-widget-hint">{t("fileHint")}</p>
      <WidgetState state={files}>
        {files.data?.length ? (
          <ul className="dashboard-preview-list">
            {files.data.map((file) => (
              <li key={file.id}>
                <Link to={`/files?q=${encodeURIComponent(file.original_name)}`}>
                  {file.original_name}
                </Link>
                <small>{dateTime(file.created_at, i18n.language, zone)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("noDocuments")}</p>
        )}
      </WidgetState>
      <TextLink to="/files">{t("openFiles")}</TextLink>
    </section>
  );
}

/** Load the detailed course context when the lecturer first opens the disclosure. */
function TeachingDayDetails({ actor }: { actor: string }) {
  const { t } = useTranslation("dashboard");
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="dashboard-teaching-details"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>{t("teachingDay")}</summary>
      {opened && <TeachingDayWidget actor={actor} />}
    </details>
  );
}

/** Compose personal previews and capability-aware next actions without a second data store. */
export function DashboardWidgets({
  actor,
  zone,
  teaching,
  jobCounts,
}: {
  actor: string;
  zone: string;
  teaching: boolean;
  jobCounts?: { drafts: number; expired: number; upcoming: number };
}) {
  const { t } = useTranslation("dashboard");
  const permissions = useQuery(permissionsQuery(actor));
  const manage =
    !permissions.isError && Boolean(permissions.data?.includes("jobs.manage"));
  return (
    <PersonalizedWidgets
      actor={actor}
      widgets={{
        teaching_day: teaching ? (
          <TeachingDayDetails key={actor} actor={actor} />
        ) : null,
        activity: <Activity actor={actor} zone={zone} />,
        contracts: teaching ? (
          <PendingContracts actor={actor} zone={zone} />
        ) : null,
        files: <RecentDocuments actor={actor} zone={zone} />,
        followups:
          manage && jobCounts ? (
            <section
              className="panel dashboard-widget dashboard-followups"
              aria-label={t("followUps")}
            >
              <div className="section-heading">
                <h2>{t("followUps")}</h2>
                <ListChecks size={22} aria-hidden="true" />
              </div>
              <p className="muted dashboard-widget-hint">{t("followUpHint")}</p>
              <ul className="dashboard-preview-list">
                <li>{t("draftJobs", { count: jobCounts.drafts })}</li>
                <li>{t("upcomingUnfilled", { count: jobCounts.upcoming })}</li>
                <li>{t("expiringJobs", { count: jobCounts.expired })}</li>
              </ul>
              <TextLink to="/admin/assignments">{t("manageJobs")}</TextLink>
            </section>
          ) : null,
      }}
    />
  );
}

export function DashboardShortcuts({
  staff,
  clientAccount,
}: {
  staff: boolean;
  clientAccount: boolean;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <nav className="panel dashboard-shortcuts" aria-label={t("shortcuts")}>
      <strong>{t("shortcuts")}</strong>
      <Link to={staff ? "/jobs" : clientAccount ? "/client" : "/courses"}>
        {t(staff ? "jobs" : clientAccount ? "client" : "courses")}
      </Link>
      {staff && clientAccount && <Link to="/client">{t("client")}</Link>}
      <Link to="/profile">{t("profile")}</Link>
      <Link to="/notifications">{t("notifications")}</Link>
      <Link to="/settings">{t("settings")}</Link>
    </nav>
  );
}
