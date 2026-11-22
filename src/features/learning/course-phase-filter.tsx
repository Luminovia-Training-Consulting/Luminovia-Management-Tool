import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import { coursePhases, type CoursePhaseSelection } from "./course-phase";
import "./i18n";

export function CoursePhaseFilter({
  id,
  value,
  onChange,
  requested = false,
}: {
  id: string;
  value: CoursePhaseSelection;
  onChange: (value: CoursePhaseSelection) => void;
  requested?: boolean;
}) {
  const { t } = useTranslation("learning");
  return (
    <Field
      id={id}
      label={t(requested ? "requestPhaseFilter" : "coursePhaseFilter")}
    >
      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value as CoursePhaseSelection)
        }
      >
        <option value="all">{t("phase.all")}</option>
        {coursePhases.map((phase) => (
          <option key={phase} value={phase}>
            {t(`phase.${phase}`)}
          </option>
        ))}
      </select>
    </Field>
  );
}
