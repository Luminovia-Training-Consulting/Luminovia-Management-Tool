/** Read current programme grades on demand; staff can export a freshly authorised report. */
import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { downloadCsv } from "../../lib/csv";
import { requireOnline, useOnline } from "../../lib/online";
import { learningProgramGradeReportQuery } from "./learning-program-api";

type Learner = { id: string; name: string };
type ProgrammeScope = { actor: string; program: string };

/** Mount only when the disclosure opens and never show cached grade data offline. */
export function ProgrammeGradeReport({
  actor,
  program,
  learners,
}: ProgrammeScope & { learners?: Learner[] }) {
  const { t } = useTranslation("learningPrograms");
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const title = t(learners ? "programmeGradeStaff" : "programmeGradeSelf");
  return (
    <details
      className="panel programme-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      {open &&
        (online ? (
          learners ? (
            <StaffGradeSelection
              actor={actor}
              program={program}
              learners={learners}
            />
          ) : (
            <ReleasedGrades actor={actor} program={program} />
          )
        ) : (
          <p role="status">{t("programmeGradeOffline")}</p>
        ))}
    </details>
  );
}

/** Reuse the programme roster search and mount a fresh query for the selected learner. */
function StaffGradeSelection({
  actor,
  program,
  learners,
}: ProgrammeScope & { learners: Learner[] }) {
  const { t } = useTranslation("learningPrograms");
  const id = useId();
  const [selected, select] = useState("");
  const learner = learners.find(({ id }) => id === selected);
  return learners.length ? (
    <>
      <Field id={id} label={t("programmeGradeLearner")}>
        <select
          id={id}
          value={learner?.id ?? ""}
          onChange={(event) => select(event.currentTarget.value)}
        >
          <option value="">{t("selectParticipant")}</option>
          {learners.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      {learner && (
        <ReleasedGrades
          key={learner.id}
          actor={actor}
          program={program}
          learner={learner}
        />
      )}
    </>
  ) : (
    <p>{t("rosterEmpty")}</p>
  );
}

/** This projection only contains official per-course release data. */
function ReleasedGrades({
  actor,
  program,
  learner,
}: ProgrammeScope & { learner?: Learner }) {
  const { t, i18n } = useTranslation("learningPrograms");
  const report = useQuery(
    learningProgramGradeReportQuery(actor, program, learner?.id),
  );
  const csv = useMutation({
    mutationFn: async () => {
      requireOnline();
      // Access may have changed since the report was opened. Never export cached rows.
      const { data } = await report.refetch({ throwOnError: true });
      return data?.grades ?? [];
    },
  });
  if (report.isError) return <ErrorState retry={() => void report.refetch()} />;
  if (!report.isFetchedAfterMount || !report.data) return <Loading />;
  const { grade_count, mean_percent, grades } = report.data;
  if (!grades.length) return <p>{t("programmeGradeEmpty")}</p>;

  const locale = i18n.resolvedLanguage;
  const percentage = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const outcome = (passed: boolean) =>
    t(passed ? "programmeGradePass" : "programmeGradeFail");
  return (
    <div className="space-y-3">
      <p role="status">
        {t("programmeGradeCount", { count: grade_count })}
        {mean_percent !== null && (
          <>
            {" "}
            ·{" "}
            {t("programmeGradeMean", {
              score: percentage.format(mean_percent / 100),
            })}
          </>
        )}
      </p>
      <ul className="programme-roster" aria-label={t("programmeGradeCourses")}>
        {grades.map((grade) => (
          <li className="programme-step" key={grade.course_id}>
            <Link
              to={`/courses/${grade.course_id}/workspace#course-weighted-gradebook`}
            >
              {grade.title}
            </Link>
            <span>
              {percentage.format(grade.percent / 100)} · {outcome(grade.passed)}
            </span>
            <span>
              {t("programmeGradeRelease", {
                revision: grade.revision,
                date: date.format(new Date(grade.released_at)),
              })}
            </span>
          </li>
        ))}
      </ul>
      {learner && (
        <Button
          type="button"
          variant="secondary"
          disabled={csv.isPending}
          onClick={() =>
            csv.mutate(undefined, {
              onSuccess: (rows) => {
                if (!rows.length) return;
                downloadCsv(`programme-grades-${program}.csv`, [
                  [
                    t("programmeGradeLearner"),
                    t("course"),
                    t("programmeGradePercent"),
                    t("programmeGradeOutcome"),
                    t("programmeGradeReleasedAt"),
                    t("programmeGradeRevision"),
                    t("programmeGradePolicy"),
                  ],
                  ...rows.map((grade) => [
                    learner.name,
                    grade.title,
                    grade.percent,
                    outcome(grade.passed),
                    grade.released_at,
                    grade.revision,
                    grade.policy_version,
                  ]),
                ]);
              },
            })
          }
        >
          {t(
            csv.isPending ? "programmeGradeExporting" : "programmeGradeExport",
          )}
        </Button>
      )}
      {csv.isError && (
        <Notice kind="error">{t("programmeGradeExportError")}</Notice>
      )}
    </div>
  );
}
