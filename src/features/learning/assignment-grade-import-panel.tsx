/** Bind the shared grade review dialog to the selected page of assignment attempts. */
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import {
  assignmentActionResult,
  assignmentReviewImport,
  type CourseAssignment,
} from "./course-assignment-schema";
import {
  assignmentGradeHeaders,
  assignmentGradeRows,
  readAssignmentGradeImport,
} from "./assignment-grade-import";
import { GradeImportDialog } from "./grade-import-dialog";

export function AssignmentGradeImport({
  course,
  assignment,
  page,
  refresh,
}: {
  course: string;
  assignment: CourseAssignment;
  page: number;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation("examGradeImport");
  const roster = assignment.attempts.flatMap((attempt) =>
    attempt.import_eligible &&
    attempt.rubric_version &&
    (!attempt.review || attempt.review.state === "draft")
      ? [{ attempt, version: attempt.rubric_version }]
      : [],
  );
  const width = Math.max(
    0,
    ...roster.map(({ attempt }) => attempt.rubric.length),
  );
  const current = new Map(
    roster.map(({ attempt, version }) => [
      attempt.id,
      {
        rubric: version,
        review: attempt.review?.version ?? 0,
      },
    ]),
  );
  return (
    <GradeImportDialog
      version={assignment.version}
      rosterSize={roster.length}
      disabled={false}
      mode="assignment"
      filePrefix={`assignment-grades-${assignment.assignment_id}-part${page}`}
      headers={assignmentGradeHeaders(width)}
      templateRows={() =>
        assignmentGradeRows(course, assignment.assignment_id, width, roster)
      }
      read={async (file) =>
        (
          await readAssignmentGradeImport(
            file,
            course,
            assignment.assignment_id,
            width,
            roster,
          )
        ).map(({ attempt, row }) => ({
          id: attempt.id,
          name: t("assignmentAttempt", {
            name: attempt.team_title ?? attempt.display_name,
            attempt: attempt.attempt_no,
            revision: row.rubric_version,
          }),
          before: attempt.review?.scores.join(" · ") ?? null,
          after: row.scores.join(" · "),
          row,
        }))
      }
      isCurrent={({ id, row }) => {
        const versions = current.get(id);
        return (
          versions?.rubric === row.rubric_version &&
          versions.review === row.review_version
        );
      }}
      commit={async (changes) => {
        const { data, error } = await db().rpc("course_assignment_action", {
          p_run_id: course,
          p_assignment_id: assignment.assignment_id,
          p_action: "import_reviews",
          p_payload: assignmentReviewImport.parse({
            rows: changes.map(({ row }) => row),
          }),
          p_expected_version: 0,
        });
        if (error) throw error;
        const result = assignmentActionResult.parse(data);
        if (
          result.id !== assignment.assignment_id ||
          result.imported === undefined
        )
          throw new Error("Invalid assignment import receipt");
        return result.imported;
      }}
      refresh={refresh}
    />
  );
}
