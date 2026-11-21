/** Own dashboard layout and daily teaching context: private checklist stays distinct from scoped shared course facts. */
import { type ReactNode, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CalendarCheck, Settings2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { dateTime } from "../../lib/dates";
import {
  type DashboardPreferences,
  dashboardPreferencesKey,
  dashboardPreferencesQuery,
  defaultDashboardPreferences,
  preparationIds,
  saveDashboardPreferences,
  saveTeachingPreparation,
  type TeachingDay,
  teachingDayKey,
  teachingDayQuery,
  teachingLink,
  type WidgetId,
} from "./personal-api";
import { contactEmailLink, contactPhoneLink } from "../profile/contact-api";
import "./i18n";
import "./widgets.css";

const widgetLabels: Record<WidgetId, string> = {
  teaching_day: "teachingDay",
  activity: "activity",
  contracts: "pendingContracts",
  files: "recentDocuments",
  followups: "followUps",
};

/** Retain the own layout draft and expected version until a confirmed save or explicit reload. */
function LayoutEditor({
  actor,
  initial,
  close,
  reload,
}: {
  actor: string;
  initial: DashboardPreferences;
  close: () => void;
  reload: () => Promise<DashboardPreferences | undefined>;
}) {
  const { t } = useTranslation("dashboard");
  const [draft, setDraft] = useState(initial);
  const online = useOnline();
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: saveDashboardPreferences,
    onSuccess: (data) => {
      client.setQueryData(dashboardPreferencesKey(actor), data);
      close();
    },
  });
  const conflict = Boolean(
    save.error &&
    typeof save.error === "object" &&
    "code" in save.error &&
    save.error.code === "40001",
  );

  function move(index: number, by: number) {
    setDraft((value) => {
      const order = [...value.widget_order];
      [order[index], order[index + by]] = [order[index + by], order[index]];
      return { ...value, widget_order: order };
    });
  }

  return (
    <form
      className="panel dashboard-layout-editor"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(draft);
      }}
    >
      <h2>{t("customize")}</h2>
      <p className="muted">{t("customizeHelp")}</p>
      <fieldset disabled={save.isPending}>
        <legend className="sr-only">{t("customize")}</legend>
        <ol>
          {draft.widget_order.map((id, index) => (
            <li key={id}>
              <label>
                <input
                  type="checkbox"
                  checked={!draft.hidden_widgets.includes(id)}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      hidden_widgets: event.target.checked
                        ? value.hidden_widgets.filter((item) => item !== id)
                        : [...value.hidden_widgets, id],
                    }))
                  }
                />
                {t(widgetLabels[id])}
              </label>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={index === 0}
                  aria-label={t("moveUp", { name: t(widgetLabels[id]) })}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={index === draft.widget_order.length - 1}
                  aria-label={t("moveDown", { name: t(widgetLabels[id]) })}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      </fieldset>
      {save.isError && (
        <Notice kind="error">
          {t(conflict ? "layoutConflict" : "layoutError")}
        </Notice>
      )}
      {conflict && (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void reload().then((data) => {
              if (data) {
                setDraft(data);
                save.reset();
              }
            })
          }
        >
          {t("reloadLayout")}
        </Button>
      )}
      <div className="dashboard-widget-footer">
        <Button type="submit" disabled={!online || save.isPending}>
          {t("saveLayout")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={save.isPending}
          onClick={close}
        >
          {t("cancelLayout")}
        </Button>
      </div>
    </form>
  );
}

/** Apply only confirmed presentation preferences; each contained widget retains its resource boundary. */
export function PersonalizedWidgets({
  actor,
  widgets,
}: {
  actor: string;
  widgets: Partial<Record<WidgetId, ReactNode>>;
}) {
  const { t } = useTranslation("dashboard");
  const preferences = useQuery(dashboardPreferencesQuery(actor));
  const [editing, setEditing] = useState(false);
  const saved = preferences.isError
    ? defaultDashboardPreferences
    : (preferences.data ?? defaultDashboardPreferences);
  return (
    <>
      <div className="dashboard-customize">
        <Button
          variant="secondary"
          disabled={!preferences.data || preferences.isError}
          onClick={() => setEditing(true)}
        >
          <Settings2 size={17} aria-hidden="true" />
          {t("customize")}
        </Button>
      </div>
      {preferences.isError && (
        <div className="dashboard-layout-error">
          <p>{t("layoutLoadError")}</p>
          <Button variant="ghost" onClick={() => void preferences.refetch()}>
            {t("retry")}
          </Button>
        </div>
      )}
      {editing && preferences.data && (
        <LayoutEditor
          key={actor}
          actor={actor}
          initial={preferences.data}
          close={() => setEditing(false)}
          reload={async () => {
            const result = await preferences.refetch();
            return result.isSuccess ? result.data : undefined;
          }}
        />
      )}
      <div className="dashboard-widgets">
        {saved.widget_order
          .filter((id) => !saved.hidden_widgets.includes(id))
          .map((id) =>
            widgets[id] ? (
              <div className="dashboard-widget-slot" key={id}>
                {widgets[id]}
              </div>
            ) : null,
          )}
      </div>
    </>
  );
}

/** Store only this claimant’s private preparation; shared course progress remains independent. */
function Preparation({
  actor,
  session,
}: {
  actor: string;
  session: TeachingDay["sessions"][number];
}) {
  const { t } = useTranslation("dashboard");
  const client = useQueryClient();
  const online = useOnline();
  const save = useMutation({
    mutationFn: ({
      item,
      done,
    }: {
      item: (typeof preparationIds)[number];
      done: boolean;
    }) =>
      saveTeachingPreparation(
        session.claim_id,
        item,
        done,
        session.preparation.version,
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: teachingDayKey(actor) }),
  });
  return (
    <fieldset
      className="teaching-readiness"
      disabled={!online || save.isPending}
    >
      <legend>{t("personalPreparation")}</legend>
      <p className="muted dashboard-widget-hint">
        {t("personalPreparationHint")}
      </p>
      {preparationIds.map((item) => (
        <label key={item}>
          <input
            type="checkbox"
            checked={session.preparation[item]}
            onChange={(event) =>
              save.mutate({ item, done: event.target.checked })
            }
          />
          {t(item)}
        </label>
      ))}
      {save.isError && <Notice kind="error">{t("preparationError")}</Notice>}
    </fieldset>
  );
}

/** Show only the explicit selected course contact and exact shared-version preview returned by SQL. */
function TeachingCourseContext({
  session,
}: {
  session: TeachingDay["sessions"][number];
}) {
  const { t } = useTranslation("dashboard");
  if (!session.course_run_id) return null;
  const contact = session.course_contact,
    email = contact ? contactEmailLink(contact.email) : null,
    phone = contact ? contactPhoneLink(contact.phone) : null;
  const workspace = `/courses/${session.course_run_id}/workspace`;
  return (
    <div className="teaching-course-context">
      <h3>{t("courseContact")}</h3>
      {contact ? (
        <address>
          <strong>{contact.name}</strong>
          {contact.email && (
            <p>{email ? <a href={email}>{contact.email}</a> : contact.email}</p>
          )}
          {contact.phone && (
            <p>{phone ? <a href={phone}>{contact.phone}</a> : contact.phone}</p>
          )}
        </address>
      ) : (
        <p className="muted">{t("noSelectedCourseContact")}</p>
      )}
      <h3>{t("sharedPreparation")}</h3>
      <p>
        {session.shared_preparation?.total
          ? t("sharedPreparationProgress", session.shared_preparation)
          : t("noSharedPreparation")}
      </p>
      <p className="muted dashboard-widget-hint">
        {t("sharedPreparationHint")}
      </p>
      <h3>{t("sharedCourseResources")}</h3>
      {session.course_resources.length ? (
        <ul>
          {session.course_resources.map((resource) => (
            <li key={resource.id}>
              <Link to={workspace}>{resource.name}</Link>
              <small>
                {t(
                  resource.category === "report"
                    ? "sharedReport"
                    : "sharedMaterial",
                )}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t("noSharedCourseResources")}</p>
      )}
      {session.course_resource_count > session.course_resources.length && (
        <p>
          {t("moreSharedResources", {
            count:
              session.course_resource_count - session.course_resources.length,
          })}
        </p>
      )}
      <Link to={workspace}>{t("openCourseWorkspace")}</Link>
    </div>
  );
}

/** Render the fresh own-day preview; current permissions remain authoritative on linked screens. */
export function TeachingDayWidget({ actor }: { actor: string }) {
  const { t, i18n } = useTranslation("dashboard");
  const query = useQuery(teachingDayQuery(actor));
  return (
    <section
      className="panel dashboard-widget dashboard-teaching-day"
      aria-label={t("teachingDay")}
    >
      <div className="section-heading">
        <h2>{t("teachingDay")}</h2>
        <CalendarCheck size={22} aria-hidden="true" />
      </div>
      <p className="muted dashboard-widget-hint">{t("teachingDayHint")}</p>
      {query.isError ? (
        <>
          <p role="alert">{t("widgetError")}</p>
          <Button variant="ghost" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        </>
      ) : query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          <p className="muted">
            {query.data.day} · {query.data.time_zone}
          </p>
          {!query.data.sessions.length ? (
            <p>{t("noTeachingToday")}</p>
          ) : (
            <ol className="dashboard-preview-list teaching-day-sessions">
              {query.data.sessions.map((session) => {
                const link =
                  session.delivery_type === "online"
                    ? teachingLink(session.location)
                    : null;
                return (
                  <li key={session.id}>
                    <Link to={`/jobs/${session.job_id}`}>{session.title}</Link>
                    <p>{session.customer_name}</p>
                    <small>
                      {dateTime(
                        session.starts_at,
                        i18n.language,
                        query.data.time_zone,
                      )}{" "}
                      –{" "}
                      {dateTime(
                        session.ends_at,
                        i18n.language,
                        query.data.time_zone,
                      )}
                    </small>
                    {link ? (
                      <a href={link} target="_blank" rel="noopener noreferrer">
                        {t("openTeachingLink")}
                      </a>
                    ) : (
                      session.location && <p>{session.location}</p>
                    )}
                    <TeachingCourseContext session={session} />
                    <h3>{t("courseDocuments")}</h3>
                    {session.documents.length ? (
                      <ul>
                        {session.documents.map((file) => (
                          <li key={file.id}>
                            <Link
                              to={`/files?q=${encodeURIComponent(file.name)}`}
                            >
                              {file.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">{t("noCourseDocuments")}</p>
                    )}
                    {(session.document_count ?? session.documents.length) >
                      session.documents.length && (
                      <Link to={`/jobs/${session.job_id}`}>
                        {t("moreJobDocuments")}
                      </Link>
                    )}
                    <Preparation actor={actor} session={session} />
                  </li>
                );
              })}
            </ol>
          )}
          <Button
            variant="ghost"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {t("refreshTeachingDay")}
          </Button>
        </>
      )}
    </section>
  );
}
