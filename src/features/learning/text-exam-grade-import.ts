/** Bind point changes to an eligible submission on one published exam revision. */
import { AttendanceImportError } from "./attendance-import";
import { readGradeSpreadsheet } from "./exam-grade-import";
import type { TextExamImportRow } from "./course-text-exam-schema";

export type TextExamGradeCandidate = {
  learner_id: string;
  name: string | null;
  draft: { revision: number; points: number[] | null };
};

export function textExamGradeHeaders(questionCount: number) {
  return [
    "course_id",
    "text_exam_revision",
    "learner_id",
    "name",
    "draft_revision",
    ...Array.from(
      { length: questionCount },
      (_, index) => `points_${index + 1}`,
    ),
  ];
}

export function textExamGradeTemplateRows(
  course: string,
  revision: number,
  questionCount: number,
  candidates: TextExamGradeCandidate[],
) {
  return candidates.map(({ learner_id, name, draft }) => [
    course,
    revision,
    learner_id,
    name,
    draft.revision,
    ...Array.from({ length: questionCount }, () => ""),
  ]);
}

/** Preserve skipped learners and reject partial marks, duplicates and stale workbook rows. */
export async function readTextExamGradeImport(
  file: File,
  course: string,
  revision: number,
  maxima: number[],
  candidates: TextExamGradeCandidate[],
) {
  const source = await readGradeSpreadsheet(
    file,
    textExamGradeHeaders(maxima.length),
  );
  const roster = new Map(
    candidates.map((person) => [person.learner_id, person]),
  );
  const seen = new Set<string>();
  const changes: Array<{
    candidate: TextExamGradeCandidate;
    request: TextExamImportRow;
  }> = [];
  for (const { rowNumber, columns } of source) {
    const [runId, examRevision, learnerId, , draftRevision, ...cells] = columns;
    const candidate = roster.get(learnerId);
    if (
      !candidate ||
      runId !== course ||
      examRevision !== String(revision) ||
      seen.has(learnerId)
    )
      throw new AttendanceImportError(rowNumber);
    seen.add(learnerId);
    if (!cells.some(Boolean)) continue;
    if (
      draftRevision !== String(candidate.draft.revision) ||
      cells.some(
        (cell, index) =>
          !/^(0|[1-9][0-9]{0,2})$/.test(cell) || Number(cell) > maxima[index],
      )
    )
      throw new AttendanceImportError(rowNumber);
    const points = cells.map(Number);
    if (candidate.draft.points?.every((mark, index) => mark === points[index]))
      continue;
    changes.push({
      candidate,
      request: {
        learner_id: learnerId,
        expected_revision: candidate.draft.revision,
        points,
      },
    });
  }
  return changes;
}
