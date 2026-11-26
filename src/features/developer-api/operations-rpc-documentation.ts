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
  list_crm_opportunity_page: {
    summary: "Search and page through sales opportunities for one organisation",
    description:
      "Requires organisations.manage on every request; company membership alone is not sufficient. Applies the optional case-insensitive title search and stage filter before returning a bounded page ordered by most recently updated and then UUID. Archived organisations remain readable, but their opportunities are read-only. Each request is limited to 51 rows and offsets are bounded; estimates retain their recorded currency and are not converted or invoiced.",
    parameters: {
      p_organisation_id: id,
      p_search: {
        type: ["string", "null"],
        maxLength: 200,
        default: null,
        description:
          "Optional case-insensitive title substring; surrounding whitespace is ignored.",
      },
      p_stage: {
        type: ["string", "null"],
        enum: [
          "identified",
          "outreach_qualified",
          "contacted",
          "response_received",
          "qualified_opportunity",
          "meeting_scheduled",
          "negotiation",
          "proposal_submitted",
          "contract_pending",
          "contract_signed",
          "active_customer",
          "lost",
          "dormant",
          null,
        ],
        default: null,
      },
      p_limit: { type: "integer", minimum: 1, maximum: 51, default: 26 },
      p_offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
    },
    required: ["p_organisation_id"],
    result: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "organisation_id",
          "title",
          "stage",
          "estimated_value",
          "currency",
          "close_probability",
          "expected_close_date",
          "version",
          "created_at",
          "updated_at",
        ],
        properties: {
          id,
          organisation_id: id,
          title: { type: "string" },
          stage: {
            type: "string",
            enum: [
              "identified",
              "outreach_qualified",
              "contacted",
              "response_received",
              "qualified_opportunity",
              "meeting_scheduled",
              "negotiation",
              "proposal_submitted",
              "contract_pending",
              "contract_signed",
              "active_customer",
              "lost",
              "dormant",
            ],
          },
          estimated_value: { type: ["number", "null"] },
          currency: {
            type: "string",
            enum: ["EUR", "AUD", "CHF", "GBP", "USD"],
          },
          close_probability: {
            type: ["number", "null"],
            minimum: 0,
            maximum: 100,
          },
          expected_close_date: { type: ["string", "null"], format: "date" },
          version: { type: "integer", minimum: 1 },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
    },
    errors: {
      "400": "SQLSTATE 22023 for invalid filters, page size, or offset.",
      "403":
        "The caller does not have current organisations.manage permission.",
      "404": "The specified organisation does not exist.",
    },
  },
  list_crm_opportunity_events: {
    summary: "List the stage history for one opportunity",
    description:
      "Requires organisations.manage on every request. The organisation ID must match the opportunity. Returns at most the latest 100 immutable events in ascending version order; archived organisations remain readable.",
    parameters: {
      p_organisation_id: id,
      p_opportunity_id: id,
      p_limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    },
    required: ["p_organisation_id", "p_opportunity_id"],
    result: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "opportunity_id",
          "organisation_id",
          "version",
          "event_type",
          "from_stage",
          "to_stage",
          "from_close_probability",
          "to_close_probability",
          "from_expected_close_date",
          "to_expected_close_date",
          "actor_id",
          "request_id",
          "occurred_at",
        ],
        properties: {
          id,
          opportunity_id: id,
          organisation_id: id,
          version: { type: "integer", minimum: 1 },
          event_type: {
            type: "string",
            enum: ["created", "stage_changed", "forecast_updated"],
          },
          from_stage: { type: ["string", "null"] },
          to_stage: { type: "string" },
          from_close_probability: {
            type: ["number", "null"],
            minimum: 0,
            maximum: 100,
          },
          to_close_probability: {
            type: ["number", "null"],
            minimum: 0,
            maximum: 100,
          },
          from_expected_close_date: {
            type: ["string", "null"],
            format: "date",
          },
          to_expected_close_date: { type: ["string", "null"], format: "date" },
          actor_id: id,
          request_id: id,
          occurred_at: { type: "string", format: "date-time" },
        },
      },
    },
    errors: {
      "403":
        "The caller does not have current organisations.manage permission.",
      "404": "The opportunity is unavailable under the specified organisation.",
    },
  },
  create_crm_opportunity: {
    summary: "Create an organisation sales opportunity",
    description:
      "Requires organisations.manage and an active organisation. New opportunities enter Identified. Keep p_request_id for an identical retry; reusing it with different input returns an error. Estimated values are not committed prices and are never converted automatically.",
    parameters: {
      p_organisation_id: id,
      p_title: { type: "string", minLength: 1, maxLength: 200 },
      p_estimated_value: { type: ["number", "null"], minimum: 0 },
      p_currency: { type: "string", enum: ["EUR", "AUD", "CHF", "GBP", "USD"] },
      p_request_id: requestId,
    },
    result: id,
    errors: {
      "400":
        "The input is invalid or the request ID was reused with different content.",
      "403":
        "The caller lacks organisations.manage permission or the organisation is archived.",
      "404": "The active organisation does not exist.",
    },
  },
  move_crm_opportunity: {
    summary: "Move an opportunity to another sales stage",
    description:
      "Requires organisations.manage and an active organisation. Submit the version returned by the latest list call; stale transitions fail without overwriting another change. An identical request ID safely retries the same transition. Stage history is immutable.",
    parameters: {
      p_organisation_id: id,
      p_opportunity_id: id,
      p_stage: {
        type: "string",
        enum: [
          "identified",
          "outreach_qualified",
          "contacted",
          "response_received",
          "qualified_opportunity",
          "meeting_scheduled",
          "negotiation",
          "proposal_submitted",
          "contract_pending",
          "contract_signed",
          "active_customer",
          "lost",
          "dormant",
        ],
      },
      p_expected_version: { type: "integer", minimum: 1 },
      p_request_id: requestId,
    },
    errors: {
      "400":
        "The stage is invalid or the request ID was reused with different input.",
      "403":
        "The caller lacks organisations.manage permission or the organisation is archived.",
      "404": "The opportunity is unavailable under the specified organisation.",
      "409":
        "The opportunity version changed; reload before retrying the stage change.",
    },
  },
  update_crm_opportunity_forecast: {
    summary:
      "Update the probability and expected close date for an opportunity",
    description:
      "Requires organisations.manage and an active organisation. Submit the version from the latest list call; stale edits fail without overwriting another update. Keep p_request_id for an identical retry. Probability is an optional 0–100 percent estimate with at most two decimal places; null means unknown, while zero is an explicit estimate. The expected date is optional and independently clearable. These fields are forecasts, not actual revenue, accepted prices, or currency-converted values. Every committed update creates an immutable history event.",
    parameters: {
      p_organisation_id: id,
      p_opportunity_id: id,
      p_close_probability: {
        type: ["number", "null"],
        minimum: 0,
        maximum: 100,
        multipleOf: 0.01,
        description:
          "Optional estimated close probability; null means unknown.",
      },
      p_expected_close_date: {
        type: ["string", "null"],
        format: "date",
        description: "Optional expected date; null clears the estimate.",
      },
      p_expected_version: { type: "integer", minimum: 1 },
      p_request_id: requestId,
    },
    errors: {
      "400":
        "The forecast is invalid, unchanged, or the request ID was reused with different input.",
      "403":
        "The caller lacks organisations.manage permission or the organisation is archived.",
      "404": "The opportunity is unavailable under the specified organisation.",
      "409":
        "The opportunity version changed; reload before retrying the forecast.",
    },
  },
  organisation_contracts: {
    summary: "List scanned private PDFs filed for one company",
    description:
      "Internal edition only. Active company members see scanned member uploads for their own current company only. Authorised staff with organisations.manage and contracts.manage also see staff-filed PDFs, including archived companies. Returns up to 30 contracts in descending creation-time and ID order. If has_more is true, send both cursor fields from the last item. Download through the private files gateway; no Storage URL is returned.",
    parameters: {
      p_organisation_id: id,
      p_before_at: { type: "string", format: "date-time" },
      p_before_id: id,
    },
    result: {
      type: "object",
      required: ["items", "has_more"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "file_name", "created_at"],
            properties: {
              id,
              file_name: { type: "string" },
              created_at: { type: "string", format: "date-time" },
            },
          },
        },
        has_more: { type: "boolean" },
      },
    },
    errors: {
      "400": "Both cursor parts must be supplied together.",
      "403":
        "The account or installation is not authorised to view company contracts.",
    },
  },
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
      "Requires users.roles.manage and current authority over the target and requested roles. An internal administrator or owner can change their own administrator, management, lecturer, participant and client roles and must retain any protected roles. The last active administrative account and active teaching assignments are protected. Use the atomic organisation variant to add the client role with its company. Returns the authoritative normalized role list.",
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
  set_account_roles_with_organisation: {
    summary: "Save account roles with a company",
    description:
      "Confirms the requested role set and company membership in one transaction. Include the client role and select an active organisation. Internal company management can link an organisation for a manageable subordinate account. Internal administrators and owners can update their own roles within the self-service boundary.",
    parameters: {
      p_user_id: id,
      p_roles: { type: "array", minItems: 1, maxItems: 8, items: accountRole },
      p_organisation_id: id,
    },
    errors: {
      "400":
        "Invalid role list or protected final administrative or teaching role.",
      "403":
        "The caller lacks authority for the target, requested roles or organisation.",
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
