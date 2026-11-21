import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { downloadCsv } from "../../lib/csv";
import { courseParticipationReportSchema } from "./course-participation-report-schema";
import "./i18n";

export function CourseParticipationReport({ courseId }: { courseId: string }) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const exportReport = useMutation({
    mutationFn: async () => {
      const rows = [
        [
          t("reportName"),
          t("reportLearnerId"),
          t("reportEnrolment"),
          t("reportSessionCount"),
          t("reportPresent"),
          t("reportAbsent"),
          t("reportExcused"),
          t("reportCompletion"),
        ],
      ];
      let after: string | null = null;
      let sessionCount: number | undefined;
      do {
        const previous: string | null = after;
        const { data, error } = await db().rpc(
          "academy_course_participation_report",
          {
            p_run_id: courseId,
            p_after_user_id: previous,
            p_limit: 200,
          },
        );
        if (error) throw error;
        const page = courseParticipationReportSchema.parse(data);
        after = page.next_after;
        if (
          page.course_id !== courseId ||
          (sessionCount !== undefined && sessionCount !== page.session_count) ||
          (after &&
            (after !== page.rows.at(-1)?.user_id ||
              (previous !== null && after <= previous)))
        ) {
          throw new Error("Invalid course participation cursor.");
        }
        sessionCount = page.session_count;
        rows.push(
          ...page.rows.map((entry) => [
            entry.name,
            entry.participant_id,
            t(`reportEnrolment.${entry.enrolment}`),
            String(page.session_count),
            String(entry.present),
            String(entry.absent),
            String(entry.excused),
            t(`reportCompletion.${entry.completion}`),
          ]),
        );
      } while (after);
      return rows;
    },
  });

  return (
    <section
      className="panel learning-panel"
      aria-label={t("participationReport")}
    >
      <h2>{t("participationReport")}</h2>
      <Button
        variant="secondary"
        disabled={!online || exportReport.isPending}
        onClick={() =>
          exportReport.mutate(undefined, {
            onSuccess: (rows) =>
              downloadCsv(`course-participation-${courseId}.csv`, rows),
          })
        }
      >
        {exportReport.isPending
          ? t("exportingParticipation")
          : t("exportParticipation")}
      </Button>
      {exportReport.isError && (
        <Notice kind="error">{t("participationExportFailed")}</Notice>
      )}
    </section>
  );
}
