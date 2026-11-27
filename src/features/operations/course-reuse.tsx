/** Review reusable course setup before the server creates an independent draft. */
import { useId, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { z } from "zod";
import { Field, Notice } from "../../components/common";
import { SessionScroll } from "../../components/session-scroll";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { useRequestKey } from "../../lib/request-key";
import { db } from "../../lib/supabase";
import type { CourseRun } from "./data";
import i18n from "../../lib/i18n";
import "./course-reuse.css";

const de = {
  templates: "Kursinhalt und Vorlage",
  reuse: "Bestehende Vorlage verknüpfen",
  copy: "Kursinhalt in eine neue Vorlage kopieren",
  blank: "Leere Vorlage anlegen",
  title: "Name der neuen Vorlage",
  schedule: "Terminplan",
  same: "Termine beibehalten",
  shift: "Termine ab einem neuen Startdatum verschieben",
  none: "Entwurf ohne Termine",
  firstDay: "Neuer erster Unterrichtstag",
  delivery: "Durchführungsform je Termin und Meeting-Plattform",
  venue: "Strukturierte Orte dieses Unternehmens",
  contact: "Aktive Kontaktperson dieses Unternehmens",
  preparation: "Vorbereitungsaufgaben als offen übernehmen",
  materials: "Eigene zur Wiederverwendung freigegebene Kursmaterialien",
  credentials:
    "Der neue Kurs bleibt ein Entwurf. Meeting-Links, Zugangsdaten, Aufträge und bisherige Nachweise werden nicht übernommen.",
  preview: "Kurskopie prüfen",
  plannedDates: "Vorgesehene Termine",
  noSessions: "Der Entwurf erhält keine Termine.",
  preparationCount: "{{count}} Vorbereitungsaufgaben",
  materialCount: "{{count}} wiederverwendbare Materialien",
  contactIncluded: "Kontaktperson wird übernommen.",
  structuredIncluded: "Durchführungsdaten werden übernommen.",
  commit: "Kursentwurf erstellen",
  failed:
    "Die Kurskopie konnte nicht vorbereitet oder gespeichert werden. Prüfe die Auswahl und versuche es erneut.",
  stale: "Die Kursdaten haben sich geändert. Erstelle eine neue Vorschau.",
  invalidTime:
    "Mindestens ein verschobener Termin fällt in eine Zeitumstellung oder überschneidet sich. Wähle ein anderes Startdatum.",
};
const en = {
  templates: "Course content and template",
  reuse: "Link the existing template",
  copy: "Copy course content into a new template",
  blank: "Create a blank template",
  title: "New template name",
  schedule: "Teaching schedule",
  same: "Keep existing dates",
  shift: "Shift sessions to a new start date",
  none: "Create a draft without sessions",
  firstDay: "New first teaching date",
  delivery: "Session delivery formats and meeting platform",
  venue: "Structured venues for this customer",
  contact: "Active contact for this customer",
  preparation: "Copy preparation tasks as open",
  materials: "Own course materials available for reuse",
  credentials:
    "The copy is a new draft. Meeting links, access credentials, teaching offers and existing evidence stay with the original.",
  preview: "Review course copy",
  plannedDates: "Planned sessions",
  noSessions: "The draft will have no sessions.",
  preparationCount: "{{count}} preparation tasks",
  materialCount: "{{count}} reusable materials",
  contactIncluded: "The contact is included.",
  structuredIncluded: "Delivery details are included.",
  commit: "Create course draft",
  failed:
    "Unable to prepare or save the course copy. Check the selected options and try again.",
  stale: "The source changed. Review an updated preview.",
  invalidTime:
    "At least one moved session overlaps another or falls during a clock change. Choose a different start date.",
};
for (const [language, labels] of Object.entries({ de, en }))
  i18n.addResourceBundle(language, "courseReuse", labels, true, true);

const copyPlan = z.object({
  title: z.string(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  time_zone: z.string(),
  sessions: z
    .array(z.object({ starts_at: z.string(), ends_at: z.string() }))
    .max(60),
  structured_delivery: z.boolean(),
  preparation_count: z.number().int(),
  material_count: z.number().int(),
  contact: z.boolean(),
});
type TemplateMode = "reuse" | "copy" | "blank";
type ScheduleMode = "same" | "shift" | "none";
type CopyOptions = {
  template: TemplateMode;
  title: string;
  schedule: ScheduleMode;
  first_day: string;
  delivery: boolean;
  venue: boolean;
  preparation: boolean;
  contact: boolean;
  materials: boolean;
};

export function CourseReuseForm({
  run,
  title,
  onSaved,
}: {
  run: CourseRun;
  title: string;
  onSaved: (courseRunId: string) => Promise<void>;
}) {
  const { t, i18n: locale } = useTranslation("courseReuse");
  const prefix = useId();
  const online = useOnline();
  const requestKey = useRequestKey();
  const [options, setOptions] = useState<CopyOptions>({
    template: "reuse",
    title,
    schedule: run.course_sessions.length > 0 ? "same" : "none",
    first_day: "",
    delivery: true,
    venue: false,
    contact: false,
    preparation: false,
    materials: false,
  });
  const signature = JSON.stringify(options);
  const [review, setReview] = useState<{
    signature: string;
    preview: z.infer<typeof copyPlan>;
  }>();
  const command = useMutation({
    mutationFn: async (revision: string | null) => {
      requireOnline();
      const action = revision ? "save" : "preview";
      const { data, error } = await db().rpc("copy_training_course", {
        p_source_run_id: run.id,
        p_action: action,
        p_options: options,
        p_expected_revision: revision,
        p_request_id: revision
          ? requestKey.forInput(JSON.stringify([run.id, revision, options]))
          : null,
      });
      if (error)
        throw new Error(
          error.code === "PT409"
            ? "stale"
            : /shifted course session|copied schedule/.test(
                  error.message.toLowerCase(),
                )
              ? "invalidTime"
              : "failed",
        );
      if (action === "save") {
        return {
          id: z.object({ course_run_id: z.uuid() }).parse(data).course_run_id,
          signature,
          preview: null,
        };
      }
      return { id: null, signature, preview: copyPlan.parse(data) };
    },
    onSuccess: async (result) => {
      if (result.preview)
        setReview({ signature: result.signature, preview: result.preview });
      else await onSaved(result.id);
    },
  });
  const preview = review?.signature === signature ? review.preview : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    command.mutate(null);
  }

  return (
    <form className="course-reuse-form" onSubmit={submit}>
      <p className="muted">{t("credentials")}</p>
      <fieldset disabled={command.isPending}>
        <div className="form-row">
          <Field id={`${prefix}-template`} label={t("templates")}>
            <select
              id={`${prefix}-template`}
              value={options.template}
              onChange={(event) =>
                setOptions({
                  ...options,
                  template: event.target.value as TemplateMode,
                })
              }
            >
              {(["reuse", "copy", "blank"] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {t(mode)}
                </option>
              ))}
            </select>
          </Field>
          {options.template !== "reuse" && (
            <Field id={`${prefix}-title`} label={t("title")}>
              <input
                required
                maxLength={200}
                id={`${prefix}-title`}
                value={options.title}
                onChange={(event) =>
                  setOptions({ ...options, title: event.target.value })
                }
              />
            </Field>
          )}
        </div>
        <div className="form-row">
          <Field id={`${prefix}-schedule`} label={t("schedule")}>
            <select
              id={`${prefix}-schedule`}
              value={options.schedule}
              onChange={(event) =>
                setOptions({
                  ...options,
                  schedule: event.target.value as ScheduleMode,
                })
              }
            >
              <option value="none">{t("none")}</option>
              {run.course_sessions.length > 0 && (
                <>
                  <option value="same">{t("same")}</option>
                  <option value="shift">{t("shift")}</option>
                </>
              )}
            </select>
          </Field>
          {options.schedule === "shift" && (
            <Field id={`${prefix}-first`} label={t("firstDay")}>
              <input
                required
                id={`${prefix}-first`}
                type="date"
                value={options.first_day}
                min={
                  DateTime.now().setZone(run.time_zone).toISODate() ?? undefined
                }
                onChange={(event) =>
                  setOptions({ ...options, first_day: event.target.value })
                }
              />
            </Field>
          )}
        </div>
        <div className="course-reuse-options">
          {(
            [
              "delivery",
              "venue",
              "preparation",
              "contact",
              "materials",
            ] as const
          ).map((key) => (
            <label key={key} className="checkbox-label">
              <input
                type="checkbox"
                checked={options[key]}
                disabled={
                  (key === "venue" && !options.delivery) ||
                  ((key === "venue" ||
                    key === "contact" ||
                    key === "materials") &&
                    !run.organisation_id)
                }
                onChange={(event) =>
                  setOptions({
                    ...options,
                    [key]: event.target.checked,
                    ...(key === "delivery" && !event.target.checked
                      ? { venue: false }
                      : {}),
                  })
                }
              />
              {t(key)}
            </label>
          ))}
        </div>
        <div className="form-actions">
          <Button variant="secondary" type="submit" disabled={!online}>
            {t("preview")}
          </Button>
          <Button
            type="button"
            disabled={!online || !preview}
            onClick={() => {
              if (preview) command.mutate(preview.revision);
            }}
          >
            {t("commit")}
          </Button>
        </div>
      </fieldset>
      {command.isError && (
        <Notice kind="error">{t(command.error.message)}</Notice>
      )}
      {preview && (
        <section
          className="course-reuse-preview"
          aria-labelledby={`${prefix}-review-title`}
        >
          <h3 id={`${prefix}-review-title`}>{preview.title}</h3>
          {preview.sessions.length > 0 ? (
            <SessionScroll label={t("plannedDates")}>
              <ul className="session-list">
                {preview.sessions.map((session) => (
                  <li key={session.starts_at}>
                    {dateTime(
                      session.starts_at,
                      locale.language,
                      preview.time_zone,
                    )}
                    {" – "}
                    {dateTime(
                      session.ends_at,
                      locale.language,
                      preview.time_zone,
                    )}
                  </li>
                ))}
              </ul>
            </SessionScroll>
          ) : (
            <p>{t("noSessions")}</p>
          )}
          <ul className="course-reuse-summary">
            {options.preparation && (
              <li>
                {t("preparationCount", { count: preview.preparation_count })}
              </li>
            )}
            {options.materials && (
              <li>{t("materialCount", { count: preview.material_count })}</li>
            )}
            {preview.contact && <li>{t("contactIncluded")}</li>}
            {preview.structured_delivery && <li>{t("structuredIncluded")}</li>}
          </ul>
        </section>
      )}
    </form>
  );
}
