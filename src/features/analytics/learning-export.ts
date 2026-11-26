/** Serialize only the currently authorized report page and preserve suppressed cells. */
import type { TFunction } from "i18next";
import {
  learningAssessmentFields,
  type LearningAnalyticsReport,
} from "./learning-schema";
import type { AnalyticsPeriod } from "./period";

const baseFields = [
  "enrolments",
  "completions",
  "certificates",
  "sessions",
  "minutes",
  "present",
  "absent",
  "excused",
] as const;

export function learningExportRows(
  report: LearningAnalyticsReport,
  period: AnalyticsPeriod,
  t: TFunction<"learningAnalytics">,
) {
  const assessmentByCourse = new Map(
    report.assessment?.courses.map((values) => [values.course_id, values]),
  );
  const assessmentColumns = report.assessment ? learningAssessmentFields : [];
  const headers = [
    t("course"),
    t("company"),
    t("status"),
    t("courseStart"),
    t("reportStart"),
    t("reportEnd"),
    t("reportZone"),
    ...baseFields.map((field) => t(field)),
    ...(report.assessment
      ? [t("metricVersion"), ...assessmentColumns.map((field) => t(field))]
      : []),
  ];
  const rows = report.courses.map((course) => {
    const assessment = assessmentByCourse.get(course.id);
    return [
      course.title,
      course.organisation,
      t(course.status),
      course.starts_at ?? null,
      period.from,
      period.through,
      report.time_zone,
      ...baseFields.map((field) => course[field]),
      ...(report.assessment
        ? [
            report.assessment.metric_version,
            ...assessmentColumns.map((field) => assessment?.[field] ?? null),
          ]
        : []),
    ];
  });
  return { headers, rows };
}
