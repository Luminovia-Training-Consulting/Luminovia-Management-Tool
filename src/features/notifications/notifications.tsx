/**
 * Bell menu, complete inbox and personal notification preferences. Preview/history share
 * appropriate caches while confirmed read state and version conflicts remain visible.
 */
import {useState} from "react";
import {Link} from "react-router-dom";
import {useInfiniteQuery, useMutation, useQuery, useQueryClient,} from "@tanstack/react-query";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {useTranslation} from "react-i18next";
import {notificationCategory, type NotificationCategory} from "./categories";
import {isGuestOnly, isParticipantOnly} from "../auth/guest-navigation";
import {PushSettings} from "./push-settings";
import {useAuth} from "../auth/auth-context";
import {Button} from "../../components/ui/button";
import {ErrorState, Loading, Notice, PageHeading,} from "../../components/common";
import {permissionsQuery, profileQuery, userRolesQuery,} from "../../lib/queries";
import {Preferences} from "../../components/preferences";
import {saveUiPreferences} from "../../lib/ui-preferences-api";
import {WelcomeGuideEntry} from "../onboarding/welcome";
import {requireOnline, useOnline} from "../../lib/online";
import {mergeNotificationPages, notificationInboxQuery, notificationKeys, type NotificationPreferences, notificationPreferencesQuery, notificationPreferencesSchema, refreshNotifications, saveNotificationPreferences,} from "./api";
import "./i18n";
import "./notifications.css";
import {DeliverySettings} from "./delivery-settings";
import {QuietHoursSettings} from "./attention-settings";
import "./attention-i18n";
import {CategorySelector, NotificationRow} from "./notification-common";
import {useReadState} from "./use-notification-read-state";

/** Load inbox history on demand through cursors and keep filter/read state separate. */
export function NotificationsPage() {
    const [category, setCategory] = useState<NotificationCategory>("all");
    const {t} = useTranslation("inbox");
    const actor = useAuth().session!.user.id;
    const client = useQueryClient();
    const online = useOnline();
    const [unreadOnly, setUnreadOnly] = useState(false);
    const roles = useQuery(userRolesQuery(actor));
    const participantOnly = isParticipantOnly(roles.data);
    const query = useInfiniteQuery({
        ...notificationInboxQuery(actor, unreadOnly),
        enabled: online || (roles.isSuccess && !participantOnly),
        refetchOnReconnect: "always",
        staleTime: participantOnly ? 0 : undefined,
        refetchInterval: participantOnly ? 10_000 : undefined,
    });
    const profile = useQuery(profileQuery(actor));
    const mark = useReadState(actor);
    const refresh = useMutation({
        mutationFn: async () => {
            requireOnline();
            return refreshNotifications();
        },
        onSuccess: () =>
            client.invalidateQueries({queryKey: notificationKeys.all(actor)}),
    });
    const first = online && !query.isError ? query.data?.pages[0] : undefined;
    const loadedItems = mergeNotificationPages(query.data?.pages);
    const items = online ? loadedItems : loadedItems.filter(
        (item) => !item.kind.startsWith("course_") && item.kind !== "chat_message",
    );
    return (
        <>
            <PageHeading title={t("title")} description={t("description")}/>
            <div className="panel notification-category-panel">
                <CategorySelector value={category} onChange={setCategory}/>
                <p className="notification-filter-scope">{t("loadedScope")}</p>
            </div>
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
                    <span role="status">{t("count", {count: first.unread_count})}</span>
                )}
                <Button
                    variant="secondary"
                    disabled={
                        !online || mark.isPending || !first?.unread_count || query.isError
                    }
                    onClick={() =>
                        mark.mutate({ids: null, before: first!.as_of, read: true})
                    }
                >
                    {t("markAll")}
                </Button>
                {roles.isSuccess && !participantOnly && <Link to="/settings">{t("preferences")}</Link>}
            </div>
            {roles.isSuccess && !participantOnly && <section className="panel inbox-reminders">
                <Button
                    disabled={!online || refresh.isPending}
                    onClick={() => refresh.mutate()}
                >
                    {t("refresh")}
                </Button>
                <p>{t("refreshHelp")}</p>
                {refresh.isSuccess && <Notice>{t("refreshed")}</Notice>}
            </section>}
            {(mark.isError || refresh.isError) && (
                <Notice kind="error">{t("error")}</Notice>
            )}
            {!online && participantOnly ? (
                <Notice>{t("offlineInbox")}</Notice>
            ) : query.isPending ? (
                <Loading/>
            ) : query.isError ? (
                <ErrorState retry={() => void query.refetch()}/>
            ) : !items.length ? (
                <div className="empty-state">{t("empty")}</div>
            ) : (
                <section className="panel">
                    {!items.some(
                        (item) =>
                            category === "all" ||
                            notificationCategory(item.kind) === category,
                    ) && <p>{t("categoryEmpty")}</p>}
                    <ul className="inbox-list">
                        {items
                            .filter(
                                (item) =>
                                    category === "all" ||
                                    notificationCategory(item.kind) === category,
                            )
                            .map((item) => (
                                <NotificationRow
                                    key={item.id}
                                    item={item}
                                    zone={profile.data?.time_zone ?? "Europe/Berlin"}
                                    disabled={!online || mark.isPending}
                                    mark={(id, read) =>
                                        mark.mutate({ids: [id], before: null, read})
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
    const {t} = useTranslation("inbox");
    const client = useQueryClient();
    const online = useOnline();
    const {register, handleSubmit, reset, formState} =
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
            <input type="hidden" {...register("version", {valueAsNumber: true})} />
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

/** Load the actor's versioned notification preferences and handle errors before opening the editor. */
export function SettingsPage() {
    const {t, i18n} = useTranslation("inbox");
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
    if (roles.isPending) return <Loading/>;
    if (roles.isError) return <ErrorState retry={() => void roles.refetch()}/>;
    if (guestOnly)
        return (
            <>
                <PageHeading title={t("settings")}/>
                <section className="panel settings-section">
                    <h2>{de ? "Darstellung & Sprache" : "Appearance & language"}</h2>
                    <Preferences onSave={saveUiPreferences}/>
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
            <PageHeading title={t("settings")} description={t("settingsHelp")}/>
            <Link className="text-link" to="/api/docs">
                {de ? "API-Dokumentation" : "API documentation"}
            </Link>
            <section className="panel settings-section">
                <h2>{de ? "Darstellung & Sprache" : "Appearance & language"}</h2>
                <Preferences onSave={saveUiPreferences}/>
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
            <details className="panel settings-section" open>
                <summary>{de ? "Benachrichtigungen" : "Notifications"}</summary>
                {preferences.isPending ? (
                    <Loading/>
                ) : preferences.isError ? (
                    <ErrorState retry={() => void preferences.refetch()}/>
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
                <QuietHoursSettings/>
                <DeliverySettings actor={actor}/>
                <PushSettings key={actor} actor={actor}/>
            </details>
            <details
                className="panel settings-section"
                onToggle={(event) => setShowGuide(event.currentTarget.open)}
            >
                <summary>{de ? "Erste Schritte" : "Getting started"}</summary>
                {showGuide && <WelcomeGuideEntry placement="/settings"/>}
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
                                {de ? "Neue Kundenanfragen" : "New customer enquiries"}
                            </Link>
                        )}
                    </div>
                </section>
            )}
        </>
    );
}
