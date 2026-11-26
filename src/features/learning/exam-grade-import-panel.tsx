/** Bind the spreadsheet review dialog to the scheduled PDF exam gradebook. */
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import {
  examGradeImportHeaders,
  examGradeTemplateRows,
  readExamGradeImport,
  type ExamGradeCandidate,
} from "./exam-grade-import";
import { GradeImportDialog } from "./grade-import-dialog";
import { timedExamKey } from "./timed-exam-api";
import {
  examGradeImportCount,
  examGradeImportRequest,
} from "./timed-exam-schema";

export function ExamGradeImportPanel({
  actor,
  run,
  version,
  roster,
  disabled,
}: {
  actor: string;
  run: string;
  version: number;
  roster: ExamGradeCandidate[];
  disabled: boolean;
}) {
  const { t } = useTranslation("examGradeImport");
  const cache = useQueryClient();
  const currentRoster = new Map(
    roster.map((row) => [row.participant_id, row.score]),
  );
  const scoreLabel = (score: number) => t("score", { score });
  return (
    <GradeImportDialog
      version={version}
      rosterSize={roster.length}
      disabled={disabled}
      mode="percentage"
      filePrefix={`exam-grades-${run}`}
      headers={examGradeImportHeaders}
      templateRows={(start, end) =>
        examGradeTemplateRows(run, version, roster.slice(start, end))
      }
      read={async (file) =>
        (await readExamGradeImport(file, run, version, roster)).map(
          ({ participant_id, name, expected_score, score }) => ({
            id: participant_id,
            name,
            before: expected_score === null ? null : scoreLabel(expected_score),
            after: scoreLabel(score),
            expected_score,
            score,
          }),
        )
      }
      isCurrent={(row) => currentRoster.get(row.id) === row.expected_score}
      commit={async (rows) => {
        const { data, error } = await db().rpc(
          "import_course_exam_grades",
          examGradeImportRequest.parse({
            p_run_id: run,
            p_version: version,
            p_rows: rows.map(({ id, expected_score, score }) => ({
              participant_id: id,
              expected_score,
              score,
            })),
          }),
        );
        if (error) throw error;
        return examGradeImportCount.parse(data);
      }}
      refresh={() =>
        cache.invalidateQueries({ queryKey: timedExamKey(actor, run) })
      }
    />
  );
}
