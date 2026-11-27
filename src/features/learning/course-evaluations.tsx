import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  courseEvaluationComments,
  courseEvaluations,
  evaluationScore,
  ownEvaluation,
  type EvaluationTarget,
  type OwnEvaluation,
} from "./course-evaluation-schema";
import "./course-evaluation-i18n";

const scores = [1, 2, 3, 4, 5];

function targetKey(target: EvaluationTarget) {
  return [target.rater_role, target.subject_kind, target.subject_id].join("/");
}

function targetRequest(target: EvaluationTarget) {
  return {
    p_rater_role: target.rater_role,
    p_subject_kind: target.subject_kind,
    p_subject_id: target.subject_id,
  };
}

function useEvaluationLabels() {
  const { t } = useTranslation("learning");
  return (target: EvaluationTarget) =>
    `${t(`evaluationKind.${target.subject_kind}`)} · ${target.label || t("evaluationFormerSubject")}`;
}

function EvaluationForm({
  target,
  existing,
  disabled,
  pending,
  save,
}: {
  target: EvaluationTarget;
  existing: OwnEvaluation | undefined;
  disabled: boolean;
  pending: boolean;
  save: (score: number, comment: string) => void;
}) {
  const { t } = useTranslation("learning");
  const ratingId = useId();
  const commentId = useId();
  const [rating, setRating] = useState(existing ? String(existing.score) : "");
  const [comment, setComment] = useState(existing?.comment ?? "");
  const isDifficulty = target.subject_kind === "course";
  function submit(event: FormEvent) {
    event.preventDefault();
    const score = evaluationScore.safeParse(Number(rating));
    if (score.success && !disabled) save(score.data, comment.trim());
  }
  return (
    <form className="stack" onSubmit={submit}>
      <Field
        id={ratingId}
        label={t(isDifficulty ? "evaluationDifficulty" : "evaluationScore")}
      >
        <select
          id={ratingId}
          value={rating}
          required
          disabled={disabled}
          onChange={(event) => setRating(event.target.value)}
        >
          <option value="">{t("evaluationSelectScore")}</option>
          {scores.map((score) => (
            <option key={score} value={score}>
              {isDifficulty ? t(`evaluationDifficulty.${score}`) : `${score}/5`}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id={commentId}
        label={t("evaluationComment")}
        hint={t("evaluationCommentHint")}
      >
        <textarea
          id={commentId}
          value={comment}
          maxLength={2000}
          disabled={disabled}
          onChange={(event) => setComment(event.target.value)}
        />
      </Field>
      <Button disabled={disabled || !rating}>
        {t(pending ? "evaluationSaving" : "evaluationSave")}
      </Button>
    </form>
  );
}

/** Load one page of individually authorized scores and optional comments. */
function EvaluationComments({
  actor,
  courseId,
  target,
}: {
  actor: string;
  courseId: string;
  target: EvaluationTarget;
}) {
  const { t } = useTranslation("learning");
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1) ?? null;
  const list = useQuery({
    queryKey: [
      "course-evaluation-comments",
      actor,
      courseId,
      targetKey(target),
      cursor,
    ],
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("course_evaluation_comments", {
          p_run_id: courseId,
          ...targetRequest(target),
          p_after: cursor,
        })
        .abortSignal(signal);
      if (error) throw error;
      return courseEvaluationComments.parse(data);
    },
  });
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState retry={() => void list.refetch()} />;
  const next = list.data.next;
  return (
    <div className="space-y-3 pt-2">
      {list.data.items.length ? (
        <ul className="space-y-2">
          {list.data.items.map(({ id, comment, score }) => (
            <li
              key={id}
              className="whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              <strong>{score}/5</strong>
              {comment && <p>{comment}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("evaluationCommentsEmpty")}</p>
      )}
      {(cursors.length > 0 || next) && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!cursors.length}
            onClick={() => setCursors((values) => values.slice(0, -1))}
          >
            {t("evaluationPrevious")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!next}
            onClick={() => next && setCursors((values) => [...values, next])}
          >
            {t("evaluationNext")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function CourseEvaluations({
  actor,
  courseId,
  readOnly,
}: {
  actor: string;
  courseId: string;
  readOnly: boolean;
}) {
  const { t, i18n } = useTranslation("learning");
  const label = useEvaluationLabels();
  const online = useOnline();
  const cache = useQueryClient();
  const targetId = useId();
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const key = ["course-evaluations", actor, courseId];
  const list = useQuery({
    queryKey: key,
    enabled: online,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_evaluations", { p_run_id: courseId })
        .abortSignal(signal);
      if (error) throw error;
      return courseEvaluations.parse(data);
    },
  });
  const mutation = useMutation({
    onMutate: () => cache.cancelQueries({ queryKey: key, exact: true }),
    mutationFn: async ({
      target,
      version,
      score,
      comment,
    }: {
      target: EvaluationTarget;
      version: number;
      score: number;
      comment: string;
    }) => {
      requireOnline();
      const { data, error } = await db().rpc("save_course_evaluation", {
        p_run_id: courseId,
        ...targetRequest(target),
        p_score: score,
        p_comment: comment,
        p_expected_version: version,
      });
      if (error) throw error;
      const saved = ownEvaluation.parse(data);
      if (
        targetKey(saved) !== targetKey(target) ||
        saved.version !== version + 1
      )
        throw new Error("invalid_evaluation_receipt");
      return saved;
    },
    onSuccess: (saved) => {
      setExpanded(null);
      cache.setQueryData<ReturnType<typeof courseEvaluations.parse>>(
        key,
        (current) => {
          const id = targetKey(saved);
          if (!current?.targets.some((item) => targetKey(item) === id))
            return current;
          const existing = current.mine.find((item) => targetKey(item) === id);
          if (existing && existing.version >= saved.version) return current;
          return {
            ...current,
            mine: [
              ...current.mine.filter((item) => targetKey(item) !== id),
              saved,
            ],
          };
        },
      );
      void cache.invalidateQueries({ queryKey: key, exact: true });
    },
  });
  const conflict =
    (mutation.error as { code?: string } | null)?.code === "PT409";
  const options = list.data?.targets ?? [];
  const target =
    options.find((item) => targetKey(item) === selected) ?? options[0];
  const existing =
    target &&
    list.data?.mine.find((item) => targetKey(item) === targetKey(target));
  const writable = list.data?.writable && !readOnly;
  const number = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 2,
  });

  return (
    <section
      className="panel learning-panel course-room-section min-w-0"
      id="course-evaluations"
      aria-labelledby="course-evaluations-title"
    >
      <h2 id="course-evaluations-title">{t("evaluations")}</h2>
      {online && mutation.isSuccess && <Notice>{t("evaluationSaved")}</Notice>}
      {!online ? (
        <Notice>{t("workspaceOffline")}</Notice>
      ) : list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState retry={() => void list.refetch()} />
      ) : !list.data.completed ? (
        <p>{t("evaluationIncomplete")}</p>
      ) : (
        <div className="stack">
          {writable && target ? (
            <>
              <Field id={targetId} label={t("evaluationTarget")}>
                <select
                  id={targetId}
                  className="max-w-full"
                  value={targetKey(target)}
                  disabled={mutation.isPending}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    mutation.reset();
                  }}
                >
                  {options.map((option) => (
                    <option key={targetKey(option)} value={targetKey(option)}>
                      {t("evaluationAs", {
                        subject: label(option),
                        role: t(`evaluationRater.${option.rater_role}`),
                      })}
                    </option>
                  ))}
                </select>
              </Field>
              <EvaluationForm
                key={`${targetKey(target)}:${existing?.version ?? 0}`}
                target={target}
                existing={existing}
                pending={mutation.isPending}
                disabled={mutation.isPending || conflict}
                save={(score, comment) =>
                  mutation.mutate({
                    target,
                    version: existing?.version ?? 0,
                    score,
                    comment,
                  })
                }
              />
            </>
          ) : (
            list.data.mine.length > 0 && (
              <div className="space-y-2">
                <h3>{t("evaluationMine")}</h3>
                <ul className="space-y-2">
                  {list.data.mine.map((item) => (
                    <li
                      key={targetKey(item)}
                      className="[overflow-wrap:anywhere]"
                    >
                      <strong>
                        {label(item)} · {item.score}/5
                      </strong>
                      {item.comment && (
                        <p className="whitespace-pre-wrap">{item.comment}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
          {conflict ? (
            <Notice kind="error">
              <p>{t("evaluationConflict")}</p>
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  if ((await list.refetch()).isSuccess) mutation.reset();
                }}
              >
                {t("evaluationReload")}
              </Button>
            </Notice>
          ) : mutation.isError ? (
            <Notice kind="error">{t("evaluationSaveError")}</Notice>
          ) : null}
          <div className="space-y-2">
            <h3>{t("evaluationResults")}</h3>
            {!list.data.summaries.length ? (
              <p>{t("evaluationEmpty")}</p>
            ) : (
              <ul className="divide-y">
                {list.data.summaries.map((summary) => {
                  const id = targetKey(summary);
                  return (
                    <li
                      key={id}
                      className="space-y-2 py-3 [overflow-wrap:anywhere]"
                    >
                      <h4>{label(summary)}</h4>
                      <p>
                        {t(`evaluationRater.${summary.rater_role}`)} ·{" "}
                        {t("evaluationAverage", {
                          average: number.format(summary.average),
                          count: summary.count,
                        })}
                      </p>
                      {summary.can_read_comments && (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            aria-expanded={expanded === id}
                            aria-label={`${t("evaluationComments")} · ${label(summary)} · ${t(`evaluationRater.${summary.rater_role}`)}`}
                            onClick={() =>
                              setExpanded(expanded === id ? null : id)
                            }
                          >
                            {t("evaluationComments")}
                          </Button>
                          {expanded === id && (
                            <EvaluationComments
                              key={id}
                              actor={actor}
                              courseId={courseId}
                              target={summary}
                            />
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
