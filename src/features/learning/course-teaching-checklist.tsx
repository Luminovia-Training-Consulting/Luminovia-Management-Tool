import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CourseWorkspace } from "./api";

export function CourseTeachingChecklist({
  course,
  classroom,
}: {
  course: CourseWorkspace;
  classroom: string | null;
}) {
  const { t } = useTranslation("learning");
  const steps = [
    { label: "teachingChecklistSchedule", ready: course.sessions.length > 0 },
    {
      label:
        course.delivery_type === "online"
          ? "teachingChecklistLink"
          : "teachingChecklistVenue",
      ready:
        course.delivery_type === "online"
          ? Boolean(classroom)
          : Boolean(course.venue.trim()),
    },
    {
      label: "teachingChecklistMaterials",
      ready: course.resources.some(
        (resource) => resource.category === "material",
      ),
      target: "#course-materials",
    },
    ...(course.preparation.length
      ? [
          {
            label: "teachingChecklistAgreements",
            ready: course.preparation.every(({ done }) => done),
            target: "#teaching-preparation",
          },
        ]
      : []),
  ];
  return (
    <section
      className="panel learning-panel"
      aria-label={t("teachingChecklist")}
    >
      <h2>{t("teachingChecklist")}</h2>
      <p>
        {t("preparationCount", {
          done: steps.filter(({ ready }) => ready).length,
          total: steps.length,
        })}
      </p>
      <ul className="teaching-checklist">
        {steps.map(({ label, ready, target }) => (
          <li key={label}>
            {target === "#teaching-preparation" ? (
              <a href={target}>{t(label)}</a>
            ) : target ? (
              <Link to={target}>{t(label)}</Link>
            ) : (
              <span>{t(label)}</span>
            )}
            <span
              className="badge"
              data-attendance-status={ready ? "present" : "unmarked"}
            >
              {t(ready ? "teachingChecklistReady" : "teachingChecklistReview")}
            </span>
          </li>
        ))}
      </ul>
      {course.sessions.length > 0 && (
        <Link to="#course-register">{t("workspaceRegister")}</Link>
      )}
    </section>
  );
}
