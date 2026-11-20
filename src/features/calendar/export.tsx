import {useEffect, useRef, useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {DateTime} from "luxon";
import {db} from "../../lib/supabase";
import {requireOnline, useOnline} from "../../lib/online";
import {Field, Notice} from "../../components/common";
import {Button} from "../../components/ui/button";
import {calendarExportSchema, calendarFile} from "./ical";
import "./export-i18n";

export function CalendarExport({
                                   actor,
                                   zone,
                               }: {
    actor: string;
    zone: string;
}) {
    const {t} = useTranslation("calendarExport");
    const online = useOnline();
    const [month, setMonth] = useState(() =>
        DateTime.now().setZone(zone).toFormat("yyyy-MM"),
    );
    const [includePrivate, setIncludePrivate] = useState(false);
    const pending = useRef<AbortController | null>(null);
    useEffect(
        () => () => {
            pending.current?.abort();
            pending.current = null;
        },
        [actor],
    );
    const exportFile = useMutation({
        mutationKey: ["calendar-export", actor],
        mutationFn: async () => {
            requireOnline();
            const start = DateTime.fromFormat(month, "yyyy-MM", {zone});
            if (!start.isValid || start.toFormat("yyyy-MM") !== month)
                throw new Error("Invalid export month");
            pending.current?.abort();
            const controller = new AbortController();
            pending.current = controller;
            const {data, error} = await db()
                .rpc("export_my_calendar", {
                    p_from: start.toUTC().toISO(),
                    p_until: start.plus({months: 1}).toUTC().toISO(),
                    p_include_private: includePrivate,
                })
                .abortSignal(controller.signal);
            if (pending.current === controller) pending.current = null;
            // Auth transitions unmount this account's workspace. Even an HTTP client
            // which resolves after cancellation must not download the old account's
            // private calendar into the next account's browser session.
            if (controller.signal.aborted)
                throw new DOMException("Calendar export cancelled", "AbortError");
            if (error) throw error;
            const file = calendarFile(
                calendarExportSchema.parse(data),
                t("calendarName"),
            );
            const url = URL.createObjectURL(
                new Blob([file], {type: "text/calendar;charset=utf-8"}),
            );
            try {
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `luminovia-${month}.ics`;
                document.body.append(anchor);
                anchor.click();
                anchor.remove();
            } finally {
                // Leave the download navigation time to consume the object URL.
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        },
    });
    return (
        <details className="panel">
            <summary>{t("title")}</summary>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    exportFile.mutate();
                }}
            >
                <p>{t("help")}</p>
                <Field id="calendar-export-month" label={t("month")}>
                    <input
                        id="calendar-export-month"
                        type="month"
                        value={month}
                        disabled={exportFile.isPending}
                        onChange={(event) => {
                            setMonth(event.target.value);
                            exportFile.reset();
                        }}
                    />
                </Field>
                <label className="notification-preference">
                    <input
                        type="checkbox"
                        checked={includePrivate}
                        disabled={exportFile.isPending}
                        onChange={(event) => {
                            setIncludePrivate(event.target.checked);
                            exportFile.reset();
                        }}
                    />
                    <span>{t("private")}</span>
                </label>
                <p>{t("privacy")}</p>
                {exportFile.isError &&
                    !(
                        exportFile.error instanceof DOMException &&
                        exportFile.error.name === "AbortError"
                    ) && <Notice kind="error">{t("error")}</Notice>}
                {exportFile.isSuccess && <Notice>{t("downloaded")}</Notice>}
                <Button
                    type="submit"
                    disabled={!online || exportFile.isPending || !month}
                >
                    {t("download")}
                </Button>
            </form>
        </details>
    );
}