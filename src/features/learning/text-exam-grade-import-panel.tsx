/** Bind the shared import review dialog to the native text exam's submitted attempts. */
import { db } from "../../lib/supabase";
import { textExamCommand, type TextExamState } from "./course-text-exam-schema";
import { GradeImportDialog } from "./grade-import-dialog";
import {
  readTextExamGradeImport,
  textExamGradeHeaders,
  textExamGradeTemplateRows,
} from "./text-exam-grade-import";

type Props = {
  course: string;
  version: number;
  offset: number;
  maxima: number[];
  submissions: TextExamState["submissions"];
  disabled: boolean;
  refresh: () => Promise<unknown>;
};

function pointSummary(points: number[], maxima: number[]) {
  return points
    .map((points, index) => `${points}/${maxima[index]}`)
    .join(" · ");
}

export function TextExamGradeImport({
  course,
  version,
  offset,
  maxima,
  submissions,
  disabled,
  refresh,
}: Props) {
  const roster = submissions.flatMap(({ learner_id, name, import_draft }) =>
    import_draft ? [{ learner_id, name, draft: import_draft }] : [],
  );
  const draftRevisions = new Map(
    roster.map(({ learner_id, draft }) => [learner_id, draft.revision]),
  );
  return (
    <GradeImportDialog
      version={version}
      rosterSize={roster.length}
      disabled={disabled}
      mode="points"
      filePrefix={`text-exam-grades-${course}-part${1 + offset / 25}`}
      headers={textExamGradeHeaders(maxima.length)}
      templateRows={() =>
        textExamGradeTemplateRows(course, version, maxima.length, roster)
      }
      read={async (file) =>
        (
          await readTextExamGradeImport(file, course, version, maxima, roster)
        ).map(({ candidate, request }) => ({
          id: candidate.learner_id,
          name: candidate.name,
          before:
            candidate.draft.points === null
              ? null
              : pointSummary(candidate.draft.points, maxima),
          after: pointSummary(request.points, maxima),
          request,
        }))
      }
      isCurrent={({ id, request }) =>
        draftRevisions.get(id) === request.expected_revision
      }
      commit={async (rows) => {
        const { data, error } = await db().rpc(
          "course_text_exam_action",
          textExamCommand.parse({
            p_run_id: course,
            p_revision: version,
            p_expected: 0,
            p_action: "import_reviews",
            p_payload: { rows: rows.map(({ request }) => request) },
          }),
        );
        if (error) throw error;
        if (typeof data !== "number")
          throw new Error("Invalid text exam import count");
        return data;
      }}
      refresh={refresh}
    />
  );
}
