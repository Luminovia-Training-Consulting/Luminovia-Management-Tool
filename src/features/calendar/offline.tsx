// Optional teaching-only offline view with visible snapshot age and expiry.
// Saving is explicit and online; this view never confirms or changes assignments.
import {useEffect, useState, useSyncExternalStore} from "react";
import {useMutation} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Button} from "../../components/ui/button";
import {Loading, Notice} from "../../components/common";
import {dateTime} from "../../lib/dates";
import {useOnline} from "../../lib/online";
import {clearOfflineSchedule, offlineScheduleRevision, type OfflineScheduleSnapshot, readOfflineSchedule, refreshOfflineSchedule, subscribeOfflineSchedule,} from "./offline-store";
import "./subscriptions-i18n";

export function OfflineSchedule({
                                    actor,
                                    zone,
                                    minimal = false,
                                }: {
    actor: string;
    zone: string;
    minimal?: boolean;
}) {
    const {t, i18n} = useTranslation("calendarSubscriptions"),
        online = useOnline();
    const version = useSyncExternalStore(
        subscribeOfflineSchedule,
        offlineScheduleRevision,
    );
    const [snapshot, setSnapshot] = useState<OfflineScheduleSnapshot | null>(
        null,
    );
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        void readOfflineSchedule(actor)
            .then((value) => {
                if (active) {
                    setSnapshot(value);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (active) {
                    setSnapshot(null);
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [actor, version]);
    useEffect(() => {
        if (!snapshot) return;
        const timer = window.setTimeout(
            () => {
                void readOfflineSchedule(actor)
                    .then(setSnapshot)
                    .catch(() => setSnapshot(null));
            },
            Math.max(0, Date.parse(snapshot.expires_at) - Date.now()),
        );
        return () => window.clearTimeout(timer);
    }, [actor, snapshot]);
    const save = useMutation({mutationFn: () => refreshOfflineSchedule(actor)}),
        clear = useMutation({mutationFn: clearOfflineSchedule});
    return (
        <details className="panel" open={minimal || undefined}>
            <summary>{t("offlineTitle")}</summary>
            <p>{t("offlineHelp")}</p>
            {!minimal && (
                <>
                    <Button
                        disabled={!online || save.isPending || clear.isPending}
                        onClick={() => save.mutate()}
                    >
                        {t("offlineRefresh")}
                    </Button>{" "}
                </>
            )}
            <Button
                variant="secondary"
                disabled={clear.isPending}
                onClick={() => {
                    save.reset();
                    clear.mutate();
                }}
            >
                {t("offlineClear")}
            </Button>
            <Notice>{t("offlineWarning")}</Notice>
            {loading ? (
                <Loading/>
            ) : !snapshot ? (
                <p>{t("offlineEmpty")}</p>
            ) : (
                <>
                    <p>
                        {t("offlineAsOf")}:{" "}
                        {dateTime(snapshot.saved_at, i18n.language, zone)} ·{" "}
                        {t("offlineExpiry")}:{" "}
                        {dateTime(snapshot.expires_at, i18n.language, zone)} · {zone}
                    </p>
                    {snapshot.items.length ? (
                        <ul>
                            {snapshot.items.map((event, index) => (
                                <li key={`${event.starts_at}-${index}`}>
                                    <strong>{event.title}</strong>
                                    <p>
                                        {dateTime(event.starts_at, i18n.language, event.time_zone)}{" "}
                                        – {dateTime(event.ends_at, i18n.language, event.time_zone)}{" "}
                                        · {event.time_zone}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>{t("offlineNoItems")}</p>
                    )}
                </>
            )}
            {save.isSuccess && <Notice>{t("offlineSaved")}</Notice>}
            {(save.isError || clear.isError) && (
                <Notice kind="error">{t("offlineError")}</Notice>
            )}
        </details>
    );
}