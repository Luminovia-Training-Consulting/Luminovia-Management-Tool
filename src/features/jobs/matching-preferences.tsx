/** Edit preferences in the owning lecturer account or qualifications on a job draft. */
import { useId, useState, type FormEvent } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { topicsQuery } from "../../lib/queries";
import {
  type JobMatchingRequirements,
  type LecturerPreferences,
  loadJobMatchingRequirements,
  loadLecturerPreferences,
  matchingConflict,
  matchingPreferencesKey,
  matchingRequirementsKey,
  saveJobMatchingRequirements,
  saveLecturerPreferences,
  teachingFormats,
  teachingLanguageCodes,
} from "./matching-preferences-api";
import { refreshJobState } from "./lifecycle-api";
import "./matching-preferences-i18n";
import "../operations/course-plan.css";

export function TeachingMatchingPreferences({ actor }: { actor: string }) {
  const { t } = useTranslation("teachingMatching");
  const client = useQueryClient();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const key = matchingPreferencesKey(actor);
  const result = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => loadLecturerPreferences(signal),
    enabled: open && online,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <details
      className="panel operations-schedule-planner"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("preferences")}</summary>
      {open &&
        (!online && !result.data ? (
          <Notice>{t("error")}</Notice>
        ) : result.isPending ? (
          <Loading />
        ) : result.isError ? (
          <ErrorState retry={() => void result.refetch()} />
        ) : (
          <PreferenceForm
            key={result.data.version}
            initial={result.data}
            reload={() => void result.refetch()}
            onSave={(receipt) => {
              setSaved(true);
              client.setQueryData(key, receipt);
            }}
          />
        ))}
      {open && saved && <Notice kind="success">{t("saved")}</Notice>}
    </details>
  );
}

function PreferenceForm({
  initial,
  onSave,
  reload,
}: {
  initial: LecturerPreferences;
  onSave: (receipt: LecturerPreferences) => void;
  reload: () => void;
}) {
  const { t, i18n } = useTranslation("teachingMatching");
  const id = useId();
  const online = useOnline();
  const [invalid, setInvalid] = useState(false);
  const mutation = useMutation({
    mutationFn: (payload: Omit<LecturerPreferences, "version">) =>
      saveLecturerPreferences(initial.version, payload),
    onSuccess: onSave,
  });
  const conflicting = matchingConflict(mutation.error);
  const weekdays = new Intl.DateTimeFormat(i18n.language, {
    weekday: "short",
    timeZone: "UTC",
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const start = String(fields.get("start"));
    const end = String(fields.get("end"));
    try {
      if (Boolean(start) !== Boolean(end) || (start && start >= end))
        throw Error("invalid_hours");
      const languages = teachingLanguageCodes(String(fields.get("languages")));
      setInvalid(false);
      mutation.mutate({
        delivery_formats: teachingFormats.filter((format) =>
          fields.getAll("format").includes(format),
        ),
        teaching_languages: languages,
        teaching_days: fields.getAll("day").map(Number),
        teaching_start: start || null,
        teaching_end: end || null,
        urgent_cover: fields.has("urgent"),
      });
    } catch {
      setInvalid(true);
    }
  }

  return (
    <form className="course-planner-fields" onSubmit={submit}>
      <fieldset disabled={mutation.isPending}>
        <legend>{t("formats")}</legend>
        <div className="form-actions">
          {teachingFormats.map((format) => (
            <label className="checkbox-label" key={format}>
              <input
                type="checkbox"
                name="format"
                value={format}
                defaultChecked={initial.delivery_formats.includes(format)}
              />
              {t(format)}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        id={`${id}-languages`}
        label={t("languages")}
        hint={t("languagesHint")}
      >
        <input
          id={`${id}-languages`}
          name="languages"
          maxLength={70}
          defaultValue={initial.teaching_languages.join(", ")}
        />
      </Field>
      <fieldset>
        <legend>{t("days")}</legend>
        <div className="form-actions">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => (
            <label className="checkbox-label" key={day}>
              <input
                type="checkbox"
                name="day"
                value={day}
                defaultChecked={initial.teaching_days.includes(day)}
              />
              {weekdays.format(Date.UTC(2024, 0, day))}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-row">
        <Field id={`${id}-start`} label={t("start")}>
          <input
            id={`${id}-start`}
            type="time"
            name="start"
            defaultValue={initial.teaching_start?.slice(0, 5)}
          />
        </Field>
        <Field id={`${id}-end`} label={t("end")}>
          <input
            id={`${id}-end`}
            type="time"
            name="end"
            defaultValue={initial.teaching_end?.slice(0, 5)}
          />
        </Field>
      </div>
      <p className="muted">{t("hoursHint")}</p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          name="urgent"
          defaultChecked={initial.urgent_cover}
        />
        {t("urgent")}
      </label>
      {invalid && <Notice kind="error">{t("invalid")}</Notice>}
      {mutation.isError && (
        <Notice kind="error">{t(conflicting ? "conflict" : "error")}</Notice>
      )}
      <div className="form-actions">
        {conflicting ? (
          <Button type="button" variant="secondary" onClick={reload}>
            {t("reload")}
          </Button>
        ) : (
          <Button type="submit" disabled={!online || mutation.isPending}>
            {t("save")}
          </Button>
        )}
      </div>
    </form>
  );
}

export function AssignmentMatchingRequirements({
  actor,
  job,
}: {
  actor: string;
  job: string;
}) {
  const { t } = useTranslation("teachingMatching");
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const online = useOnline();
  const client = useQueryClient();
  const key = matchingRequirementsKey(actor, job);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => loadJobMatchingRequirements(job, signal),
    retry: false,
    enabled: open && online,
    refetchOnWindowFocus: false,
  });
  return (
    <details
      className="operations-schedule-planner"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("requirements")}</summary>
      {open &&
        (!online && !query.data ? (
          <Notice>{t("error")}</Notice>
        ) : query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : (
          <RequirementsForm
            key={query.data.version}
            job={job}
            initial={query.data}
            reload={() => void query.refetch()}
            onSave={(data) => {
              setSaved(true);
              client.setQueryData(key, data);
              void refreshJobState(client);
            }}
          />
        ))}
      {open && saved && <Notice kind="success">{t("saved")}</Notice>}
    </details>
  );
}

function RequirementsForm({
  initial,
  job,
  onSave,
  reload,
}: {
  initial: JobMatchingRequirements;
  job: string;
  onSave: (receipt: JobMatchingRequirements) => void;
  reload: () => void;
}) {
  const { t, i18n } = useTranslation("teachingMatching");
  const online = useOnline();
  const id = useId();
  const catalogue = useQuery(topicsQuery);
  const [topics, setTopics] = useState(initial.qualification_topics);
  const [filter, setFilter] = useState("");
  const [invalid, setInvalid] = useState(false);
  const mutation = useMutation({
    mutationFn: (
      payload: Pick<
        JobMatchingRequirements,
        | "qualification_topics"
        | "teaching_languages"
        | "document_evidence_required"
      >,
    ) => saveJobMatchingRequirements(job, initial.version, payload),
    onSuccess: onSave,
  });
  const conflicting = matchingConflict(mutation.error);
  const label = (topic: { label_de: string; label_en: string }) =>
    i18n.language.startsWith("de") ? topic.label_de : topic.label_en;
  const disabled = !initial.can_edit || mutation.isPending;
  const choices = (catalogue.data ?? []).filter(
    (topic) =>
      topics.includes(topic.id) ||
      (!topic.archived_at &&
        initial.can_edit &&
        filter.trim() !== "" &&
        label(topic)
          .toLocaleLowerCase()
          .includes(filter.trim().toLocaleLowerCase())),
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    try {
      const fields = new FormData(event.currentTarget);
      const languages = teachingLanguageCodes(String(fields.get("languages")));
      setInvalid(false);
      mutation.mutate({
        qualification_topics: topics,
        teaching_languages: languages,
        document_evidence_required: topics.length > 0 && fields.has("evidence"),
      });
    } catch {
      setInvalid(true);
    }
  }
  return (
    <form className="course-planner-fields" onSubmit={submit}>
      <fieldset disabled={disabled}>
        <legend>{t("qualifications")}</legend>
        <p className="muted">{t("qualificationHint")}</p>
        {initial.can_edit && (
          <Field id={`${id}-filter`} label={t("filter")}>
            <input
              id={`${id}-filter`}
              type="search"
              value={filter}
              maxLength={120}
              onChange={(event) => setFilter(event.target.value)}
            />
          </Field>
        )}
        {catalogue.isPending ? (
          <Loading />
        ) : catalogue.isError ? (
          <ErrorState retry={() => void catalogue.refetch()} />
        ) : (
          <div className="form-actions">
            {choices.slice(0, 40).map((topic) => (
              <label className="checkbox-label" key={topic.id}>
                <input
                  type="checkbox"
                  checked={topics.includes(topic.id)}
                  disabled={topics.length >= 20 && !topics.includes(topic.id)}
                  onChange={(event) =>
                    setTopics(
                      event.target.checked
                        ? [...topics, topic.id]
                        : topics.filter((value) => value !== topic.id),
                    )
                  }
                />
                {label(topic)}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <Field
        id={`${id}-languages`}
        label={t("languages")}
        hint={t("languagesHint")}
      >
        <input
          id={`${id}-languages`}
          name="languages"
          maxLength={70}
          disabled={disabled}
          defaultValue={initial.teaching_languages.join(", ")}
        />
      </Field>
      <label className="checkbox-label">
        <input
          type="checkbox"
          name="evidence"
          disabled={disabled || topics.length === 0}
          defaultChecked={initial.document_evidence_required}
        />
        {t("requireEvidence")}
      </label>
      {!initial.can_edit && <p className="muted">{t("protected")}</p>}
      {invalid && <Notice kind="error">{t("invalid")}</Notice>}
      {mutation.isError && (
        <Notice kind="error">{t(conflicting ? "conflict" : "error")}</Notice>
      )}
      {initial.can_edit && (
        <div className="form-actions">
          {conflicting ? (
            <Button type="button" variant="secondary" onClick={reload}>
              {t("reload")}
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!online || disabled || !catalogue.isSuccess}
            >
              {t("save")}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
