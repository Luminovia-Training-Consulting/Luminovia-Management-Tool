/**
 * Bell menu, complete inbox and personal notification preferences. Preview/history share
 * appropriate caches while confirmed read state and version conflicts remain visible.
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { notificationCategory, type NotificationCategory } from "./categories";
import { isGuestOnly, isParticipantOnly } from "../auth/guest-navigation";
import { PushSettings } from "./push-settings";
import { PreferenceSaveControls } from "./preference-save-controls";
import { useAuth } from "../auth/auth-context";
import { AuthenticatorSettings } from "../auth/authenticator";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Loading,
  NextPageError,
  Notice,
  PageHeading,
} from "../../components/common";
import {
  permissionsQuery,
  profileQuery,
  userRolesQuery,
} from "../../lib/queries";
import { Preferences } from "../../components/preferences";
import { saveUiPreferences } from "../../lib/ui-preferences-api";
import { WelcomeGuideEntry } from "../onboarding/welcome";
import { canRetryNextPage } from "../../lib/paged-read";
import { requireOnline, useOnline } from "../../lib/online";
import {
  mergeNotificationPages,
  notificationInboxQuery,
  notificationKeys,
  type NotificationPreferences,
  notificationPreferencesQuery,
  notificationPreferencesSchema,
  refreshNotifications,
  saveNotificationPreferences,
} from "./api";
import "./i18n";
import "./notifications.css";
import { DeliverySettings } from "./delivery-settings";
import { QuietHoursSettings } from "./attention-settings";
import "./attention-i18n";
import { CategorySelector, NotificationRow } from "./notification-common";
import { useReadState } from "./use-notification-read-state";

/** Load inbox history on demand through cursors and keep filter/read state separate. */
export function NotificationsPage({
  academy,
}: { academy?: "active" | "grace" } = {}) {
  const [category, setCategory] = useState<NotificationCategory>("all");
  const { t } = useTranslation("inbox");
  const actor = useAuth().session!.user.id;
  const client = useQueryClient();
  const online = useOnline();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const roles = useQuery({ ...userRolesQuery(actor), enabled: !academy });
  const participantOnly = isParticipantOnly(roles.data);
  const readOnly = academy === "grace";
  const showReminderActions = !academy && roles.isSuccess && !participantOnly;
  const sensitive = Boolean(academy) || participantOnly;
  const query = useInfiniteQuery({
    ...notificationInboxQuery(actor, unreadOnly),
    enabled: online || (!academy && roles.isSuccess && !participantOnly),
    refetchOnReconnect: "always",
    staleTime: sensitive ? 0 : undefined,
    refetchOnMount: academy ? "always" : undefined,
    refetchInterval: sensitive ? 10_000 : undefined,
  });
  const profile = useQuery({ ...profileQuery(actor), enabled: !academy });
  const {
    mutate: markRead,
    isPending: marking,
    isError: markFailed,
  } = useReadState(actor);
  const markItem = useCallback(
    (id: string, read: boolean) => markRead({ ids: [id], before: null, read }),
    [markRead],
  );
  const refresh = useMutation({
    mutationFn: async () => {
      requireOnline();
      return refreshNotifications();
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: notificationKeys.all(actor) }),
  });
  const awaitingAcademy = Boolean(
    academy && query.isFetching && !query.isFetchedAfterMount,
  );
  const retryNext = canRetryNextPage(query);
  const inboxFailed = query.isError && !retryNext;
  const first =
    online && !inboxFailed && !awaitingAcademy
      ? query.data?.pages[0]
      : undefined;
  const loadedItems = useMemo(
    () => mergeNotificationPages(query.data?.pages),
    [query.data?.pages],
  );
  const items = useMemo(
    () =>
      online
        ? loadedItems
        : loadedItems.filter(
            (item) =>
              !item.kind.startsWith("course_") && item.kind !== "chat_message",
          ),
    [loadedItems, online],
  );
  const visibleItems = useMemo(
    () =>
      category === "all"
        ? items
        : items.filter((item) => notificationCategory(item.kind) === category),
    [items, category],
  );
  const canMark =
    category === "all"
      ? Boolean(first?.unread_count)
      : visibleItems.some((item) => !item.read_at);
  const zone = academy
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : (profile.data?.time_zone ?? "Europe/Berlin");
  return (
    <>
      <PageHeading title={t("title")} description={t("description")} />
      <section className="panel inbox-tools" aria-label={t("readFilter")}>
        {!academy && (
          <div className="notification-category-panel">
            <CategorySelector value={category} onChange={setCategory} />
            <p className="notification-filter-scope">{t("loadedScope")}</p>
          </div>
        )}
        <div className="inbox-toolbar">
          <div className="inbox-read-filter">
            <label htmlFor="inbox-filter">{t("readFilter")}</label>
            <select
              id="inbox-filter"
              value={unreadOnly ? "unread" : "all"}
              onChange={(event) =>
                setUnreadOnly(event.target.value === "unread")
              }
            >
              <option value="all">{t("all")}</option>
              <option value="unread">{t("unread")}</option>
            </select>
            {first && (
              <span role="status">
                {t("count", { count: first.unread_count })}
              </span>
            )}
          </div>
          <div className="inbox-toolbar-actions">
            {!readOnly && (
              <Button
                variant="secondary"
                disabled={!first || !canMark || marking}
                onClick={() =>
                  markRead(
                    category === "all"
                      ? { ids: null, before: first!.as_of, read: true }
                      : {
                          ids: visibleItems
                            .filter((item) => !item.read_at)
                            .map((item) => item.id),
                          before: null,
                          read: true,
                        },
                  )
                }
              >
                {t(category === "all" ? "markAll" : "markCategoryVisible")}
              </Button>
            )}
            {showReminderActions && (
              <>
                <Button
                  variant="secondary"
                  disabled={!online || refresh.isPending}
                  onClick={() => refresh.mutate()}
                >
                  {t("refresh")}
                </Button>
                <Button asChild variant="ghost">
                  <Link to="/settings">{t("preferences")}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
        {showReminderActions && (
          <details className="inbox-reminders">
            <summary>{t("reminderScope")}</summary>
            <p>{t("refreshHelp")}</p>
          </details>
        )}
        {refresh.isSuccess && <Notice>{t("refreshed")}</Notice>}
      </section>
      {(markFailed || refresh.isError) && (
        <Notice kind="error">{t("error")}</Notice>
      )}
      {!online && sensitive ? (
        <Notice>{t("offlineInbox")}</Notice>
      ) : query.isPending || awaitingAcademy ? (
        <Loading />
      ) : inboxFailed ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : !items.length ? (
        <div className="empty-state">{t("empty")}</div>
      ) : (
        <section className="panel">
          {visibleItems.length === 0 && <p>{t("categoryEmpty")}</p>}
          <ul className="inbox-list">
            {visibleItems.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                appealActor={academy ? undefined : actor}
                zone={zone}
                disabled={!online || marking}
                readOnly={readOnly}
                mark={markItem}
              />
            ))}
          </ul>
          {retryNext ? (
            <NextPageError
              retry={() => void query.fetchNextPage({ cancelRefetch: false })}
              disabled={!online || query.isFetching}
            />
          ) : (
            query.hasNextPage && (
              <Button
                variant="secondary"
                disabled={!online || query.isFetching}
                onClick={() =>
                  void query.fetchNextPage({ cancelRefetch: false })
                }
              >
                {t("more")}
              </Button>
            )
          )}
        </section>
      )}
    </>
  );
}

/** Edit personal categories against the loaded version instead of overwriting current server state blindly. */
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
      <PreferenceSaveControls
        namespace="inbox"
        online={online}
        dirty={formState.isDirty}
        save={save}
        reload={reload}
        reset={reset}
      />
    </form>
  );
}

/** Load the actor's versioned notification preferences and handle errors before opening the editor. */
export function SettingsPage() {
  const { t, i18n } = useTranslation("inbox");
  const de = i18n.language.startsWith("de");
  const actor = useAuth().session!.user.id;
  const [showGuide, setShowGuide] = useState(false);
  const roles = useQuery(userRolesQuery(actor));
  const guestOnly = isGuestOnly(roles.data);
  const operational = !roles.isPending && !roles.isError && !guestOnly;
  const preferences = useQuery({
    ...notificationPreferencesQuery(actor),
    enabled: operational,
  });
  const permissions = useQuery({
    ...permissionsQuery(actor),
    enabled: operational,
  });
  if (roles.isPending) return <Loading />;
  if (roles.isError) return <ErrorState retry={() => void roles.refetch()} />;
  if (guestOnly)
    return (
      <>
        <PageHeading title={t("settings")} />
        <section className="panel settings-section">
          <h2>{de ? "Darstellung & Sprache" : "Appearance & language"}</h2>
          <Preferences onSave={saveUiPreferences} />
        </section>
        <section className="panel settings-section">
          <h2>{de ? "Mein Konto" : "My account"}</h2>
          <Link className="text-link" to="/profile">
            {de ? "Profil bearbeiten" : "Edit profile"}
          </Link>
        </section>
      </>
    );

  return (
    <>
      <PageHeading title={t("settings")} description={t("settingsHelp")} />
      <Link className="text-link" to="/api/docs">
        {de ? "API-Dokumentation" : "API documentation"}
      </Link>
      <section className="panel settings-section">
        <h2>{de ? "Darstellung & Sprache" : "Appearance & language"}</h2>
        <Preferences onSave={saveUiPreferences} />
      </section>
      <section className="panel settings-section">
        <h2>{de ? "Mein Konto" : "My account"}</h2>
        <p>
          {de
            ? "Profil, Passwort und persönliche Kontaktdaten verwalten."
            : "Manage your profile, password and personal contact details."}
        </p>
        <Link className="text-link" to="/profile">
          {de ? "Profil bearbeiten" : "Edit profile"}
        </Link>
      </section>
      {roles.data?.some((role) => role === "admin" || role === "owner") && (
        <AuthenticatorSettings actor={actor} />
      )}
      <details className="panel settings-section" open>
        <summary>{de ? "Benachrichtigungen" : "Notifications"}</summary>
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
      </details>
      <details className="panel settings-section">
        <summary>
          {de ? "Ruhezeiten & Zustellung" : "Quiet hours & delivery"}
        </summary>
        <div className="section-stack notification-delivery-stack">
          <QuietHoursSettings />
          <DeliverySettings actor={actor} />
          <PushSettings key={actor} actor={actor} />
        </div>
      </details>
      <details
        className="panel settings-section"
        onToggle={(event) => setShowGuide(event.currentTarget.open)}
      >
        <summary>{de ? "Erste Schritte" : "Getting started"}</summary>
        {showGuide && <WelcomeGuideEntry placement="/settings" />}
      </details>
      {permissions.data?.includes("jobs.manage") && (
        <section className="panel settings-section">
          <h2>{de ? "Organisation & Betrieb" : "Organisation & operations"}</h2>
          <div className="settings-links">
            <Link to="/control-center">
              {de ? "Betriebsübersicht" : "Operations overview"}
            </Link>
            <Link to="/topics">{de ? "Themen & Tools" : "Topics & tools"}</Link>
            {permissions.data.includes("users.manage") && (
              <Link to="/admin/accounts">
                {de ? "Benutzer & Rollen" : "Users & roles"}
              </Link>
            )}
            {permissions.data.includes("organisations.manage") && (
              <Link to="/enquiries">
                {de ? "Neue Unternehmensanfragen" : "New company enquiries"}
              </Link>
            )}
          </div>
        </section>
      )}
    </>
  );
}
