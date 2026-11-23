/** Native course authoring and course-backed administrative offer contracts. */
import { z } from "zod";
import {
  jsonContent as json,
  postgrestErrorResponse as error,
} from "./postgrest-content.ts";
import {
  courseRecordId,
  courseRunJobDefaultsSchema,
  courseTemplatePayloadSchema,
  createCourseRunJobRequestSchema,
  jobBuildingBlockReferenceSchema,
} from "../operations/course-building-block-schema.ts";

function operation(
  operationId: string,
  summary: string,
  description: string,
  request: z.ZodType,
  response: z.ZodType,
  invalid = "Invalid arguments or unavailable course source.",
) {
  return {
    post: {
      operationId,
      tags: ["Courses"],
      summary,
      description,
      requestBody: { required: true, content: json(request) },
      responses: {
        "200": {
          description: "The current scoped result.",
          content: json(response),
        },
        "400": error(invalid),
        "401": error("Authentication required."),
        "403": error("Current authority or resource access is required."),
        "404": error("The supplied named arguments do not match this RPC."),
      },
    },
  };
}

export const courseBuildingBlockPaths = {
  "/rest/v1/rpc/save_course_template": operation(
    "saveCourseTemplate",
    "Save an editable course template",
    "Course management can save templates. On the internal edition, active company members can create templates with their organisation as owner and edit their company's reusable templates. A company member cannot change ownership, edit a source-backed template, or edit a template used by a live course. Send a null template ID to create one. The supplied topics replace the current topics. A template backing a published or filled job is locked. Returns the saved template ID.",
    z.strictObject({
      p_id: courseRecordId.nullable(),
      p_payload: courseTemplatePayloadSchema,
    }),
    courseRecordId,
    "Invalid template data, an unknown template, or a locked template (course_locked).",
  ),
  "/rest/v1/rpc/course_run_job_defaults": operation(
    "readCourseRunJobDefaults",
    "Read the authoritative source for a course-backed offer",
    "Requires both course and job management. Returns a current non-archived run, its template, provenance, customer when linked and exact session references. The source_revision binds the reviewed data and instants independently of the SQL session time zone. Pricing is entered separately.",
    z.strictObject({ p_course_run_id: courseRecordId }),
    courseRunJobDefaultsSchema,
  ),
  "/rest/v1/rpc/create_course_run_job": operation(
    "createCourseRunJob",
    "Create one administrative offer from an existing course run",
    "Requires current course and job management, a linked current customer, and one to sixty future non-overlapping sessions. Supply the source_revision from the reviewed preview. The server copies the persisted template, customer, topics and exact session references. Set capacity to 1–20 lecturer positions on the same schedule. Fees are per position. Accounts with finance.gross.read supply gross values with an optional platform share. Authorised Management can supply gross values with an explicit platform share for its own offers. Other authorised accounts supply legacy net values. Fixed-total values must agree. A deadline requires an explicit offset and may be no later than the first session. Additional terms are optional. Use a new p_client_id for each separate offer on the same run. Reuse p_client_id for the same actor and unchanged request. Returns the job ID.",
    createCourseRunJobRequestSchema,
    courseRecordId,
    "Invalid financial terms, deadline, source or request identity. A stale preview returns course_run_source_changed.",
  ),
  "/rest/v1/rpc/job_building_block_reference": operation(
    "readJobBuildingBlockReference",
    "Read provenance for an accessible job",
    "Requires current job access. The response is the template, building-block and source IDs for a job with catalogue provenance, or null when the accessible job has no building-block source.",
    z.strictObject({ p_job_id: courseRecordId }),
    jobBuildingBlockReferenceSchema,
  ),
};
