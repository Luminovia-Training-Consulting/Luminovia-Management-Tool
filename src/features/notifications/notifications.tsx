import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { PushSettings } from "./push-settings";
import { useAuth } from "../auth/auth-context";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { dateTime } from "../../lib/dates";
import { profileQuery } from "../../lib/queries";
import { requireOnline, useOnline } from "../../lib/online";
import {
  markNotifications,
  mergeNotificationPages,
  notificationInboxQuery,
  notificationKeys,
  notificationPreferencesQuery,
  notificationPreferencesSchema,
  notificationPreviewQuery,
  refreshNotifications,
  saveNotificationPreferences,
  type NotificationItem,
  type NotificationPreferences,
} from "./api";
import "./i18n";
import "./notifications.css";
import { DeliverySettings } from "./delivery-settings";

const knownKinds = new Set([
  "claim_confirmed",
  "claim_cancelled",
  "job_reopened",
  "job_matching",
  "chat_message",
  "forum_reply",
  "session_reminder",
  "contract_expiring",
  "contract_available",
  "job_waitlist_available",
  "substitution_proposed",
  "substitution_closed",
  "task_assigned",
  "task_due",
  "timesheet_reviewed",
  "qualification_expiring",
  "course_preparation_updated",
  "course_question",
  "course_answer",
  "course_resource_shared",
  "course_quiz_published",
  "course_attendance_updated",
  "course_completion_issued",
  "course_completion_revoked",
]);
function useReadState(actor: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      before,
      read,
    }: {
      ids: string[] | null;
      before: string | null;
      read: boolean;
    }) => {
      requireOnline();
      return markNotifications(ids, before, read);
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: notificationKeys.all(actor) }),
  });
}
function NotificationRow({
  item,
  zone,
  compact,
  disabled,
  mark,
}: {
  item: NotificationItem;
  zone: string;
  compact?: boolean;
  disabled: boolean;
  mark: (id: string, read: boolean) => void;
}) {
  const { t, i18n } = useTranslation("inbox");
  return (
    <li
      className={`notification-row ${item.read_at ? "" : "notification-unread"}`}
    >
      <strong>{t(knownKinds.has(item.kind) ? item.kind : "activity")}</strong>
      {item.title && <p>{item.title}</p>}
      <small>{dateTime(item.created_at, i18n.language, zone)}</small>
      {item.href ? (
        <Link to={item.href}>{t("open")}</Link>
      ) : (
        !compact && <p className="muted">{t("unavailable")}</p>
      )}
      {(!compact || !item.read_at) && (
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => mark(item.id, !item.read_at)}
        >
          {t(item.read_at ? "markUnread" : "markRead")}
        </Button>
      )}
    </li>
  );
}
export function NotificationsMenu({ id, zone }: { id: string; zone: string }) {
  const { t } = useTranslation("inbox");
  const online = useOnline();
  const query = useQuery(notificationPreviewQuery(id));
  const mark = useReadState(id);
  const count = query.isError ? 0 : (query.data?.unread_count ?? 0);
  const menu = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [location.pathname, location.search]);
  return (
    <details className="notification-menu" ref={menu}>
      <summary
        aria-label={`${t("title")}: ${query.isError ? t("unavailable") : t("count", { count })}`}
      >
        <Bell aria-hidden="true" size={21} />
        {count > 0 && (
          <span className="notification-count" aria-hidden="true">
            {count}
          </span>
        )}
      </summary>
      <div className="notification-popover">
        <h2>{t("title")}</h2>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : !query.data.items.length ? (
          <p>{t("empty")}</p>
        ) : (
          <ul>
            {query.data.items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                zone={zone}
                compact
                disabled={!online || mark.isPending}
                mark={(id, read) =>
                  mark.mutate({ ids: [id], before: null, read })
                }
              />
            ))}
          </ul>
        )}
        {mark.isError && <Notice kind="error">{t("error")}</Notice>}
        <Link to="/notifications">{t("inbox")}</Link>
      </div>
    </details>
  );
}
export function NotificationsPage() {
  const { t } = useTranslation("inbox");
  const actor = useAuth().session!.user.id;
  const client = useQueryClient();
  const online = useOnline();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useInfiniteQuery(notificationInboxQuery(actor, unreadOnly));
  const profile = useQuery(profileQuery(actor));
  const mark = useReadState(actor);
  const refresh = useMutation({
    mutationFn: async () => {
      requireOnline();
      return refreshNotifications();
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: notificationKeys.all(actor) }),
  });
  const first = query.data?.pages[0];
  const items = mergeNotificationPages(query.data?.pages);
  return (
    <>
      <PageHeading title={t("title")} description={t("description")} />
      <div className="panel inbox-toolbar">
        <label htmlFor="inbox-filter">{t("title")}</label>
        <select
          id="inbox-filter"
          value={unreadOnly ? "unread" : "all"}
          onChange={(event) => setUnreadOnly(event.target.value === "unread")}
        >
          <option value="all">{t("all")}</option>
          <option value="unread">{t("unread")}</option>
        </select>
        {first && (
          <span role="status">{t("count", { count: first.unread_count })}</span>
        )}
        <Button
          variant="secondary"
          disabled={
            !online || mark.isPending || !first?.unread_count || query.isError
          }
          onClick={() =>
            mark.mutate({ ids: null, before: first!.as_of, read: true })
          }
        >
          {t("markAll")}
        </Button>
        <Link to="/settings">{t("preferences")}</Link>
      </div>
      <section className="panel inbox-reminders">
        <Button
          disabled={!online || refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          {t("refresh")}
        </Button>
        <p>{t("refreshHelp")}</p>
        {refresh.isSuccess && <Notice>{t("refreshed")}</Notice>}
      </section>
      {(mark.isError || refresh.isError) && (
        <Notice kind="error">{t("error")}</Notice>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : !items.length ? (
        <div className="empty-state">{t("empty")}</div>
      ) : (
        <section className="panel">
          <ul className="inbox-list">
            {items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                zone={profile.data?.time_zone ?? "Europe/Berlin"}
                disabled={!online || mark.isPending}
                mark={(id, read) =>
                  mark.mutate({ ids: [id], before: null, read })
                }
              />
            ))}
          </ul>
          {query.hasNextPage && (
            <Button
              variant="secondary"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("more")}
            </Button>
          )}
        </section>
      )}
    </>
  );
}
function PreferencesForm({
  actor,
  initial,
  reload,
}: {
  actor: string;
  initial: NotificationPreferences;
  reload: () => Promise<NotificationPreferences | undefined>;
}) {
  const { t } = useTranslation("inbox");
  const client = useQueryClient();
  const online = useOnline();
  const { register, handleSubmit, reset, formState } =
    useForm<NotificationPreferences>({
      resolver: zodResolver(notificationPreferencesSchema),
      defaultValues: initial,
    });
  const save = useMutation({
    mutationFn: async (values: NotificationPreferences) => {
      requireOnline();
      return saveNotificationPreferences(values);
    },
    onSuccess: (data) => {
      client.setQueryData(notificationKeys.preferences(actor), data);
      reset(data);
    },
  });
  const conflict = Boolean(
    save.error &&
    typeof save.error === "object" &&
    "code" in save.error &&
    save.error.code === "40001",
  );
  return (
    <form
      className="panel notification-preferences"
      onSubmit={handleSubmit((values) => save.mutate(values))}
    >
      <input type="hidden" {...register("version", { valueAsNumber: true })} />
      <fieldset disabled={save.isPending}>
        <legend>{t("title")}</legend>
        {(["chat", "forum", "job_updates", "reminders"] as const).map((key) => (
          <label key={key} className="notification-preference">
            <input type="checkbox" {...register(key)} />
            <span>{t(key)}</span>
          </label>
        ))}
      </fieldset>
      <p>{t("preferenceHelp")}</p>
      {save.isError && (
        <Notice kind="error">{t(conflict ? "conflict" : "error")}</Notice>
      )}
      {conflict && (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void reload().then((data) => {
              if (data) {
                reset(data);
                save.reset();
              }
            })
          }
        >
          {t("reload")}
        </Button>
      )}
      {save.isSuccess && !formState.isDirty && <Notice>{t("saved")}</Notice>}
      <Button
        type="submit"
        disabled={!online || save.isPending || !formState.isDirty}
      >
        {t("save")}
      </Button>
    </form>
  );
}
export function SettingsPage() {
  const { t } = useTranslation("inbox");
  const actor = useAuth().session!.user.id;
  const preferences = useQuery(notificationPreferencesQuery(actor));
  return (
    <>
      <PageHeading title={t("settings")} description={t("settingsHelp")} />
      {preferences.isPending ? (
        <Loading />
      ) : preferences.isError ? (
        <ErrorState retry={() => void preferences.refetch()} />
      ) : (
        <PreferencesForm
          key={actor}
          actor={actor}
          initial={preferences.data}
          reload={async () => {
            const result = await preferences.refetch();
            return result.isSuccess ? result.data : undefined;
          }}
        />
      )}
      <DeliverySettings actor={actor} />
      <PushSettings key={actor} actor={actor} />
    </>
  );
}
