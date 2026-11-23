/** Business rules that the replayed SQL signatures cannot express for internal portal operations. */
const id = { type: "string", format: "uuid" };
const accountRole = {
  type: "string",
  enum: [
    "owner",
    "admin",
    "management",
    "senior_lecturer",
    "lecturer",
    "client",
    "participant",
    "guest",
  ],
};
const requestId = {
  ...id,
  description: "Caller-generated UUID. Keep it for an identical retry.",
};
const withdrawalReason = {
  type: "string",
  description: "Between 5 and 1,000 characters after trimming.",
};

export const operationsRpcDocumentation = {
  acknowledge_announcement: {
    summary: "Acknowledge the currently published announcement revision",
    description:
      "The caller must be active and in the audience of the current, unarchived revision during its display window. Acknowledging records the caller's first acknowledgement time and marks the corresponding notification read. An unchanged retry while the revision is still visible returns the same timestamp.",
    parameters: { p_revision_id: id },
    result: { type: "string", format: "date-time" },
    errors: {
      "403":
        "The revision is outside the caller's current announcement audience or display window.",
    },
  },
  cancel_client_request: {
    summary: "Cancel an unpublished company course request",
    description:
      "Requires finance.gross.read or current contact access to the request's company. A submitted request with no linked job becomes cancelled. Repeating cancellation while still authorised has no further effect. After publication use the audited job workflow.",
    parameters: { p_request_id: id },
    errors: {
      "400":
        "SQLSTATE 22023 if the request was published or its status no longer permits cancellation.",
      "403": "The request is unavailable to this caller.",
    },
  },
  cancel_job_assignment: {
    summary: "Release a confirmed future teaching assignment",
    description:
      "Use the claim ID for the active assigned lecturer or a caller with jobs.manage. A lecturer's withdrawal inside seven days must use the reviewed withdrawal workflow. Started and invoice-backed assignments require separate review. Company rejection follows its own workflow. The release updates the calendar and course-chat access. Eligible future marketplace positions may reopen. Repeating the same request UUID and trimmed reason returns the original claim ID.",
    parameters: {
      p_claim_id: id,
      p_reason: withdrawalReason,
      p_request_id: requestId,
    },
    result: id,
    errors: {
      "400":
        "SQLSTATE 22023 for invalid or changed retry input, an unavailable claim state or an assignment that needs another workflow.",
      "403": "The assignment is outside the caller's current authority.",
    },
  },
  cancel_replacement: {
    summary: "Close an open marketplace replacement request",
    description:
      "The active original lecturer or a caller with jobs.manage can close the offer using its observed version. The confirmed assignment stays in place. An identical retry returns the offer ID without applying a second update.",
    parameters: {
      p_offer_id: id,
      p_expected_version: {
        type: "integer",
        description: "Version of the open offer from the latest read.",
      },
      p_request_id: requestId,
    },
    result: id,
    errors: {
      "400":
        "SQLSTATE 22023 for missing input or changed parameters under the same request ID.",
      "403": "The offer is outside the caller's current authority.",
      "500":
        "SQLSTATE 40001 if the offer changed or is no longer open. Reload it before deciding whether to retry.",
    },
  },
  company_jobs_for_deletion: {
    summary: "List company jobs for a permanent-deletion preview",
    description:
      "An active company contact sees at most 500 jobs whose current ownership links identify one company in their scope. Rows are ordered by creation time descending and job ID. The projection excludes prices and lecturer terms. can_delete reflects authority to request a preview. The separate preview determines whether dependencies block deletion.",
    errors: {
      "403": "The current session cannot use the internal company projection.",
    },
  },
  duplicate_course_template: {
    summary: "Copy a course template and its topic links",
    description:
      "Requires courses.manage. Supply a new title. The copy retains the description, syllabus, prerequisites, topic links and building-block source references. It receives a new UUID on every successful call. Course runs, sessions and enrolments are separate resources.",
    parameters: {
      p_id: id,
      p_title: {
        type: "string",
        description: "Between 1 and 200 characters after trimming.",
      },
    },
    result: id,
    errors: {
      "400":
        "SQLSTATE 22023 if the source template cannot be found or the title is invalid.",
      "403": "The caller lacks course-management authority.",
    },
  },
  get_my_permissions: {
    summary: "Read the current account's effective portal capabilities",
    description:
      "Returns the distinct effective permission names for the authenticated caller, or an empty array. The result describes the current account and is unordered. Secured operations still recheck current membership and the requested resource.",
    result: { type: "array", uniqueItems: true, items: { type: "string" } },
  },
  publish_client_request: {
    summary: "Publish a company request as a role-priced teaching offer",
    description:
      "Requires finance.gross.read. The request must belong to an active company and contain future sessions. The server creates the course and offer using configured compensation rates or an explicit platform share. Repeat the same publication options for the same job ID while the options and offer still match. Changing the publication terms requires the relevant job workflow.",
    parameters: {
      p_request_id: id,
      p_platform_percent: {
        type: ["number", "null"],
        minimum: 0,
        maximum: 100,
        multipleOf: 0.01,
        default: null,
        description:
          "Optional platform share. Null uses the applicable role or individual rates.",
      },
      p_terms: {
        type: "string",
        default: "Accepted lecturer assignment terms.",
        description: "Between 1 and 12,000 characters after trimming.",
      },
      p_requires_contract: { type: "boolean", default: true },
      p_claim_deadline: {
        default: null,
        description: "Optional future deadline with an explicit offset.",
      },
    },
    result: id,
    errors: {
      "400":
        "SQLSTATE 22023 for invalid publication details, an unavailable request or a conflicting retry.",
      "403": "The caller lacks gross-finance authority.",
    },
  },
  request_replacement: {
    summary: "Open a replacement offer for a complete confirmed assignment",
    description:
      "The active original lecturer or a caller with jobs.manage may open an offer for future, uninvoiced work. An original lecturer inside the seven-day window must use reviewed withdrawal. Use an empty invite list in open mode. Selected mode requires between 1 and 50 distinct eligible lecturers. The original assignment stays confirmed until the replacement transaction succeeds. An identical retry returns the original offer ID.",
    parameters: {
      p_claim_id: id,
      p_reason: withdrawalReason,
      p_mode: { type: "string", enum: ["open", "selected"] },
      p_invited_user_ids: {
        type: "array",
        items: id,
        maxItems: 50,
        uniqueItems: true,
      },
      p_emergency: { type: "boolean" },
      p_request_id: requestId,
    },
    result: id,
    errors: {
      "400":
        "SQLSTATE 22023 for invalid input, ineligible invitations, conflicting retries or an assignment that requires another workflow.",
      "403": "The assignment is outside the caller's current authority.",
    },
  },
  set_job_capacity: {
    summary: "Change the position count of a per-position offer",
    description:
      "Requires jobs.manage. Adjust positions on a per-position offer with no claim history. Supply the latest lifecycle version. The change keeps per-position pricing and is audited. Repeating the same request ID and parameters returns the job ID without another change.",
    parameters: {
      p_job_id: id,
      p_capacity: { type: "integer", minimum: 1, maximum: 20 },
      p_expected_version: { type: "integer" },
      p_request_id: requestId,
    },
    result: id,
    errors: {
      "400":
        "SQLSTATE 22023 for invalid capacity, a conflicting retry or a legacy or already claimed offer.",
      "403": "The active caller lacks job-management authority.",
      "500":
        "SQLSTATE 40001 if the lifecycle version changed. Reload current capacity before retrying.",
    },
  },
  set_account_roles: {
    summary: "Replace a managed account's roles",
    description:
      "Requires users.roles.manage and current authority over the target and requested roles. An internal administrator or owner can toggle their own regular lecturer role by sending the complete role list with all other roles unchanged. Active teaching assignments protect the last teaching role. Company memberships are managed separately. Returns the authoritative normalized role list.",
    parameters: {
      p_user_id: id,
      p_roles: { type: "array", minItems: 1, maxItems: 8, items: accountRole },
    },
    result: {
      type: "object",
      properties: {
        id,
        roles: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: accountRole,
        },
      },
      required: ["id", "roles"],
      additionalProperties: false,
    },
    errors: {
      "400":
        "Invalid role list, an active teaching assignment, or the last active administrator would lose their role.",
      "403":
        "The caller lacks role assignment authority or attempted an unsupported change to their own account.",
    },
  },
  set_user_active: {
    summary: "Suspend or reactivate a subordinate internal account",
    description:
      "Requires users.manage and users.roles.manage with strictly greater account authority than the target. Self-service activation changes and disabling the last active administrator are blocked. The target's roles and retained records are preserved. An unchanged state has no additional audit event.",
    parameters: { p_user_id: id, p_active: { type: "boolean" } },
    errors: {
      "400":
        "SQLSTATE 22023 if the decision is invalid or would disable the last active administrator.",
      "403":
        "The target is outside the caller's current account-management authority.",
    },
  },
};
