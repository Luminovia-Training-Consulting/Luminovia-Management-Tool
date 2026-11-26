/** Edit one versioned course gate before a programme's first learner enrolment. */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { setLearningProgramPrerequisite } from "./learning-program-api";
import type { LearningProgramDetail } from "./learning-program-schema";

type RuleDraft = {
  position: number;
  mode: "all" | "any";
  positions: number[];
  version: number;
};

export function ProgrammePrerequisites({
  program,
  refresh,
}: {
  program: LearningProgramDetail;
  refresh: () => void;
}) {
  const { t } = useTranslation("learningPrograms");
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const save = useMutation({
    mutationFn: setLearningProgramPrerequisite,
    onSuccess: () => {
      setDraft(null);
      refresh();
    },
  });
  const steps = program.steps ?? [];
  const stale = draft && draft.version !== program.version;
  if (steps.length < 2) return null;
  return (
    <section className="panel programme-panel">
      <h3>{t("pathRules")}</h3>
      <p>{t("pathRulesHint")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft || stale) return;
          save.mutate({
            p_program_id: program.id,
            p_position: draft.position,
            p_mode: draft.mode,
            p_requires: draft.positions,
            p_expected_version: draft.version,
          });
        }}
      >
        <fieldset disabled={save.isPending}>
          <label>
            {t("pathTarget")}
            <select
              value={draft?.position ?? ""}
              onChange={(event) => {
                save.reset();
                const position = Number(event.currentTarget.value);
                const rule = program.path_rules?.[position];
                setDraft(
                  position
                    ? {
                        position,
                        version: program.version,
                        mode: rule?.mode ?? "all",
                        positions: rule?.positions ?? [],
                      }
                    : null,
                );
              }}
            >
              <option value="">{t("selectCourse")}</option>
              {steps.slice(1).map((step, offset) => (
                <option key={offset + 2} value={offset + 2}>
                  {step.title}
                </option>
              ))}
            </select>
          </label>
          {draft && (
            <>
              <label>
                {t("pathMode")}
                <select
                  value={draft.mode}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      mode: event.currentTarget.value === "any" ? "any" : "all",
                    })
                  }
                >
                  <option value="all">{t("pathAll")}</option>
                  <option value="any">{t("pathAny")}</option>
                </select>
              </label>
              <fieldset>
                <legend>{t("pathRequired")}</legend>
                {steps.slice(0, draft.position - 1).map((step, index) => {
                  const position = index + 1;
                  const checked = draft.positions.includes(position);
                  return (
                    <label key={position} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!step.course_id && !checked}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            positions: checked
                              ? draft.positions.filter(
                                  (item) => item !== position,
                                )
                              : [...draft.positions, position],
                          })
                        }
                      />
                      {step.title}
                    </label>
                  );
                })}
              </fieldset>
              <Button type="submit" disabled={Boolean(stale)}>
                {t("pathSave")}
              </Button>
            </>
          )}
        </fieldset>
      </form>
      {save.isSuccess && <Notice kind="success">{t("pathSaved")}</Notice>}
      {(save.isError || stale) && (
        <Notice kind="error">{t("pathError")}</Notice>
      )}
    </section>
  );
}
