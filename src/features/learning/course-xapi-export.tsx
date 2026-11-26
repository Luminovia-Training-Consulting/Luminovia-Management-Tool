/** Authorised course activity export. This browser flow makes no LRS request. */
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { saveBlob } from "../../lib/blob-download";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import i18n from "../../lib/i18n";
import { courseXapiArchiveSchema } from "./xapi-schema";

const copy = {
  title: ["Lernaktivitäten exportieren", "Export learning activity"],
  summary: [
    "xAPI 1.0.3 für bestätigte Quiz-Versuche sowie ausgestellte und widerrufene Abschlussdokumente. Der Export verwendet Pseudonyme.",
    "xAPI 1.0.3 for confirmed quiz attempts and issued or revoked completion documents. The export uses pseudonyms.",
  ],
  from: ["Ab Datum", "From date"],
  through: ["Bis einschließlich", "Through date"],
  download: ["xAPI-Daten herunterladen", "Download xAPI records"],
  failed: [
    "Der Export ist fehlgeschlagen. Prüfe den Zeitraum und die Kursberechtigung.",
    "The export failed. Check the dates and course access.",
  ],
  tooMany: [
    "Mehr als 2.000 Einträge. Wähle einen kürzeren Zeitraum.",
    "More than 2,000 records. Choose a shorter date range.",
  ],
  saved: [
    "{{count}} Einträge heruntergeladen.",
    "Downloaded {{count}} records.",
  ],
} as const;
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    language,
    "courseXapi",
    Object.fromEntries(
      Object.entries(copy).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
}

export function CourseXapiExport({
  runId,
  zone,
}: {
  runId: string;
  zone: string;
}) {
  const { t } = useTranslation("courseXapi");
  const id = useId();
  const online = useOnline();
  const today = DateTime.now().setZone(zone);
  const [from, setFrom] = useState(
    () => today.minus({ days: 29 }).toISODate() ?? "",
  );
  const [through, setThrough] = useState(() => today.toISODate() ?? "");
  const start = DateTime.fromISO(from, { zone }).startOf("day");
  const end = DateTime.fromISO(through, { zone })
    .plus({ days: 1 })
    .startOf("day");
  const valid = start.isValid && end.isValid && end > start;
  const request = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!valid) throw new Error("Invalid export dates");
      const { data, error } = await db().rpc("course_xapi_statements", {
        p_run_id: runId,
        p_from: start.toUTC().toISO(),
        p_until: end.toUTC().toISO(),
      });
      if (error) throw error;
      const archive = courseXapiArchiveSchema.parse(data);
      saveBlob(
        new Blob([JSON.stringify(archive, null, 2)], {
          type: "application/json",
        }),
        `course-xapi-${from}-${through}.json`,
      );
      return archive.statements.length;
    },
  });
  const tooMany =
    typeof request.error === "object" &&
    request.error !== null &&
    "code" in request.error &&
    request.error.code === "54000";
  return (
    <section className="panel learning-panel" aria-labelledby={id + "-title"}>
      <h2 id={id + "-title"}>{t("title")}</h2>
      <p>{t("summary")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && online && !request.isPending) request.mutate();
        }}
      >
        <fieldset className="form-row" disabled={request.isPending}>
          <Field id={id + "-from"} label={t("from")}>
            <input
              required
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field id={id + "-through"} label={t("through")}>
            <input
              required
              type="date"
              min={from}
              value={through}
              onChange={(event) => setThrough(event.target.value)}
            />
          </Field>
        </fieldset>
        <Button type="submit" disabled={!valid || !online || request.isPending}>
          {t("download")}
        </Button>
      </form>
      {request.isError && (
        <Notice kind="error">{t(tooMany ? "tooMany" : "failed")}</Notice>
      )}
      {request.isSuccess && (
        <Notice>{t("saved", { count: request.data })}</Notice>
      )}
    </section>
  );
}
