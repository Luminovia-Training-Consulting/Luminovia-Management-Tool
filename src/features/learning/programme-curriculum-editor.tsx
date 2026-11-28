/** Edit programme objectives and evaluated completion requirements before enrolment. */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { configureLearningProgramCurriculum } from "./learning-program-api";
import {
  programmeCurriculum,
  type LearningProgramDetail,
  type ProgrammeCurriculum,
} from "./learning-program-schema";

/** The form is pinned to its opened version and closes on confirmed publication. */
export function ProgrammeCurriculumEditor({
  program,
  onSaved,
  onCancel,
}: {
  program: LearningProgramDetail;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("learningPrograms");
  const online = useOnline();
  const [version] = useState(program.version);
  const [curriculum, setCurriculum] = useState<ProgrammeCurriculum>(() => ({
    overview: program.curriculum?.overview ?? "",
    elective_count: program.curriculum?.elective_count ?? 0,
    steps: Object.fromEntries(
      (program.steps ?? []).flatMap(({ course_id }) =>
        course_id
          ? [
              [
                course_id,
                program.curriculum?.steps[course_id] ?? {
                  required: true,
                  objectives: "",
                  remediation: "",
                },
              ],
            ]
          : [],
      ),
    ),
  }));
  const [issue, setIssue] = useState(false);
  const [resetting, setResetting] = useState(false);
  const pending = useMutation({
    mutationFn: (content: ProgrammeCurriculum | null) =>
      configureLearningProgramCurriculum({
        p_program_id: program.id,
        p_expected_version: version,
        p_curriculum: content,
      }),
    onSuccess: onSaved,
  });
  const stale = version !== program.version;
  const cannotSave = !online || stale || pending.isPending;
  const electives = Object.values(curriculum.steps).filter(
    ({ required }) => !required,
  ).length;

  function editStep(
    id: string,
    change: Partial<ProgrammeCurriculum["steps"][string]>,
  ) {
    setCurriculum((current) => {
      const steps = {
        ...current.steps,
        [id]: { ...current.steps[id], ...change },
      };
      const remainingElectives = Object.values(steps).filter(
        ({ required }) => !required,
      ).length;
      return {
        ...current,
        steps,
        elective_count: remainingElectives
          ? Math.min(current.elective_count, remainingElectives)
          : 0,
      };
    });
  }

  function changeResetting(open: boolean) {
    pending.reset();
    setResetting(open);
  }

  return (
    <form
      className="programme-steps"
      onSubmit={(event) => {
        event.preventDefault();
        if (cannotSave || resetting) return;
        const parsed = programmeCurriculum.safeParse(curriculum);
        setIssue(!parsed.success);
        if (parsed.success) pending.mutate(parsed.data);
      }}
    >
      <fieldset className="programme-steps" disabled={cannotSave}>
        <legend>{t("curriculumEdit")}</legend>
        <label>
          {t("curriculumOverview")}
          <textarea
            maxLength={4000}
            value={curriculum.overview}
            onChange={({ target }) =>
              setCurriculum({ ...curriculum, overview: target.value })
            }
          />
        </label>
        {(program.steps ?? []).map(({ course_id, title }, index) => {
          if (!course_id || !curriculum.steps[course_id]) return null;
          const { objectives, remediation, required } =
            curriculum.steps[course_id];
          return (
            <fieldset key={course_id} className="programme-steps">
              <legend>{title}</legend>
              <label>
                {t("curriculumObjectives")}
                <textarea
                  maxLength={1200}
                  value={objectives}
                  onChange={({ target }) =>
                    editStep(course_id, { objectives: target.value })
                  }
                />
              </label>
              {index > 0 && (
                <label>
                  {t("curriculumRemediation")}
                  <textarea
                    maxLength={1200}
                    value={remediation}
                    onChange={({ target }) =>
                      editStep(course_id, { remediation: target.value })
                    }
                  />
                </label>
              )}
              {index > 0 ? (
                <label>
                  <input
                    type="checkbox"
                    checked={required}
                    onChange={({ target }) =>
                      editStep(course_id, { required: target.checked })
                    }
                  />{" "}
                  {t("curriculumRequired")}
                </label>
              ) : (
                <p>{t("curriculumFirstRequired")}</p>
              )}
            </fieldset>
          );
        })}
        {electives > 0 && (
          <label>
            {t("curriculumElectiveCount")}
            <input
              type="number"
              min={0}
              max={electives}
              required
              value={
                Number.isNaN(curriculum.elective_count)
                  ? ""
                  : curriculum.elective_count
              }
              onChange={({ target }) =>
                setCurriculum({
                  ...curriculum,
                  elective_count: target.valueAsNumber,
                })
              }
            />
          </label>
        )}
      </fieldset>
      <div className="form-actions">
        <Button type="submit" disabled={cannotSave}>
          {t("curriculumPublish")}
        </Button>
        {program.curriculum && (
          <Button
            type="button"
            variant="secondary"
            disabled={cannotSave}
            onClick={() => changeResetting(true)}
          >
            {t("curriculumReset")}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={pending.isPending}
          onClick={onCancel}
        >
          {t("curriculumCancel")}
        </Button>
      </div>
      <Dialog
        open={resetting}
        onOpenChange={changeResetting}
        title={t("curriculumReset")}
        description={t("curriculumResetHint")}
        closeDisabled={pending.isPending}
      >
        {(pending.isError || stale) && (
          <Notice kind="error">{t("curriculumError")}</Notice>
        )}
        {!online && <Notice>{t("curriculumOffline")}</Notice>}
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={pending.isPending}
            onClick={() => changeResetting(false)}
          >
            {t("curriculumCancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={cannotSave}
            onClick={() => pending.mutate(null)}
          >
            {t("curriculumResetConfirm")}
          </Button>
        </div>
      </Dialog>
      {((pending.isError && !resetting) || issue || stale) && (
        <Notice kind="error">{t("curriculumError")}</Notice>
      )}
      {!online && <Notice>{t("curriculumOffline")}</Notice>}
    </form>
  );
}
