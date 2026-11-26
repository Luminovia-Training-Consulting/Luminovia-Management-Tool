import { lazy, Suspense, useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field, Notice } from "../../components/common";
import { dateTime, zonedInstantForScheduleEdit } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { acceptedFiles, uploadCourseSubmission } from "../files/api";
import { courseWorkspaceKey, downloadPortalDocument } from "./api";
import { publishedExamResultsQuery, timedExamKey } from "./timed-exam-api";
import { examExtraMinutes, type TimedExam } from "./timed-exam-schema";
import { ExamTimeRemaining } from "./exam-time-remaining";
import "./timed-exam-i18n";

const ExamGradeImportPanel = lazy(() =>
  import("./exam-grade-import-panel").then((module) => ({
    default: module.ExamGradeImportPanel,
  })),
);

type ExamBody = Pick<
  TimedExam,
  "title" | "visible_from" | "starts_at" | "ends_at" | "pass_percent"
>;
const times = [
  ["visible_from", "visible"],
  ["starts_at", "starts"],
  ["ends_at", "ends"],
] as const;

export function ExamSchedule({
  actor,
  run,
  zone,
  exam,
}: {
  actor: string;
  run: string;
  zone: string;
  exam?: TimedExam | null;
}) {
  const { t } = useTranslation("timedExam");
  const id = useId();
  const client = useQueryClient();
  const online = useOnline();
  const [title, setTitle] = useState(exam?.title ?? "");
  const [minimum, setMinimum] = useState(String(exam?.pass_percent ?? 50));
  const [dates, setDates] = useState(() =>
    Object.fromEntries(
      times.map(([key]) => [
        key,
        exam
          ? DateTime.fromISO(exam[key], { zone }).toFormat("yyyy-MM-dd'T'HH:mm")
          : "",
      ]),
    ),
  );
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      const window = Object.fromEntries(
        times.map(([key]) => [
          key,
          zonedInstantForScheduleEdit(dates[key], zone, exam?.[key], zone),
        ]),
      );
      const { visible_from, starts_at, ends_at } = window;
      if (!visible_from || !starts_at || !ends_at || !minimum)
        throw new Error("invalid_exam_time");
      const input: ExamBody = {
        title,
        visible_from,
        starts_at,
        ends_at,
        pass_percent: Number(minimum),
      };
      const { data, error } = await db().rpc("save_course_exam_schedule", {
        p_run_id: run,
        p_title: input.title,
        p_visible_from: input.visible_from,
        p_starts_at: input.starts_at,
        p_ends_at: input.ends_at,
        p_pass_percent: input.pass_percent,
        p_version: exam?.version ?? 0,
      });
      if (error || data !== true) throw error ?? new Error("unconfirmed");
    },
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: timedExamKey(actor, run) }),
        client.invalidateQueries({ queryKey: courseWorkspaceKey(actor, run) }),
      ]),
  });
  return (
    <form
      className="panel learning-panel"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2>{t("title")}</h2>
      <p>
        {t("hint")} ({zone})
      </p>
      <Field id={id + "-name"} label={t("paperName")}>
        <input
          required
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <div className="form-row">
        {times.map(([key, label]) => (
          <Field key={key} id={id + "-" + key} label={t(label)}>
            <input
              required
              type="datetime-local"
              value={dates[key]}
              onChange={(event) =>
                setDates((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
            />
          </Field>
        ))}
        <Field id={id + "-pass"} label={t("pass")}>
          <input
            required
            type="number"
            min={0}
            max={100}
            step={1}
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
          />
        </Field>
      </div>
      <Button disabled={!online || save.isPending}>{t("save")}</Button>
      {save.isError && <Notice kind="error">{t("failed")}</Notice>}
    </form>
  );
}

/** Only course managers see the currently enrolled candidates and time revisions. */
export function ExamTimeAllowance({
  actor,
  run,
  exam,
}: {
  actor: string;
  run: string;
  exam: TimedExam;
}) {
  const { t } = useTranslation("timedExam");
  const id = useId();
  const [learner, setLearner] = useState("");
  const candidates = exam.rows.filter((row) => row.time_allowance);
  const selected = candidates.find((row) => row.participant_id === learner);
  if (!exam.can_set_extra_time || !candidates.length) return null;
  return (
    <section className="panel learning-panel" aria-labelledby={id + "-title"}>
      <h2 id={id + "-title"}>{t("extraTime")}</h2>
      <p>{t("extraTimeHint")}</p>
      <Field id={id + "-learner"} label={t("extraTimeLearner")}>
        <select
          value={selected?.participant_id ?? ""}
          onChange={(event) => setLearner(event.target.value)}
        >
          <option value="">{t("extraTimeSelect")}</option>
          {candidates.map((row) => (
            <option key={row.participant_id} value={row.participant_id}>
              {row.name}
            </option>
          ))}
        </select>
      </Field>
      {selected?.time_allowance && (
        <ExamTimeAllowanceForm
          key={selected.participant_id}
          actor={actor}
          run={run}
          learner={selected.participant_id}
          allowance={selected.time_allowance}
        />
      )}
    </section>
  );
}

/** Preserve a draft on background refresh, show conflicts and retry from the reviewed revision. */
function ExamTimeAllowanceForm({
  actor,
  run,
  learner,
  allowance,
}: {
  actor: string;
  run: string;
  learner: string;
  allowance: { extra_minutes: number; revision: number };
}) {
  const { t } = useTranslation("timedExam");
  const id = useId();
  const cache = useQueryClient();
  const online = useOnline();
  const [draft, setDraft] = useState<{ minutes: string; version: number }>();
  const refresh = () =>
    cache.invalidateQueries({ queryKey: timedExamKey(actor, run) });
  const save = useMutation({
    mutationFn: async ({
      minutes,
      version,
    }: {
      minutes: number;
      version: number;
    }) => {
      requireOnline();
      const { data, error } = await db().rpc("set_course_exam_extra_time", {
        p_run_id: run,
        p_participant_id: learner,
        p_extra_minutes: minutes,
        p_expected_revision: version,
      });
      if (error || typeof data !== "number")
        throw error ?? new Error("Unconfirmed exam allowance");
    },
    onSuccess: async () => {
      await refresh();
      setDraft(undefined);
    },
  });
  const conflict =
    draft &&
    (draft.version !== allowance.revision ||
      (typeof save.error === "object" &&
        save.error !== null &&
        "code" in save.error &&
        save.error.code === "PT409"));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft || !draft.minutes || !online || conflict || save.isPending)
          return;
        const minutes = examExtraMinutes.safeParse(Number(draft.minutes));
        if (minutes.success)
          save.mutate({ minutes: minutes.data, version: draft.version });
      }}
    >
      <Field id={id} label={t("extraTimeMinutes")}>
        <input
          type="number"
          min={0}
          max={480}
          step={1}
          required
          disabled={save.isPending}
          value={draft?.minutes ?? allowance.extra_minutes}
          onChange={(event) =>
            setDraft({
              minutes: event.target.value,
              version: draft?.version ?? allowance.revision,
            })
          }
        />
      </Field>
      <div className="form-actions">
        <Button
          type="submit"
          disabled={!online || !draft || Boolean(conflict) || save.isPending}
        >
          {t("saveExtraTime")}
        </Button>
        {conflict && (
          <Button
            type="button"
            variant="secondary"
            disabled={!online}
            onClick={async () => {
              await refresh();
              setDraft(undefined);
              save.reset();
            }}
          >
            {t("reloadExtraTime")}
          </Button>
        )}
      </div>
      {conflict && <Notice kind="error">{t("extraTimeConflict")}</Notice>}
      {!conflict && save.isError && <Notice kind="error">{t("failed")}</Notice>}
      {!draft && save.isSuccess && <Notice>{t("saved")}</Notice>}
    </form>
  );
}

export function LearnerExam({
  actor,
  run,
  zone,
  exam,
  now,
}: {
  actor: string;
  run: string;
  zone: string;
  exam: TimedExam;
  now: number;
}) {
  const { t, i18n } = useTranslation("timedExam");
  const id = useId();
  const online = useOnline();
  const client = useQueryClient();
  const [file, setFile] = useState<{ bytes: File; clientId: string } | null>(
    null,
  );
  const [prepared, setPrepared] = useState<string>();
  const [receipt, setReceipt] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const refresh = () =>
    client.invalidateQueries({ queryKey: timedExamKey(actor, run) });
  const upload = useMutation({
    mutationFn: (selected: NonNullable<typeof file>) =>
      uploadCourseSubmission(selected.bytes, run, selected.clientId, true),
    onSuccess: (document) => {
      if (document.status !== "clean" || !document.current_version_id)
        throw new Error("unconfirmed");
      setPrepared(document.current_version_id);
      return refresh();
    },
  });
  const submit = useMutation({
    mutationFn: async (version: string) => {
      requireOnline();
      const { data, error } = await db().rpc("submit_course_exam", {
        p_run_id: run,
        p_version_id: version,
      });
      if (error || typeof data !== "string")
        throw error ?? new Error("unconfirmed");
      return data;
    },
    onSuccess: (submitted) => {
      setReceipt(submitted);
      setConfirm(false);
      setFile(null);
      return refresh();
    },
  });
  const ready = prepared ?? exam.draft?.version_id;
  const submitted = receipt ?? exam.submitted_at;
  const busy = upload.isPending || submit.isPending;
  const deadline = exam.learner_ends_at ?? exam.ends_at;
  const available = online && exam.can_submit && now < Date.parse(deadline);
  return (
    <section className="panel learning-panel">
      <h2>{exam.title}</h2>
      <p>
        {dateTime(exam.starts_at, i18n.language, zone)} –{" "}
        {dateTime(deadline, i18n.language, zone)} ({zone})
      </p>
      {available && !submitted && (
        <ExamTimeRemaining deadline={deadline} now={now} />
      )}
      {submitted ? (
        <Notice>
          {t("submitted", { date: dateTime(submitted, i18n.language, zone) })}
        </Notice>
      ) : !available ? (
        <p>{t(now >= Date.parse(deadline) ? "ended" : "upcoming")}</p>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (file) upload.mutate(file);
            }}
          >
            <Field id={id} label={t("file")}>
              <input
                type="file"
                accept={acceptedFiles}
                disabled={busy}
                onChange={(event) => {
                  const bytes = event.target.files?.[0];
                  setPrepared(undefined);
                  setFile(
                    bytes ? { bytes, clientId: crypto.randomUUID() } : null,
                  );
                }}
              />
            </Field>
            <Button variant="secondary" disabled={!file || busy}>
              {t(upload.isPending ? "working" : "stage")}
            </Button>
          </form>
          {ready && !upload.isPending && (!file || prepared) && (
            <>
              <p>{t("scanReady")}</p>
              <Button
                type="button"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                {t("submit")}
              </Button>
            </>
          )}
        </>
      )}
      {upload.isError && <Notice kind="error">{t("failed")}</Notice>}
      <Dialog
        open={confirm && Boolean(ready)}
        onOpenChange={(open) => {
          if (!submit.isPending) setConfirm(open);
        }}
        title={t("submit")}
        description={t("scanReady")}
      >
        <Button
          disabled={submit.isPending || !online}
          onClick={() => {
            if (ready) submit.mutate(ready);
          }}
        >
          {t(submit.isPending ? "working" : "submit")}
        </Button>
        {submit.isError && <Notice kind="error">{t("failed")}</Notice>}
      </Dialog>
    </section>
  );
}

export function ExamGrades({
  actor,
  run,
  exam,
}: {
  actor: string;
  run: string;
  exam: TimedExam;
}) {
  const { t } = useTranslation("timedExam");
  const online = useOnline();
  const client = useQueryClient();
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<{ id: string; name: string }>();
  const [confirm, setConfirm] = useState(false);
  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      requireOnline();
      const scores = Object.fromEntries(
        Object.entries(changes)
          .filter(([, value]) => value !== "")
          .map(([id, value]) => [id, Number(value)]),
      );
      const { data, error } = await db().rpc("save_course_exam_grades", {
        p_run_id: run,
        p_scores: scores,
        p_version: exam.version,
        p_publish: publish,
      });
      if (error || data !== true) throw error ?? new Error("unconfirmed");
    },
    onSuccess: async () => {
      setConfirm(false);
      setChanges({});
      await Promise.all([
        client.invalidateQueries({ queryKey: timedExamKey(actor, run) }),
        client.invalidateQueries({
          queryKey: ["published-exam-results", actor],
        }),
      ]);
    },
  });
  const download = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      downloadPortalDocument(
        { kind: "participant_submission", id: run, version_id: id },
        name,
      ),
  });
  const writable =
    exam.can_grade && exam.grading_open && !exam.published && online;
  const importRoster = exam.rows.filter(
    (row) => row.grade_import_eligible === true,
  );
  return (
    <section className="panel learning-panel">
      <h2>{t("grading")}</h2>
      {exam.published && <Notice>{t("published")}</Notice>}
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (writable) save.mutate(false);
        }}
      >
        <ul className="learning-resources">
          {exam.rows.map((row) => (
            <li key={row.participant_id}>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setProfile({
                    id: row.participant_id,
                    name: `${row.name} - ${row.file_name ?? "submission"}`,
                  })
                }
              >
                {row.name}
              </Button>
              {row.version_id ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!online || download.isPending}
                  onClick={() =>
                    download.mutate({ id: row.version_id!, name: row.name })
                  }
                >
                  {t("downloadSubmission")}
                </Button>
              ) : (
                !row.submitted_at && <span>{t("notSubmitted")}</span>
              )}
              {writable ? (
                <Field
                  id={`score-${row.participant_id}`}
                  label={`${t("grade")} · ${row.name}`}
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={changes[row.participant_id] ?? row.score ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setChanges((current) => ({
                        ...current,
                        [row.participant_id]: value,
                      }));
                    }}
                  />
                </Field>
              ) : (
                row.score !== null && <span>{row.score}%</span>
              )}
            </li>
          ))}
        </ul>
        {writable && (
          <div className="form-actions">
            <Button
              variant="secondary"
              disabled={save.isPending || !Object.keys(changes).length}
            >
              {t("saveDraft")}
            </Button>
            <Button
              type="button"
              disabled={save.isPending}
              onClick={() => setConfirm(true)}
            >
              {t("publish")}
            </Button>
            {importRoster.length > 0 && (
              <Suspense fallback={null}>
                <ExamGradeImportPanel
                  actor={actor}
                  run={run}
                  version={exam.version}
                  roster={importRoster}
                  disabled={save.isPending || Object.keys(changes).length > 0}
                />
              </Suspense>
            )}
          </div>
        )}
      </form>
      {(save.isError || download.isError) && (
        <Notice kind="error">{t("failed")}</Notice>
      )}
      {save.isSuccess && <Notice>{t("saved")}</Notice>}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("publish")}
        description={t("publishHint")}
      >
        <Button
          disabled={!writable || save.isPending}
          onClick={() => save.mutate(true)}
        >
          {t("publish")}
        </Button>
        {save.isError && <Notice kind="error">{t("failed")}</Notice>}
      </Dialog>
      {profile && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setProfile(undefined);
          }}
          title={t("learnerProfile", { name: profile.name })}
          description={t("scoped")}
        >
          <PublishedExamResults actor={actor} participant={profile.id} />
        </Dialog>
      )}
    </section>
  );
}

export function PublishedExamResults({
  actor,
  participant,
  organisation,
  run,
}: {
  actor: string;
  participant?: string;
  organisation?: string;
  run?: string;
}) {
  const { t, i18n } = useTranslation("timedExam");
  const online = useOnline();
  const result = useQuery({
    ...publishedExamResultsQuery(actor, participant, organisation),
    enabled: online,
  });
  const rows =
    result.data?.results.filter((row) => !run || row.run_id === run) ?? [];
  const percent = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(value / 100);
  if (!online || result.isPending) return null;
  return (
    <section className="panel learning-panel">
      <h3>{t("results")}</h3>
      {result.isError ? (
        <Notice kind="error">{t("failed")}</Notice>
      ) : !rows.length ? (
        <p>{t("empty")}</p>
      ) : (
        <>
          {!run && result.data && result.data.average !== null && (
            <p>
              <strong>
                {t("average", { score: percent(result.data.average) })}
              </strong>
            </p>
          )}
          <ul className="learning-resources">
            {rows.map((row) => (
              <li key={row.run_id}>
                <strong>
                  {row.course} · {row.title}
                </strong>
                <span>
                  {percent(row.score)} ·{" "}
                  {t(row.passed ? "passed" : "notPassed")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
