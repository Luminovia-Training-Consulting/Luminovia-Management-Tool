/** Validate current assignment attempts against the rubric revision each submission pinned. */
import { AttendanceImportError } from "./attendance-import";
import type { CourseAssignmentAttempt } from "./course-assignment-schema";
import { readGradeSpreadsheet } from "./exam-grade-import";

export type AssignmentImportCandidate = {
  attempt: CourseAssignmentAttempt;
  version: number;
};

export function assignmentGradeHeaders(criteria: number) {
  return [
    "course_id",
    "assignment_id",
    "attempt_id",
    "name",
    "rubric_version",
    "review_version",
    ...Array.from({ length: criteria }, (_, index) => `criterion_${index + 1}`),
  ];
}

export function assignmentGradeRows(
  course: string,
  assignment: string,
  width: number,
  candidates: AssignmentImportCandidate[],
) {
  return candidates.map(({ attempt, version }) => [
    course,
    assignment,
    attempt.id,
    attempt.team_title ?? attempt.display_name,
    version,
    attempt.review?.version ?? 0,
    ...Array.from({ length: width }, () => ""),
  ]);
}

export async function readAssignmentGradeImport(
  file: File,
  course: string,
  assignment: string,
  width: number,
  candidates: AssignmentImportCandidate[],
) {
  const records = await readGradeSpreadsheet(
    file,
    assignmentGradeHeaders(width),
  );
  const roster = new Map(candidates.map((entry) => [entry.attempt.id, entry]));
  const seen = new Set<string>();
  const reviews = [];
  for (const { rowNumber, columns } of records) {
    const [
      courseId,
      assignmentId,
      id,
      ,
      rubricVersion,
      reviewVersion,
      ...cells
    ] = columns;
    const candidate = roster.get(id);
    if (
      courseId !== course ||
      assignmentId !== assignment ||
      !candidate ||
      seen.has(id)
    )
      throw new AttendanceImportError(rowNumber);
    seen.add(id);
    if (!cells.some(Boolean)) continue;
    const { attempt, version } = candidate;
    const current = attempt.review?.version ?? 0;
    const grades = cells.slice(0, attempt.rubric.length);
    if (
      rubricVersion !== String(version) ||
      reviewVersion !== String(current) ||
      cells.slice(attempt.rubric.length).some(Boolean) ||
      grades.some(
        (cell, index) =>
          !/^(0|[1-9][0-9]{0,2}|1000)$/.test(cell) ||
          !attempt.rubric[index].levels.some(
            ({ points }) => points === Number(cell),
          ),
      )
    )
      throw new AttendanceImportError(rowNumber);
    const scores = grades.map(Number);
    if (attempt.review?.scores.every((score, index) => scores[index] === score))
      continue;
    reviews.push({
      attempt,
      row: {
        attempt_id: id,
        rubric_version: version,
        review_version: current,
        scores,
      },
    });
  }
  return reviews;
}
