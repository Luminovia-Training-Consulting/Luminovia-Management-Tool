/** Recover an eligible learner's online answers without creating an accepted attempt. */
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { H5pAttribution } from "./h5p-attribution";
import { db } from "../../lib/supabase";
import {
  courseAction,
  courseWorkspaceKey,
  courseWorkspaceQuery,
  type CourseWorkspace,
} from "./api";
import "./question-bank-i18n";

type Quiz = NonNullable<CourseWorkspace["quiz"]>;
type Answers = (number | null)[];

/** Start from the server-confirmed revision, or allocate a stable first request ID. */
function attemptDraft(quiz: Quiz) {
  return (
    quiz.draft ?? {
      request_id: quiz.pool?.request_id ?? crypto.randomUUID(),
      revision: 0,
      answers: quiz.questions.map(() => null),
    }
  );
}

export function QuizAttempt({
  course,
  actor,
  academy,
}: {
  course: CourseWorkspace;
  actor: string;
  academy: boolean;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const cache = useQueryClient();
  const quiz = course.quiz!;
  const [draft, setDraft] = useState(() => attemptDraft(quiz));
  const [answers, setAnswers] = useState<Answers>(() => draft.answers);
  const canAttempt = quiz.attempts < quiz.max_attempts && !quiz.passed;
  const dirty = answers !== draft.answers;
  const workspaceKey = courseWorkspaceKey(actor, course.id);

  const save = useMutation({
    mutationFn: async (snapshot: Answers) => {
      requireOnline();
      const { data, error } = await db().rpc("save_course_quiz_draft", {
        p_run_id: course.id,
        p_quiz_version: quiz.version,
        p_attempt_number: quiz.attempts + 1,
        p_request_id: draft.request_id,
        p_expected_revision: draft.revision,
        p_answers: snapshot,
      });
      if (error) throw error;
      if (typeof data !== "number" || !Number.isInteger(data) || data < 1)
        throw new Error("Unconfirmed quiz draft revision");
      return data;
    },
    onSuccess: (revision, snapshot) => {
      const accepted = {
        request_id: draft.request_id,
        revision,
        answers: snapshot,
      };
      setDraft(accepted);
      cache.setQueryData<CourseWorkspace>(workspaceKey, (current) => {
        if (
          current?.quiz?.version !== quiz.version ||
          current.quiz.attempts !== quiz.attempts
        )
          return current;
        return { ...current, quiz: { ...current.quiz, draft: accepted } };
      });
    },
  });
  const attempt = useMutation({
    mutationFn: (submitted: Answers) =>
      courseAction(
        course.id,
        "quiz_attempt",
        { answers: submitted, request_id: draft.request_id },
        quiz.version,
        academy,
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: workspaceKey }),
  });
  const reload = useMutation({
    mutationFn: () =>
      cache.fetchQuery({
        ...courseWorkspaceQuery(actor, course.id),
        staleTime: 0,
      }),
    onSuccess: (latest) => {
      if (
        latest.quiz?.version === quiz.version &&
        latest.quiz.attempts === quiz.attempts
      ) {
        const recovered = attemptDraft(latest.quiz);
        setDraft(recovered);
        setAnswers(recovered.answers);
        save.reset();
      }
    },
  });
  const { mutate: saveDraft, isError: draftError, isPending: saving } = save;
  const conflict =
    typeof save.error === "object" &&
    save.error !== null &&
    "code" in save.error &&
    save.error.code === "PT409";

  // Only a settled prior revision may be the base for another write. Debounce
  // within a tab and keep any newer edits while the earlier snapshot finishes.
  useEffect(() => {
    if (
      !online ||
      !canAttempt ||
      !dirty ||
      saving ||
      draftError ||
      reload.isPending ||
      attempt.isPending
    )
      return;
    const pending = window.setTimeout(() => saveDraft(answers), 550);
    return () => window.clearTimeout(pending);
  }, [
    answers,
    attempt.isPending,
    canAttempt,
    dirty,
    draftError,
    online,
    reload.isPending,
    saveDraft,
    saving,
  ]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !online ||
      !canAttempt ||
      dirty ||
      attempt.isPending ||
      conflict ||
      reload.isPending ||
      answers.some((answer) => answer === null)
    )
      return;
    attempt.mutate(answers);
  }

  return (
    <form onSubmit={submit}>
      {quiz.questions.map((question, index) => (
        <fieldset
          key={index}
          disabled={!canAttempt || attempt.isPending || reload.isPending}
        >
          <legend>{question.prompt}</legend>
          {question.h5p_attribution && (
            <H5pAttribution credits={question.h5p_attribution} />
          )}
          {question.options.map((option, number) => (
            <label className="checkbox-label" key={number}>
              <input
                type="radio"
                required
                name={`quiz-question-${index}`}
                checked={answers[index] === number}
                onChange={() =>
                  setAnswers((current) =>
                    current.map((answer, position) =>
                      position === index ? number : answer,
                    ),
                  )
                }
              />
              {option}
            </label>
          ))}
        </fieldset>
      ))}
      <p>
        {t("quizLimits", {
          attempts: quiz.attempts,
          max: quiz.max_attempts,
          pass: quiz.pass_percent,
        })}
      </p>
      {quiz.last_score !== null && (
        <p>
          {t("score", { score: quiz.last_score })} ·{" "}
          {t(quiz.passed ? "passed" : "notPassed")}
        </p>
      )}
      {saving && <p role="status">{t("quizDraftSaving")}</p>}
      {!dirty && draft.revision > 0 && (
        <p role="status">{t("quizDraftSaved")}</p>
      )}
      {!online && dirty && <p role="status">{t("quizDraftOffline")}</p>}
      {draftError && (
        <Notice kind="error">
          {t(conflict ? "quizDraftConflict" : "quizDraftFailure")}
          <Button
            type="button"
            variant="secondary"
            disabled={!online || reload.isPending || attempt.isPending}
            onClick={() => (conflict ? reload.mutate() : save.reset())}
          >
            {t(conflict ? "quizDraftReload" : "quizDraftRetry")}
          </Button>
        </Notice>
      )}
      <Button
        disabled={
          !online ||
          !canAttempt ||
          dirty ||
          attempt.isPending ||
          conflict ||
          reload.isPending
        }
      >
        {t("submitQuiz")}
      </Button>
      {(attempt.isError || reload.isError) && (
        <Notice kind="error">{t("saveError")}</Notice>
      )}
    </form>
  );
}
