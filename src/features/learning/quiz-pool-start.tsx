/** Start or recover a learner's server-selected question form without revealing the pool. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseWorkspaceKey, type CourseWorkspace } from "./api";
import "./quiz-pool-i18n";

export function QuizPoolStart({
  actor,
  course,
}: {
  actor: string;
  course: CourseWorkspace;
}) {
  const { t } = useTranslation("learning");
  const cache = useQueryClient();
  const online = useOnline();
  const quiz = course.quiz!;
  const key = courseWorkspaceKey(actor, course.id);
  const start = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("start_course_quiz_pool", {
        p_run_id: course.id,
        p_quiz_version: quiz.version,
      });
      if (error) throw error;
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  const conflict =
    typeof start.error === "object" &&
    start.error !== null &&
    "code" in start.error &&
    start.error.code === "PT409";
  const canStart = !quiz.passed && quiz.attempts < quiz.max_attempts;

  return (
    <div className="space-y-2">
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
      {canStart && (
        <>
          <p>{t("quizPoolStartHelp", { count: quiz.pool?.draw_count })}</p>
          <Button
            type="button"
            disabled={!online || start.isPending}
            onClick={() => start.mutate()}
          >
            {t("quizPoolStart")}
          </Button>
        </>
      )}
      {start.isError && (
        <Notice kind="error">
          {t(conflict ? "quizPoolStartConflict" : "saveError")}
          {conflict && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                start.reset();
                void cache.invalidateQueries({ queryKey: key });
              }}
            >
              {t("questionBankReload")}
            </Button>
          )}
        </Notice>
      )}
    </div>
  );
}
