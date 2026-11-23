/** Business rules for the replayed commercial RPCs in the internal API. */
import nativeRpc from "../../../data/native-rpc.generated.json" with { type: "json" };

const text = { type: "string" };
const uuid = { ...text, format: "uuid" };
const currency = { type: "string", enum: ["EUR", "AUD"] };
const reviewReason = ["cancelled", "partial_delivery", "schedule_mismatch"];
const reviewState = {
  type: ["string", "null"],
  enum: ["pending", "resolved", null],
};
const reviewNote = {
  ...text,
  description: "An audit note of 10 to 1,000 characters after trimming.",
  examples: ["Reviewed the assignment and recorded the agreed resolution."],
};
const grossAmount = {
  type: "number",
  minimum: 0.01,
  maximum: 9999999999.99,
  multipleOf: 0.01,
};

/** Extend only the result fields with business rules beyond the SQL signature. */
function describeRows<Rows extends { items: { properties: object } }>(
  schema: Rows,
  fields: Record<string, object>,
) {
  return {
    ...schema,
    items: {
      ...schema.items,
      properties: { ...schema.items.properties, ...fields },
    },
  };
}

/** These entries retain the generated request defaults and per-session REST grants. */
export const commercialOperationDocumentation = {
  acknowledge_contract: {
    summary: "Acknowledge receipt of an exact contract version",
    description:
      "Requires an active account and the recipient of the PDF-backed contract record. Send its stored SHA-256 and a stable client request ID. The result is the receipt ID for this account and contract version. Receipt records are idempotent and record delivery acknowledgement only. Contract effectiveness and signatures are determined separately.",
    parameters: {
      p_contract_id: uuid,
      p_sha256: {
        ...text,
        pattern: "^[a-f0-9]{64}$",
        description: "Exact SHA-256 of the registered contract PDF version.",
      },
      p_client_id: uuid,
    },
    result: uuid,
    errors: {
      "400":
        "The recorded client request ID was reused for different receipt data (SQLSTATE 22023).",
      "403":
        "The contract version or hash is unavailable to the current recipient. An active account and a non-null request ID are required (SQLSTATE 42501).",
    },
  },
  client_organisations: {
    summary: "List current organisations available for client work",
    description:
      "A caller with finance.gross.read can list every nonarchived organisation. A current client can list only nonarchived organisations with a live membership for that account. Other operational callers receive an empty list. Rows contain only the ID and name and are sorted by name, then ID.",
    result: describeRows(nativeRpc.client_organisations.overloads[0].response, {
      id: uuid,
      name: text,
    }),
  },
  commercial_people: {
    summary: "List people available to contract and finance workflows",
    description:
      "An active account can see its own ID and display name. Current contracts.manage, contracts.read or finance.manage grants also include active holders of the lecturer, senior lecturer, administrator or owner role. This selector returns only IDs and display names, sorted by display name and ID. The consuming contract or invoice operation independently authorizes each selected account.",
    result: describeRows(nativeRpc.commercial_people.overloads[0].response, {
      id: uuid,
      display_name: text,
    }),
  },
  commission_report: {
    summary: "Read gross, platform and lecturer amounts for priced jobs",
    description:
      "Requires finance.gross.read. Omit the organisation ID or pass null for all records in the report. Accepted rows use the confirmed claim's stored amounts and applicable accepted assignment amendments. Unallocated offers can have null claim, lecturer and acceptance fields. Legacy net-only rows carry null gross and platform values. Amounts retain their original currencies.",
    parameters: {
      p_organisation_id: {
        default: null,
        description:
          "Filter to one organisation. Omit or send null for all report rows.",
      },
    },
    result: describeRows(nativeRpc.commission_report.overloads[0].response, {
      currency,
      pricing_model: { type: "string", enum: ["commission", "legacy_net"] },
    }),
    errors: {
      "403": "Current gross finance permission is required (SQLSTATE 42501).",
    },
  },
  contract_registration_candidates: {
    summary: "List clean contract PDF versions for one account",
    description:
      "Requires contracts.manage. Lists current clean personal contract PDFs owned by the supplied account with a recorded hash. The documents must be live and outside a deletion fence. The result contains version IDs and original file names, newest documents first. Registering a contract separately validates the account and chosen version.",
    parameters: {
      p_user_id: {
        ...uuid,
        description: "Account that owns the contract PDF.",
      },
    },
    result: describeRows(
      nativeRpc.contract_registration_candidates.overloads[0].response,
      {
        version_id: uuid,
        file_name: text,
      },
    ),
    errors: {
      "403":
        "Current contract management permission is required (SQLSTATE 42501).",
    },
  },
  decide_company_lecturer: {
    summary: "Accept or reject a company's lecturer allocation",
    description:
      "Requires a current client membership for the job's single owning organisation. An acceptance records the company's decision for a confirmed allocation. Rejecting a future unbilled allocation releases it transactionally. If invoice items already exist, rejection instead opens a finance review and keeps the allocation. A 204 may therefore indicate either a recorded decision or a pending review. Reload company_lecturer_decisions to see the outcome. Repeating the recorded decision returns success.",
    parameters: {
      p_claim_id: uuid,
      p_decision: { type: "string", enum: ["accepted", "rejected"] },
    },
    errors: {
      "400":
        "The allocation is inactive, eligible work has started, or finance review blocks the acceptance (SQLSTATE 22023).",
      "403":
        "A current client membership for the owning organisation and a permitted decision are required (SQLSTATE 42501).",
    },
  },
  finance_earnings: {
    summary:
      "Read own teaching earnings or the finance-wide earnings projection",
    description:
      "A current lecturer can read their own rows. With finance.manage, p_all=true includes every lecturer. The default reads the caller's own rows. Confirmed and cancelled allocations carry original-currency compensation, current billing stage, optional invoice and review details. The total incorporates applicable accepted amendments and reviewed exception or closing series amounts. Incomplete blocks indicate review and can lack a billable end date. The invoice and review operations validate current eligibility separately.",
    parameters: {
      p_all: {
        default: false,
        description:
          "True requires finance.manage. False, null or omission limits the result to the current account.",
      },
    },
    result: describeRows(nativeRpc.finance_earnings.overloads[0].response, {
      currency,
      stage: {
        type: "string",
        enum: ["expected", "completed", "invoiced", "paid", "review"],
      },
      invoice_review_required: { type: "boolean" },
      invoice_review_reason: {
        type: ["string", "null"],
        enum: [...reviewReason, null],
      },
      invoice_review_status: reviewState,
    }),
    errors: {
      "403":
        "A current teaching or finance role is required. All-account reads require finance.manage (SQLSTATE 42501).",
    },
  },
  invoice_review_cases: {
    summary: "List the current finance desk's invoice review cases",
    description:
      "Requires finance.manage. Includes pending requests and requests with an unrevoked exceptional approval while no active invoice item exists for the claim. Rows give the reason, lecturer, assignment, original accepted total and currency, and latest scheduled end if present. Rows are ordered by request time and ID. The projection contains only case metadata.",
    result: describeRows(nativeRpc.invoice_review_cases.overloads[0].response, {
      currency,
      reason: { type: "string", enum: reviewReason },
    }),
    errors: {
      "403":
        "Current finance management permission is required (SQLSTATE 42501).",
    },
  },
  my_invoice_review_candidates: {
    summary: "List own assignments that need a separate invoice review",
    description:
      "Requires a current lecturer or senior lecturer role. Returns the caller's confirmed or cancelled allocations that lack an active invoice item and have a cancellation, released session or schedule mismatch. Superseded sessions are excluded. Latest review state, request date, note and scheduled end are nullable. Rows are newest first. Use request_invoice_review to open a case.",
    result: describeRows(
      nativeRpc.my_invoice_review_candidates.overloads[0].response,
      {
        claim_status: { type: "string", enum: ["confirmed", "cancelled"] },
        reason: { type: "string", enum: reviewReason },
        review_status: reviewState,
      },
    ),
    errors: {
      "403": "The caller must have a current teaching role (SQLSTATE 42501).",
    },
  },
  register_executed_contract: {
    summary: "Register an already executed personal contract PDF",
    description:
      "Requires contracts.manage. Registers a new numbered contract version for an active eligible account using that account's clean personal contract PDF and its stored hash. A master is the default. An addendum requires a PDF-backed prior contract for the same account. Pass a business-required client request ID and reuse it with the same registration data to return the original contract ID. Registration records externally executed terms and notifies the recipient.",
    required: ["p_client_id"],
    parameters: {
      p_user_id: {
        ...uuid,
        description:
          "Active lecturer, senior lecturer, administrator or owner who owns the PDF.",
      },
      p_title: {
        ...text,
        description: "Between 1 and 200 characters after trimming.",
      },
      p_document_version_id: {
        ...uuid,
        description:
          "Version ID of the recipient's clean personal contract PDF.",
      },
      p_effective_from: { ...text, format: "date-time" },
      p_expires_at: {
        description:
          "Null or a timestamp strictly after the effective instant.",
      },
      p_kind: {
        type: "string",
        enum: ["master", "addendum"],
        default: "master",
      },
      p_parent_id: {
        description:
          "Required for an addendum. Omit or send null for a master.",
      },
      p_client_id: {
        ...uuid,
        description:
          "Stable non-null client request ID scoped to the registering account.",
      },
    },
    result: uuid,
    errors: {
      "400":
        "Invalid metadata, ineligible account, invalid parent or a changed retry using the same request ID (SQLSTATE 22023).",
      "403":
        "The caller lacks contract management authority or the recipient's exact clean PDF is unavailable (SQLSTATE 42501).",
    },
  },
  release_company_rejection: {
    summary: "Remove a company's block on a lecturer reclaiming the job",
    description:
      "Requires a current client membership for the job's single owning organisation. The referenced allocation must have a recorded company rejection. Clears unreleased rejections for the same lecturer and job so a new claim can go through the ordinary eligibility checks. The cancelled allocation and decision history are retained. Repeating the release succeeds without adding a second audit event.",
    parameters: { p_claim: uuid },
    errors: {
      "400":
        "The allocation has no recorded rejected decision (SQLSTATE 22023).",
      "403":
        "Current company authority for the allocation is required (SQLSTATE 42501).",
    },
  },
  resolve_company_invoice_rejection: {
    summary:
      "Complete finance review and release an invoiced company rejection",
    description:
      "Requires finance.manage, a pending company rejection and a confirmed allocation with future unreleased sessions. Every historical invoice must already be rejected or cancelled, its item inactive and any payment voided. An audited note accompanies the transactional allocation cancellation and final rejection. This workflow relies on the separately recorded invoice and payment decisions. A previously completed cancellation can be confirmed again without writing another resolution.",
    parameters: { p_claim: uuid, p_note: reviewNote },
    errors: {
      "400":
        "The review, audit note, future allocation or previous invoice and payment decisions do not satisfy the release conditions (SQLSTATE 22023).",
      "403":
        "Current finance management permission is required (SQLSTATE 42501).",
    },
  },
  resolve_invoice_review_request: {
    summary: "Close an invoice review request with an audit note",
    description:
      "Requires finance.manage. Locks and closes the request and records the reviewer and trimmed note. The case records a review decision. Invoice approval, payment and assignment transitions use separate operations. The original reviewer can retry with the same trimmed note. If a different note or reviewer reaches an already resolved request, reload the case before deciding how to proceed.",
    parameters: { p_request_id: uuid, p_note: reviewNote },
    errors: {
      "400":
        "The request or note is invalid, or the case no longer exists (SQLSTATE 22023).",
      "403":
        "Current finance management permission is required (SQLSTATE 42501).",
      "500":
        "An already resolved request conflicts with this reviewer or note (SQLSTATE 40001). Reload it before retrying.",
    },
  },
  review_invoice: {
    summary: "Approve, reject or cancel a submitted invoice record",
    description:
      "Requires finance.manage. Approval activates the invoice items. Rejection and cancellation deactivate them while retaining the submitted snapshot. A zero-balance series invoice becomes paid on approval. Active payment records prevent reclassification. A paid zero-balance series invoice can be rejected or cancelled if it has no active payment. Review records the reviewer, decision and note. Recording a payment uses the separate payment operation.",
    parameters: {
      p_invoice_id: uuid,
      p_status: { type: "string", enum: ["approved", "rejected", "cancelled"] },
      p_note: {
        ...text,
        maxLength: 2000,
        description: "Review note. An empty string is accepted.",
      },
    },
    errors: {
      "400":
        "The invoice, decision or note is invalid, funds were paid, or the invoice items cannot be activated for the current allocations (SQLSTATE 22023).",
      "403":
        "Current finance management permission is required (SQLSTATE 42501).",
      "409":
        "An active invoice item already covers the assignment, or the series or exception approval no longer authorizes activation.",
    },
  },
  set_contract_status: {
    summary: "Activate or expire a recorded contract version",
    description:
      "Requires contracts.manage. Expiring a version records a revocation instant. Activating clears that marker if the contractual expiry has not passed. An expired agreement whose recorded expiry is in the past needs a new executed version. Each update is audited. The stored contract PDF and receipt history are retained.",
    parameters: {
      p_contract_id: uuid,
      p_status: { type: "string", enum: ["active", "expired"] },
    },
    errors: {
      "400":
        "The contract or status is invalid, or the expiry prevents activation (SQLSTATE 22023).",
      "403":
        "Current contract management permission is required (SQLSTATE 42501).",
    },
  },
  set_invoice_labels: {
    summary: "Replace the organisational labels of an invoice",
    description:
      "Requires an active invoice owner or finance.manage. The server trims, deduplicates and sorts the supplied labels and audits an actual change. Pass an empty array to clear them. Repeating the same normalized labels succeeds without adding another audit event. Labels are kept separately from the invoice's financial and PDF snapshot.",
    parameters: {
      p_invoice_id: uuid,
      p_labels: {
        type: "array",
        maxItems: 10,
        items: {
          ...text,
          description:
            "Between 1 and 50 characters after trimming, without control characters.",
        },
        examples: [["Awaiting reconciliation", "Fictional workshop"]],
      },
    },
    errors: {
      "400":
        "The array or its labels violate the count, length or character rules (SQLSTATE 22023).",
      "403":
        "The invoice is unavailable to the current owner or finance manager (SQLSTATE 42501).",
    },
  },
  set_job_commission: {
    summary: "Set original-currency gross pricing on an unaccepted offer",
    description:
      "Requires finance.gross.read or Management authority for an own offer with an explicit platform share. The offer must be draft or published, belong to an organisation and have no assignment history. Gross amounts have two decimal places in the offer's currency. Equal unit and total amounts are required for a fixed total. An explicit platform share fixes the fee for every position. With no override, the server uses the applicable role or individual rates. A changed price advances the offer terms version.",
    parameters: {
      p_job_id: uuid,
      p_gross_amount: {
        ...grossAmount,
        description: "Gross amount for the existing rate unit.",
      },
      p_gross_total_amount: {
        ...grossAmount,
        description: "Gross amount for the entire offer.",
      },
      p_platform_percent: {
        type: ["number", "null"],
        minimum: 0,
        maximum: 100,
        multipleOf: 0.01,
        default: null,
        description:
          "Platform share from 0 to 100. Finance administrators can omit or use null to apply role or individual rates.",
      },
    },
    errors: {
      "400":
        "The amounts, applicability to the job or platform percentage are invalid (SQLSTATE 22023).",
      "403": "Current gross finance permission is required (SQLSTATE 42501).",
    },
  },
};
