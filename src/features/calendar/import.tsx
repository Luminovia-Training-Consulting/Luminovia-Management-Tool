/** Review local calendar content before one atomic owner-scoped database import. */
import {useState} from "react";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {DateTime} from "luxon";
import {Upload} from "lucide-react";
import {z} from "zod";
import {db} from "../../lib/supabase";
import {requireOnline, useOnline} from "../../lib/online";
import {dateTime} from "../../lib/dates";
import {Button} from "../../components/ui/button";
import {Field, Notice} from "../../components/common";
import {type ImportedAppointment, parseCalendarImport} from "./import-ical";
import "./import-i18n";
import "./import.css";

export function CalendarImport({
                                   actor,
                                   zone,
                               }: {
    actor: string;
    zone: string;
}) {
    const {t, i18n} = useTranslation("calendarImport");
    const online = useOnline();
    const cache = useQueryClient();
    const [source, setSource] = useState("");
    const [from, setFrom] = useState(() =>
        DateTime.now().setZone(zone).toISODate()!,
    );
    const [until, setUntil] = useState(() =>
        DateTime.now().setZone(zone).plus({years: 1}).toISODate()!,
    );
    const [preview, setPreview] = useState<ImportedAppointment[] | null>(null);
    const [error, setError] = useState("");
    const [reading, setReading] = useState(false);
    const save = useMutation({
        mutationKey: ["calendar-import", actor],
        mutationFn: async () => {
            requireOnline();
            if (!preview) throw new Error("No reviewed import");
            const {data, error} = await db().rpc("import_my_calendar", {
                p_events: preview,
            });
            if (error) throw error;
            return z
                .object({
                    created: z.number().int().nonnegative(),
                    skipped: z.number().int().nonnegative(),
                })
                .parse(data);
        },
        onSuccess: async () => {
            setPreview(null);
            setSource("");
            await cache.invalidateQueries({queryKey: ["events", actor]});
        },
    });

    function review(text = source) {
        save.reset();
        setError("");
        setPreview(null);
        try {
            setPreview(parseCalendarImport(text, zone, from, until, t("untitled")));
        } catch (cause) {
            setError(
                cause instanceof Error &&
                [
                    "unsupported_zone",
                    "invalid_window",
                    "too_many",
                    "empty_window",
                ].includes(cause.message)
                    ? cause.message
                    : "invalid_file",
            );
        }
    }

    return (
        <details className="panel calendar-import">
            <summary>
                <Upload size={18} aria-hidden="true"/> {t("title")}
            </summary>
            <p>{t("help", {zone})}</p>
            <div className="calendar-import-window">
                <Field id="calendar-import-from" label={t("from")}>
                    <input
                        id="calendar-import-from"
                        type="date"
                        value={from}
                        disabled={reading || save.isPending}
                        onChange={(e) => {
                            setFrom(e.target.value);
                            setPreview(null);
                        }}
                    />
                </Field>
                <Field id="calendar-import-until" label={t("until")}>
                    <input
                        id="calendar-import-until"
                        type="date"
                        value={until}
                        disabled={reading || save.isPending}
                        onChange={(e) => {
                            setUntil(e.target.value);
                            setPreview(null);
                        }}
                    />
                </Field>
            </div>
            <Field id="calendar-import-file" label={t("file")}>
                <input
                    id="calendar-import-file"
                    type="file"
                    accept=".ics,text/calendar"
                    disabled={reading || save.isPending}
                    onChange={async (e) => {
                        const input = e.currentTarget;
                        const file = input.files?.[0];
                        if (!file) return;
                        setPreview(null);
                        save.reset();
                        setError("");
                        setSource("");
                        if (
                            file.size > 2_000_000 ||
                            !file.name.toLowerCase().endsWith(".ics")
                        ) {
                            setError("invalid_file");
                            return;
                        }
                        setReading(true);
                        try {
                            const text = await file.text();
                            setSource(text);
                            review(text);
                        } catch {
                            setError("invalid_file");
                        } finally {
                            setReading(false);
                            input.value = "";
                        }
                    }}
                />
            </Field>
            {source && !preview && (
                <Button
                    variant="secondary"
                    disabled={reading || save.isPending}
                    onClick={() => review()}
                >
                    {t("review")}
                </Button>
            )}
            {error && <Notice kind="error">{t(error)}</Notice>}
            {preview && (
                <section aria-label={t("preview")}>
                    <h3>{t("count", {count: preview.length})}</h3>
                    <ul className="calendar-import-preview">
                        {preview.map((item) => (
                            <li key={item.uid}>
                                <strong>{item.title}</strong>
                                <span>
                  {dateTime(item.starts_at, i18n.language, zone)} –{" "}
                                    {dateTime(item.ends_at, i18n.language, zone)}
                </span>
                            </li>
                        ))}
                    </ul>
                    <Button
                        disabled={!online || save.isPending}
                        onClick={() => save.mutate()}
                    >
                        {t("confirm")}
                    </Button>
                </section>
            )}
            {save.isError && <Notice kind="error">{t("failed")}</Notice>}
            {save.isSuccess && <Notice>{t("saved", save.data)}</Notice>}
        </details>
    );
}