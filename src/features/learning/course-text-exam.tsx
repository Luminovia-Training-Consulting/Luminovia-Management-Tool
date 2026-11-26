/** A course-scoped native exam with versioned papers, private answers and explicit grade release. */
import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { dateTime, resolveScheduleWindow } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { downloadCsv } from "../../lib/csv";
import {
  textExamCommand,
  textExamDraft,
  textExamExportPage,
  textExamExportRequest,
  textExamState,
  type TextExamCommand,
  type TextExamState,
} from "./course-text-exam-schema";
import "./course-text-exam-i18n";

type Props = { actor: string; course: string; zone: string };
type Paper = NonNullable<TextExamState["exam"]>;
type Attempt = NonNullable<TextExamState["attempt"]>;
type Review = NonNullable<TextExamState["review"]>;
type WithoutRun<T> = T extends unknown ? Omit<T, "p_run_id"> : never;
type Action = WithoutRun<TextExamCommand>;
type Run = (command: Action) => Promise<unknown>;

export function CourseTextExam(props: Props) {
  const { t } = useTranslation("textExam");
  const [visited, setVisited] = useState(false);
  return (
    <details
      className="panel learning-panel space-y-3"
      onToggle={(event) => {
        if (event.currentTarget.open) setVisited(true);
      }}
    >
      <summary>{t("title")}</summary>
      {visited && (
        <ExamWorkspace key={props.actor + ":" + props.course} {...props} />
      )}
    </details>
  );
}

function ExamWorkspace({ actor, course, zone }: Props) {
  const { t, i18n } = useTranslation("textExam");
  const id = useId();
  const online = useOnline();
  const client = useQueryClient();
  const [revision, setRevision] = useState<number>();
  const [learner, setLearner] = useState("");
  const [offset, setOffset] = useState(0);
  const key = ["course-text-exam", actor, course];
  const read = useQuery({
    queryKey: [...key, revision, learner, offset],
    enabled: online,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_text_exam", {
          p_run_id: course,
          p_revision: revision ?? null,
          p_learner_id: learner || null,
          p_offset: offset,
        })
        .abortSignal(signal);
      if (error) throw error;
      return textExamState.parse(data);
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.exam && !data.exam.questions) return 10_000;
      return false;
    },
  });
  const write = useMutation({
    mutationFn: async (action: Action) => {
      requireOnline();
      const { data, error } = await db().rpc(
        "course_text_exam_action",
        textExamCommand.parse({ p_run_id: course, ...action }),
      );
      if (error) throw error;
      if (!Number.isInteger(data))
        throw new Error("Unconfirmed text exam action");
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const grades = useMutation({
    mutationFn: async (paperRevision: number) => {
      requireOnline();
      const rows: unknown[][] = [
        [
          "learner_id",
          "learner",
          "exam_revision",
          "grade_revision",
          "submitted_at",
          "score",
          "max_points",
          "passed",
          "released_at",
        ],
      ];
      let after: string | null = null;
      let asOf: string | null = null;
      do {
        const { data, error } = await db().rpc(
          "course_text_exam_grade_export",
          textExamExportRequest.parse({
            p_run_id: course,
            p_revision: paperRevision,
            p_after: after,
            p_as_of: asOf,
          }),
        );
        if (error) throw error;
        const page = textExamExportPage.parse(data);
        if (
          (after && page.next && page.next <= after) ||
          (asOf && asOf !== page.as_of)
        )
          throw new Error("Exam export pagination changed");
        for (const row of page.rows)
          rows.push([
            row.learner_id,
            row.name,
            paperRevision,
            row.grade_revision,
            row.submitted_at,
            row.score,
            row.max_points,
            row.passed,
            row.released_at,
          ]);
        after = page.next;
        asOf = page.as_of;
      } while (after);
      const { data, error } = await db().auth.getSession();
      if (error || data.session?.user.id !== actor)
        throw new Error("Exam export actor changed");
      downloadCsv(`text-exam-grades-v${paperRevision}.csv`, rows);
    },
  });
  const reload = () => {
    write.reset();
    void read.refetch();
  };
  if (read.isPending)
    return online ? <Loading /> : <p role="status">{t("offline")}</p>;
  if (read.isError) {
    return online ? (
      <ErrorState retry={reload} />
    ) : (
      <p role="status">{t("offline")}</p>
    );
  }

  const state = read.data;
  const paper = state.exam;
  const day = (iso: string) => dateTime(iso, i18n.language, zone);
  const pending = write.isPending;
  const disabled = pending || !state.can_write || !online;
  const conflict =
    typeof write.error === "object" &&
    write.error !== null &&
    "code" in write.error &&
    write.error.code === "PT409";

  return (
    <div className="space-y-4" aria-busy={pending}>
      {!online && <p role="status">{t("offline")}</p>}
      {online && !state.can_write && <p role="status">{t("readOnly")}</p>}
      {state.versions.length > 1 && (
        <Field id={id + "-version"} label={t("versionChoice")}>
          <select
            value={revision ?? ""}
            disabled={pending}
            onChange={(event) => {
              setRevision(
                event.target.value ? Number(event.target.value) : undefined,
              );
              setOffset(0);
              setLearner("");
              write.reset();
            }}
          >
            <option value="">{t("current")}</option>
            {state.versions.map((version) => (
              <option value={version.revision} key={version.revision}>
                {t("versionLabel", {
                  title: version.title,
                  number: version.revision,
                })}
                {!version.published_at && " · " + t("draftVersion")}
              </option>
            ))}
          </select>
        </Field>
      )}
      {paper && (
        <div>
          <h3 className="text-lg font-semibold">{paper.title}</h3>
          <p>
            {t("start")}: {day(paper.opens_at)}
          </p>
          <p>
            {t("deadline")}: {day(paper.deadline)}
          </p>
          {state.staff && (
            <p>{t(paper.published_at ? "publishedVersion" : "draftVersion")}</p>
          )}
        </div>
      )}
      {state.staff && paper?.published_at && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!online || grades.isPending}
            onClick={() => grades.mutate(paper.revision)}
          >
            {t(grades.isPending ? "exporting" : "exportGrades")}
          </Button>
          {grades.isError && <Notice kind="error">{t("exportFailed")}</Notice>}
        </div>
      )}
      {!paper && !state.can_author && <p>{t("noExam")}</p>}
      {state.can_author &&
        state.head_revision !== null &&
        revision === undefined && (
          <ExamAuthor
            key={state.head_revision + ":" + paper?.published_at}
            paper={paper}
            zone={zone}
            expected={state.head_revision}
            disabled={disabled}
            run={write.mutateAsync}
          />
        )}
      {state.staff &&
        paper?.questions &&
        (!state.can_author || revision !== undefined || paper.published_at) && (
          <details className="space-y-2">
            <summary>{t("questions")}</summary>
            <ol className="list-decimal space-y-2 pl-5">
              {paper.questions.map((question, index) => (
                <li key={index}>
                  <p className="preserve-text">{question.prompt}</p>
                  <p>{t("max", { points: question.max_points })}</p>
                </li>
              ))}
            </ol>
          </details>
        )}
      {paper?.published_at &&
        (state.staff ? (
          <StaffMarking
            state={state}
            paper={paper}
            learner={learner}
            offset={offset}
            setLearner={setLearner}
            page={(next) => {
              setOffset(next);
              setLearner("");
            }}
            disabled={disabled}
            run={write.mutateAsync}
            loadedAt={read.dataUpdatedAt}
            day={day}
          />
        ) : (
          <LearnerPaper
            key={paper.revision + ":" + state.attempt?.revision}
            state={state}
            paper={paper}
            disabled={disabled}
            run={write.mutateAsync}
            loadedAt={read.dataUpdatedAt}
            day={day}
          />
        ))}
      {write.isSuccess && <Notice>{t("saved")}</Notice>}
      {write.isError && (
        <Notice kind="error">
          <p>{t(conflict ? "conflict" : "saveError")}</p>
          {conflict && (
            <Button variant="secondary" onClick={reload}>
              {t("reload")}
            </Button>
          )}
        </Notice>
      )}
    </div>
  );
}

function ExamAuthor({
  paper,
  expected,
  zone,
  disabled,
  run,
}: {
  paper: Paper | null;
  expected: number;
  zone: string;
  disabled: boolean;
  run: Run;
}) {
  const { t } = useTranslation("textExam");
  const id = useId();
  const localTime = (date?: string) =>
    date ? DateTime.fromISO(date, { zone }).toFormat("yyyy-MM-dd'T'HH:mm") : "";
  const [title, setTitle] = useState(paper?.title ?? "");
  const [opens, setOpens] = useState(localTime(paper?.opens_at));
  const [closes, setCloses] = useState(localTime(paper?.closes_at));
  const [minimum, setMinimum] = useState(String(paper?.pass_percent ?? 70));
  const [secondReviewer, setSecondReviewer] = useState(
    paper?.second_reviewer_required ?? false,
  );
  const [nextQuestion, setNextQuestion] = useState(
    (paper?.questions?.length ?? 1) + 1,
  );
  const [questions, setQuestions] = useState(
    (paper?.questions ?? [{ prompt: "", max_points: 1 }]).map(
      (question, index) => ({
        id: index + 1,
        prompt: question.prompt,
        points: String(question.max_points),
      }),
    ),
  );
  const [invalid, setInvalid] = useState(false);
  const [dirty, setDirty] = useState(false);
  const canPublish = Boolean(paper && !paper.published_at && !dirty);
  return (
    <details
      className="space-y-3"
      open={paper?.published_at ? undefined : true}
    >
      <summary>{t("editor")}</summary>
      {paper?.published_at && <p>{t("draftAfterPublish")}</p>}
      <form
        className="space-y-3"
        onChange={() => {
          setInvalid(false);
          setDirty(true);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const window = resolveScheduleWindow(
            { starts_at: opens, ends_at: closes, time_zone: zone },
            paper
              ? {
                  starts_at: paper.opens_at,
                  ends_at: paper.closes_at,
                  time_zone: zone,
                }
              : undefined,
          );
          if (!window) return setInvalid(true);
          const result = textExamDraft.safeParse({
            title,
            opens_at: window.starts_at,
            closes_at: window.ends_at,
            pass_percent: Number(minimum),
            second_reviewer_required: secondReviewer,
            questions: questions.map((question) => ({
              prompt: question.prompt,
              max_points: Number(question.points),
            })),
          });
          if (!result.success) return setInvalid(true);
          void run({
            p_action: "save_exam",
            p_revision: null,
            p_expected: expected,
            p_payload: result.data,
          }).catch(() => undefined);
        }}
      >
        <fieldset className="space-y-3" disabled={disabled}>
          <Field id={id + "-name"} label={t("name")}>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              required
            />
          </Field>
          <p>{t("zone", { zone })}</p>
          <div className="form-row">
            <Field id={id + "-open"} label={t("start")}>
              <input
                type="datetime-local"
                value={opens}
                onChange={(event) => setOpens(event.target.value)}
                required
              />
            </Field>
            <Field id={id + "-close"} label={t("end")}>
              <input
                type="datetime-local"
                value={closes}
                onChange={(event) => setCloses(event.target.value)}
                required
              />
            </Field>
            <Field id={id + "-pass"} label={t("threshold")}>
              <input
                type="number"
                min={1}
                max={100}
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
                required
              />
            </Field>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={secondReviewer}
              onChange={(event) =>
                setSecondReviewer(event.currentTarget.checked)
              }
            />
            {t("secondReviewer")}
          </label>
          {questions.map((question, index) => (
            <fieldset
              className="space-y-2 rounded-md border p-3"
              key={question.id}
            >
              <legend>{t("number", { number: index + 1 })}</legend>
              <Field id={id + "-prompt-" + question.id} label={t("prompt")}>
                <textarea
                  rows={3}
                  maxLength={2000}
                  required
                  value={question.prompt}
                  onChange={(event) => {
                    const prompt = event.target.value;
                    setQuestions((items) =>
                      items.map((item) =>
                        item.id === question.id ? { ...item, prompt } : item,
                      ),
                    );
                  }}
                />
              </Field>
              <Field id={id + "-points-" + question.id} label={t("points")}>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={question.points}
                  required
                  onChange={(event) => {
                    const points = event.target.value;
                    setQuestions((items) =>
                      items.map((item) =>
                        item.id === question.id ? { ...item, points } : item,
                      ),
                    );
                  }}
                />
              </Field>
              {questions.length > 1 && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setDirty(true);
                    setQuestions((items) =>
                      items.filter((item) => item.id !== question.id),
                    );
                  }}
                >
                  {t("remove", { number: index + 1 })}
                </Button>
              )}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={questions.length >= 20}
              onClick={() => {
                setDirty(true);
                setNextQuestion((next) => next + 1);
                setQuestions((items) => [
                  ...items,
                  { id: nextQuestion, prompt: "", points: "1" },
                ]);
              }}
            >
              {t("add")}
            </Button>
            <Button disabled={!dirty}>{t("saveDraft")}</Button>
          </div>
        </fieldset>
        {invalid && <Notice kind="error">{t("invalid")}</Notice>}
      </form>
      {canPublish && (
        <Confirm
          label={t("publish")}
          details={t("publishPrompt")}
          disabled={disabled}
          submit={() =>
            run({
              p_action: "publish",
              p_revision: null,
              p_expected: expected,
              p_payload: {},
            })
          }
        />
      )}
    </details>
  );
}

/** End editing on the server's clock, even if the local clock differs. */
function useExamClock(serverTime: string, loadedAt: number) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  return Date.parse(serverTime) + Math.max(0, clock - loadedAt);
}

function LearnerPaper({
  paper,
  state,
  disabled,
  run,
  loadedAt,
  day,
}: {
  paper: Paper;
  state: TextExamState;
  disabled: boolean;
  run: Run;
  loadedAt: number;
  day: (date: string) => string;
}) {
  const { t } = useTranslation("textExam");
  const id = useId();
  const now = useExamClock(state.now, loadedAt);
  const [changed, setChanged] = useState<string[]>();
  if (!paper.questions) return <p>{t("notOpen")}</p>;

  const attempt = state.attempt;
  const submitted = attempt?.submitted_at;
  const closed = now >= Date.parse(paper.deadline);
  const answers = changed ?? attempt?.answers ?? paper.questions.map(() => "");
  const save = (command: "save_answers" | "submit") =>
    run({
      p_action: command,
      p_revision: paper.revision,
      p_expected: attempt?.revision ?? 0,
      p_payload: { answers },
    });
  return (
    <div className="space-y-3">
      {submitted ? (
        <p>{t("submitted", { date: day(submitted) })}</p>
      ) : (
        <p>{t(closed ? "closed" : "notSubmitted")}</p>
      )}
      {paper.questions.map((question, index) => (
        <fieldset className="space-y-2 rounded-md border p-3" key={index}>
          <legend>{t("number", { number: index + 1 })}</legend>
          <p className="preserve-text">{question.prompt}</p>
          <p>{t("max", { points: question.max_points })}</p>
          <Field id={id + "-answer-" + index} label={t("answer")}>
            <textarea
              rows={4}
              maxLength={4000}
              value={answers[index]}
              readOnly={Boolean(submitted) || closed || disabled}
              onChange={(event) => {
                const updated = [...answers];
                updated[index] = event.target.value;
                setChanged(updated);
              }}
            />
          </Field>
        </fieldset>
      ))}
      {!submitted && !closed && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => void save("save_answers").catch(() => undefined)}
          >
            {t("saveDraft")}
          </Button>
          <Confirm
            label={t("submit")}
            details={t("submitPrompt")}
            disabled={disabled || answers.some((answer) => !answer.trim())}
            submit={() => save("submit")}
          />
        </div>
      )}
      {submitted &&
        (state.review ? (
          <ReleasedReview review={state.review} />
        ) : (
          <p>{t("awaitingGrade")}</p>
        ))}
    </div>
  );
}

function ReleasedReview({ review }: { review: Review }) {
  const { t } = useTranslation("textExam");
  return (
    <div className="space-y-2" role="status">
      <p className="font-semibold">
        {t(review.passed ? "passed" : "failed")} ·{" "}
        {t("result", { score: review.score, max: review.max_points })}
      </p>
      <ol className="list-decimal pl-5">
        {review.points.map((points, index) => (
          <li key={index}>
            {t("number", { number: index + 1 })}: {points}
          </li>
        ))}
      </ol>
      {review.feedback && <p className="preserve-text">{review.feedback}</p>}
    </div>
  );
}

function StaffMarking({
  state,
  paper,
  learner,
  offset,
  setLearner,
  page,
  disabled,
  run,
  loadedAt,
  day,
}: {
  state: TextExamState;
  paper: Paper;
  learner: string;
  offset: number;
  setLearner: (learner: string) => void;
  page: (offset: number) => void;
  disabled: boolean;
  run: Run;
  loadedAt: number;
  day: (date: string) => string;
}) {
  const { t } = useTranslation("textExam");
  const id = useId();
  const now = useExamClock(state.now, loadedAt);
  const gradingOpen = now >= Date.parse(paper.deadline);
  const selected = state.submissions.find(
    (candidate) => candidate.learner_id === learner,
  );
  return (
    <section className="space-y-3" aria-labelledby={id + "-submissions"}>
      <h4 id={id + "-submissions"} className="font-semibold">
        {t("submissions")}
      </h4>
      {!gradingOpen && <p>{t("waitsForDeadline")}</p>}
      {state.submissions.length === 0 ? (
        <p>{t("noSubmission")}</p>
      ) : (
        <Field id={id + "-learner"} label={t("selectLearner")}>
          <select
            value={learner}
            disabled={!gradingOpen}
            onChange={(event) => setLearner(event.target.value)}
          >
            <option value="">{t("selectLearner")}</option>
            {state.submissions.map((candidate) => {
              const duplicate = state.submissions.some(
                (other) =>
                  other.learner_id !== candidate.learner_id &&
                  other.name === candidate.name,
              );
              const suffix = duplicate
                ? " · " + candidate.learner_id.slice(0, 8)
                : "";
              return (
                <option value={candidate.learner_id} key={candidate.learner_id}>
                  {(candidate.name || t("candidate")) + suffix}
                </option>
              );
            })}
          </select>
        </Field>
      )}
      {selected && (
        <p>
          {t("submitted", { date: day(selected.submitted_at) })} ·{" "}
          {t(selected.review_state)}
        </p>
      )}
      {(offset > 0 || state.has_more) && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            type="button"
            disabled={offset === 0}
            onClick={() => page(offset - 25)}
          >
            {t("previous")}
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={!state.has_more}
            onClick={() => page(offset + 25)}
          >
            {t("next")}
          </Button>
        </div>
      )}
      {learner && state.attempt && paper.questions && (
        <ReviewForm
          key={
            learner +
            ":" +
            state.review?.revision +
            ":" +
            state.review?.released_at
          }
          questions={paper.questions}
          examRevision={paper.revision}
          attempt={state.attempt}
          review={state.review}
          learner={learner}
          disabled={disabled || !gradingOpen}
          run={run}
        />
      )}
    </section>
  );
}

function ReviewForm({
  questions,
  examRevision,
  attempt,
  review,
  learner,
  disabled,
  run,
}: {
  questions: NonNullable<Paper["questions"]>;
  examRevision: number;
  attempt: Attempt;
  review: Review | null;
  learner: string;
  disabled: boolean;
  run: Run;
}) {
  const { t } = useTranslation("textExam");
  const id = useId();
  const [points, setPoints] = useState(() =>
    questions.map((_, index) => String(review?.points[index] ?? "")),
  );
  const [feedback, setFeedback] = useState(review?.feedback ?? "");
  const [dirty, setDirty] = useState(false);
  return (
    <div className="space-y-3">
      {review?.released_at && <ReleasedReview review={review} />}
      <form
        className="space-y-3"
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          void run({
            p_action: "save_review",
            p_revision: examRevision,
            p_expected: review?.revision ?? 0,
            p_payload: {
              learner_id: learner,
              points: points.map(Number),
              feedback,
            },
          }).catch(() => undefined);
        }}
      >
        <fieldset className="space-y-3" disabled={disabled}>
          {questions.map((question, index) => (
            <fieldset className="space-y-2 rounded-md border p-3" key={index}>
              <legend>{t("number", { number: index + 1 })}</legend>
              <p className="preserve-text">{question.prompt}</p>
              <p>{t("max", { points: question.max_points })}</p>
              <div className="preserve-text rounded-md border p-3">
                {attempt.answers[index]}
              </div>
              <Field id={id + "-grade-" + index} label={t("awarded")}>
                <input
                  type="number"
                  min={0}
                  max={question.max_points}
                  value={points[index]}
                  required
                  onChange={(event) => {
                    const updated = [...points];
                    updated[index] = event.target.value;
                    setPoints(updated);
                  }}
                />
              </Field>
            </fieldset>
          ))}
          <Field id={id + "-feedback"} label={t("feedback")}>
            <textarea
              rows={4}
              maxLength={4000}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </Field>
          <Button disabled={!dirty}>{t("saveReview")}</Button>
        </fieldset>
      </form>
      {review &&
        !review.released_at &&
        !dirty &&
        review.can_release === false &&
        !disabled && <p role="status">{t("awaitingSecondReviewer")}</p>}
      {review && !review.released_at && !dirty && (
        <Confirm
          label={t("release")}
          details={t("releasePrompt")}
          disabled={disabled || review.can_release === false}
          submit={() =>
            run({
              p_action: "release",
              p_revision: examRevision,
              p_expected: review.revision,
              p_payload: { learner_id: learner },
            })
          }
        />
      )}
    </div>
  );
}

function Confirm({
  label,
  details,
  disabled,
  submit,
}: {
  label: string;
  details: string;
  disabled: boolean;
  submit: () => Promise<unknown>;
}) {
  const { t } = useTranslation("textExam");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={label}
        description={details}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpen(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              void submit().catch(() => undefined);
            }}
          >
            {label}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
