/** Shared rubric editor for assignment definitions and team overrides. */
import "./course-assignments-i18n";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import type { AssignmentDefinition } from "./course-assignment-schema";

type Rubric = AssignmentDefinition["rubric"];

export const blankCriterion = () => ({
  label: "",
  levels: [
    { label: "", points: 0 },
    { label: "", points: 1 },
  ],
});

export function AssignmentRubricEditor({
  rubric,
  onChange,
}: {
  rubric: Rubric;
  onChange: (rubric: Rubric) => void;
}) {
  const { t } = useTranslation("learning");

  function updateCriterion(index: number, criterion: Rubric[number]) {
    onChange(
      rubric.map((item, position) => (position === index ? criterion : item)),
    );
  }

  return (
    <fieldset className="space-y-3">
      <legend>{t("assignmentsRubric")}</legend>
      {rubric.map((criterion, index) => (
        <fieldset className="space-y-2 border p-3" key={index}>
          <legend>{t("assignmentsCriterion", { index: index + 1 })}</legend>
          <label>
            {t("assignmentsCriterionName")}
            <input
              required
              maxLength={160}
              value={criterion.label}
              onChange={(event) =>
                updateCriterion(index, {
                  ...criterion,
                  label: event.currentTarget.value,
                })
              }
            />
          </label>
          {criterion.levels.map((level, levelIndex) => (
            <fieldset
              key={levelIndex}
              className="flex flex-wrap items-end gap-2"
            >
              <legend>
                {t("assignmentsLevel", { index: levelIndex + 1 })}
              </legend>
              <label>
                {t("assignmentsLevelName")}
                <input
                  required
                  maxLength={160}
                  value={level.label}
                  onChange={(event) => {
                    const label = event.currentTarget.value;
                    updateCriterion(index, {
                      ...criterion,
                      levels: criterion.levels.map((entry, n) =>
                        n === levelIndex ? { ...entry, label } : entry,
                      ),
                    });
                  }}
                />
              </label>
              <label>
                {t("assignmentsLevelPoints")}
                <input
                  required
                  type="number"
                  min={0}
                  max={1000}
                  value={Number.isNaN(level.points) ? "" : level.points}
                  onChange={(event) => {
                    const points = event.currentTarget.valueAsNumber;
                    updateCriterion(index, {
                      ...criterion,
                      levels: criterion.levels.map((entry, n) =>
                        n === levelIndex ? { ...entry, points } : entry,
                      ),
                    });
                  }}
                />
              </label>
              {criterion.levels.length > 2 && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    updateCriterion(index, {
                      ...criterion,
                      levels: criterion.levels.filter(
                        (_, n) => n !== levelIndex,
                      ),
                    })
                  }
                >
                  {t("assignmentsRemoveLevel")}
                </Button>
              )}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            {criterion.levels.length < 8 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  updateCriterion(index, {
                    ...criterion,
                    levels: [
                      ...criterion.levels,
                      {
                        label: "",
                        points: (criterion.levels.at(-1)?.points ?? 0) + 1,
                      },
                    ],
                  })
                }
              >
                {t("assignmentsAddLevel")}
              </Button>
            )}
            {rubric.length > 1 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onChange(rubric.filter((_, n) => n !== index))}
              >
                {t("assignmentsRemoveCriterion")}
              </Button>
            )}
          </div>
        </fieldset>
      ))}
      {rubric.length < 20 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...rubric, blankCriterion()])}
        >
          {t("assignmentsAddCriterion")}
        </Button>
      )}
    </fieldset>
  );
}
