/** Read and save each actor's private calendar event colors using a versioned RPC. */
import {useState} from "react";
import {calendarColorsQuery, type CalendarColors} from "./calendar-color-api";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Button} from "../../components/ui/button";
import {ErrorState, Field, Loading, Notice} from "../../components/common";
import {useOnline} from "../../lib/online";
import {db} from "../../lib/supabase";
import "./filter-i18n";

const palette = [
    {value: "#DCE9F8", key: "calendarColorBlue"},
    {value: "#E1EDDA", key: "calendarColorMint"},
    {value: "#FFF0C5", key: "calendarColorYellow"},
    {value: "#F8E2D3", key: "calendarColorPeach"},
    {value: "#E6E0F0", key: "calendarColorLilac"},
    {value: "#F5DDE7", key: "calendarColorPink"},
    {value: "#DFE6EA", key: "calendarColorSlate"},
] as const;
/** Persist private-event, assignment and light customer-event colors independently for this actor. */
export function CalendarColorPreferences({actor}: { actor: string }) {
    const {t} = useTranslation("calendarFilter");
    const online = useOnline();
    const cache = useQueryClient();
    const options = calendarColorsQuery(actor);
    const query = useQuery(options);
    const [edits, setDraft] = useState<CalendarColors | null>(null);
    const draft = edits ?? query.data;
    const [notice, setNotice] = useState<"saved" | "failed" | "conflict" | null>(
        null,
    );
    const save = useMutation({
        mutationFn: async () => {
            if (!online) throw new Error("offline");
            if (!draft || !query.data) throw new Error("colors_unavailable");
            const {data, error} = await db().rpc(
                "save_my_calendar_color_preferences",
                {
                    p_expected_version: draft.version,
                    p_personal_event_color: draft.personal_event_color,
                    p_assignment_event_color: draft.assignment_event_color,
                    p_customer_event_color: draft.customer_event_color,
                },
            );
            if (error) throw error;
            return data as CalendarColors;
        },
        onSuccess: (value) => {
            cache.setQueryData(options.queryKey, value);
            setDraft(null);
            setNotice("saved");
        },
        onError: (error) =>
            setNotice(
                error && typeof error === "object" && "code" in error &&
                error.code === "40001"
                    ? "conflict"
                    : "failed",
            ),
    });
    return (
        <details className="panel calendar-color-preferences">
            <summary>{t("calendarColors")}</summary>
            {query.isPending ? (
                <Loading/>
            ) : query.isError || !query.data || !draft ? (
                <ErrorState retry={() => void query.refetch()}/>
            ) : (
                <form
                    className="calendar-color-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        setNotice(null);
                        save.mutate();
                    }}
                >
                    <p className="muted">{t("calendarColorsHelp")}</p>
                    {(
                        [
                            ["personal_event_color", "personalColor"],
                            ["assignment_event_color", "assignmentColor"],
                            ["customer_event_color", "customerColor"],
                        ] as const
                    ).map(([key, label]) => (
                        <Field key={key} id={`calendar-${key}`} label={t(label)}>
                            <select
                                value={draft[key]}
                                onChange={(event) => {
                                    const value = event.currentTarget.value;
                                    setNotice(null);
                                    setDraft({...draft, [key]: value});
                                }}
                            >
                                {palette.map((color) => (
                                    <option key={color.value} value={color.value}>
                                        {t(color.key)}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    ))}
                    {notice && (
                        <Notice kind={notice === "saved" ? "success" : "error"}>
                            {t(
                                notice === "saved"
                                    ? "calendarColorsSaved"
                                    : notice === "conflict"
                                        ? "calendarColorsConflict"
                                        : "calendarColorsFailed",
                            )}
                        </Notice>
                    )}
                    <div className="form-actions">
                        <Button type="submit" disabled={!online || save.isPending}>
                            {save.isPending ? t("calendarColorsSaving") : t("calendarColorsSave")}
                        </Button>
                    </div>
                </form>
            )}
        </details>
    );
}