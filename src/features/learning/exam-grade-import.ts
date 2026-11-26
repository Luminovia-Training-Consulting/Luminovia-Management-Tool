/** Prepare template-shaped timed-exam scores against a single authorised exam snapshot. */
import { AttendanceImportError, readSpreadsheetCsv } from "./attendance-import";
import type { ExamGradeImportRow, TimedExam } from "./timed-exam-schema";

export const examGradeImportHeaders = [
  "course_id",
  "exam_version",
  "participant_id",
  "name",
  "score",
];
export type ExamGradeCandidate = Pick<
  TimedExam["rows"][number],
  "name" | "participant_id" | "score"
>;
type PreviewRow = ExamGradeImportRow & { name: string };

/** Use literal transport cells and leave the score empty until the grader enters it. */
export function examGradeTemplateRows(
  run: string,
  version: number,
  rows: ExamGradeCandidate[],
) {
  return rows.map(({ participant_id, name }) => [
    run,
    version,
    participant_id,
    name,
    "",
  ]);
}

/** Accept only known identities and new integer scores. Authored names never resolve identity. */
export async function readExamGradeImport(
  file: File,
  run: string,
  version: number,
  roster: ExamGradeCandidate[],
): Promise<PreviewRow[]> {
  const records = await readGradeSpreadsheet(file, examGradeImportHeaders);
  const candidates = new Map(
    roster.map((candidate) => [candidate.participant_id, candidate]),
  );
  const seen = new Set<string>();
  const preview: PreviewRow[] = [];
  for (const { rowNumber, columns } of records) {
    const [course, examVersion, participant, , proposed] = columns;
    const candidate = candidates.get(participant);
    if (
      course !== run ||
      examVersion !== String(version) ||
      !candidate ||
      seen.has(participant)
    )
      throw new AttendanceImportError(rowNumber);
    seen.add(participant);
    if (!proposed) continue;
    if (!/^(100|[0-9]{1,2})$/.test(proposed))
      throw new AttendanceImportError(rowNumber);
    const score = Number(proposed);
    if (candidate.score !== score)
      preview.push({
        participant_id: participant,
        name: candidate.name,
        expected_score: candidate.score,
        score,
      });
  }
  return preview;
}

/** Select the bounded literal-cell reader for the file's format. */
export async function readGradeSpreadsheet(
  file: File,
  headers: readonly string[],
) {
  return file.name.toLowerCase().endsWith(".xlsx")
    ? (await import("./attendance-xlsx")).readSpreadsheetXlsx(file, headers)
    : readSpreadsheetCsv(file, headers);
}
