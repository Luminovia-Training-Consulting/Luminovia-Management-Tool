/** Operation contracts for staff discussions, topic consent, reviews and knowledge attachments. */

const uuid = { type: "string", format: "uuid" };
const boolean = { type: "boolean" };
const version = { type: "integer", minimum: 1 };
const instant = { type: "string", format: "date-time" };
const commentBody = {
  type: "string",
  minLength: 1,
  maxLength: 5000,
  description:
    "Plain text. It must contain text after trimming and may not contain unsupported control characters.",
};
const moderationReason = {
  type: "string",
  minLength: 1,
  description: "Required explanation, 1–1000 characters after trimming.",
};

/** Invitation projections contain exactly the fields selected by their RPC. */
function invitationList(properties: Record<string, unknown>) {
  return {
    type: "array",
    items: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

export const knowledgeOperationDocumentation = {
  add_resource_comment: {
    summary: "Post in an authorised job or course-template discussion",
    description:
      "Requires current teaching or appropriate job or course management authority and access to the exact, unarchived resource. The actor comes from the session. An exact retry with the same request ID returns the existing comment ID while its original version remains current. A changed resource, changed text or later version invalidates the retry.",
    parameters: {
      p_kind: { type: "string", enum: ["job", "template"] },
      p_id: {
        ...uuid,
        description: "Job or course-template ID from the current resource.",
      },
      p_body: commentBody,
      p_request_id: {
        ...uuid,
        description:
          "Actor-scoped ID reused only for the exact original request.",
      },
    },
    result: uuid,
    errors: {
      "400":
        "Invalid content or request ID, or the original request no longer matches (22023).",
      "403":
        "The caller cannot post in the discussion for the supplied resource.",
      "500":
        "Comment rate limit reached (54000). The caller may post ten new comments per minute and one hundred per day.",
    },
  },
  create_invitation_only_topic: {
    summary: "Create a topic group with pending staff invitations",
    description:
      "An active staff account creates and owns the topic and becomes its first member. The selected people must be eligible active staff. Group creation and the pending invitations commit together. Recipients gain membership only when they accept. Repeating creation can create another group.",
    parameters: {
      p_title: {
        type: "string",
        minLength: 1,
        description: "Topic title, 1–160 characters after trimming.",
      },
      p_invitee_ids: {
        type: "array",
        items: uuid,
        uniqueItems: true,
        maxItems: 60,
        description:
          "Distinct staff account IDs excluding the caller. An empty array creates an owner-only group.",
      },
    },
    result: uuid,
    errors: {
      "400":
        "Invalid title or invitee list, including duplicates or the caller's own ID (22023).",
      "403": "The caller or an invitee lacks current staff eligibility.",
    },
  },
  delete_course_review: {
    summary: "Withdraw the caller's own course review",
    description:
      "Requires the original review author and a current qualifying company contact or completed learner relationship for the same active Premium course. Supply the current version. The write clears the comment, withdraws the review and retains the audit event.",
    parameters: { p_review_id: uuid, p_version: version },
    errors: {
      "403":
        "The review is unavailable, already withdrawn or outside the caller's current course scope.",
      "409":
        "The review version changed (PT409). Refresh the caller's review before retrying.",
    },
  },
  edit_resource_comment: {
    summary: "Revise the caller's own comment",
    description:
      "Requires the original author and current write access to the unarchived job or course-template discussion. Supply the latest comment version. An identical edit at that version returns success without a new revision. Changing the text keeps existing moderation and records a revision and audit event.",
    parameters: { p_comment_id: uuid, p_body: commentBody, p_version: version },
    errors: {
      "400": "Invalid comment content (22023).",
      "403":
        "The comment is unavailable or the caller cannot edit it in the current discussion.",
      "500":
        "The comment version changed or the comment was withdrawn (40001). Reload before editing.",
    },
  },
  invite_topic_member: {
    summary: "Invite a staff colleague to an owned topic group",
    description:
      "Only the current owner with access to the topic can invite another eligible active staff account. The invitee must not already be a current member. An identical pending invitation by the same owner returns its existing ID. A new invitation after a rejection or revocation gets a fresh ID. Membership begins after acceptance.",
    parameters: { p_room_id: uuid, p_invitee_id: uuid },
    result: uuid,
    errors: {
      "400": "Self-invitation, missing invitee or existing membership (22023).",
      "403": "The topic or invitee is unavailable to the current owner.",
      "500":
        "The owner already has sixty other pending invitations for the topic (54000).",
    },
  },
  manage_wiki_attachment: {
    summary: "Attach or unlink an exact document version in a wiki draft",
    description:
      "Requires current Knowledge staff access and ownership of the unarchived page or wiki.manage. Use the latest editable draft revision. Adding requires the caller's own clean personal material with a verified hash and the exact document version. Dedicated course documents are excluded. Each draft can contain up to twenty attachments. Repeating an eligible link or unlink at the same revision is safe. The command changes only the selected draft's links.",
    parameters: {
      p_page_id: uuid,
      p_revision: {
        ...version,
        description: "Current unpublished draft revision.",
      },
      p_version_id: {
        ...uuid,
        description:
          "ID of the exact clean document version referenced by the attachment.",
      },
      p_remove: boolean,
    },
    errors: {
      "403":
        "The caller lacks edit authority or the exact material version is ineligible.",
      "500":
        "The revision is stale or already published (40001), or the draft attachment limit was reached (54000).",
    },
  },
  moderate_course_review: {
    summary: "Hide or restore an eligible course review",
    description:
      "Requires reviews.manage. The review must exist, remain unwithdrawn and belong to a course with current Premium access. Give the desired visibility and a reason. Moderation updates the version and records an audit event, even when the submitted visibility matches the current state.",
    parameters: {
      p_review_id: uuid,
      p_hidden: boolean,
      p_reason: moderationReason,
    },
    errors: {
      "400":
        "The reason or visibility is invalid, or the review is missing or already withdrawn (22023).",
      "403":
        "The caller lacks review management authority or current Premium access is unavailable.",
    },
  },
  moderate_resource_comment: {
    summary: "Hide or restore an authorised discussion comment",
    description:
      "Requires read access to the resource and jobs.manage for job discussions or courses.manage for course-template discussions. Give the current comment version, desired visibility and a reason. A changed decision or reason creates a revision and an audit event. An identical decision and reason at the current version is a no-op.",
    parameters: {
      p_comment_id: uuid,
      p_hidden: boolean,
      p_reason: moderationReason,
      p_version: version,
    },
    errors: {
      "400": "The desired visibility or reason is missing or invalid (22023).",
      "403":
        "The comment or its discussion is outside the caller's moderation scope.",
      "500":
        "The comment version changed or the comment was withdrawn (40001). Reload before moderating.",
    },
  },
  respond_topic_invitation: {
    summary: "Accept or reject the caller's topic invitation",
    description:
      "Only the originally invited active staff account can respond. The inviter must still be the eligible owner and an active member of the topic. Accepting creates or restores the membership. Rejecting grants no membership. Both decisions return the topic room ID. Repeating the same decision is valid while the original conditions still hold, including membership after acceptance.",
    parameters: { p_id: uuid, p_accept: boolean },
    result: uuid,
    errors: {
      "400": "An explicit true or false decision is required (22023).",
      "403":
        "The invitation is unavailable to the caller, revoked or no longer actionable for the requested decision.",
    },
  },
  revoke_topic_invitation: {
    summary: "Revoke a pending topic invitation",
    description:
      "Requires ownership of and current access to the exact topic. Revocation cancels a pending invitation without changing existing memberships. Repeating a revocation of the same already-revoked invitation is safe. Accepted or rejected invitations cannot be revoked.",
    parameters: { p_id: uuid },
    errors: {
      "403": "The invitation or its topic is unavailable to the caller.",
      "500":
        "The invitation has already been accepted or rejected, or changed during the request (40001).",
    },
  },
  set_taxonomy_topic_archived: {
    summary: "Archive or restore a taxonomy entry at its current version",
    description:
      "Requires taxonomy.manage. Archive active child entries before archiving their parent. Restoring an entry requires any parent to be active. Historical references remain available. An archive-state change advances the version and is audited. The same state at the current version is a no-op.",
    parameters: { p_id: uuid, p_archived: boolean, p_version: version },
    errors: {
      "400":
        "Missing requested state (22023) or incompatible parent or child archive state (23514).",
      "403": "The caller lacks taxonomy.manage.",
      "500":
        "The entry does not exist (P0002) or the submitted version is stale (40001).",
    },
  },
  set_topic_invitation_only: {
    summary: "Change a topic group's membership mode",
    description:
      "Only the current eligible owner with topic access can set the mode. Send the last-read mode and the desired mode. When enabled, new members must accept an invitation. Existing members are retained and may still be removed. The command returns the stored mode and records an audit event.",
    parameters: { p_room_id: uuid, p_expected: boolean, p_enabled: boolean },
    result: boolean,
    errors: {
      "400":
        "Both the last-read and desired modes must be explicit booleans (22023).",
      "403": "The room is unavailable or the caller is not its current owner.",
      "500":
        "The current mode differs from the supplied expected mode (40001). Reload the group settings.",
    },
  },
  submit_course_review: {
    summary: "Create or revise the caller's own completed-course review",
    description:
      "Requires a current company contact for the course or a confirmed learner with active company membership and a completed enrolment. The unarchived course must have Premium access, its last session must have ended and the teacher must have a current confirmed assignment. Self-reviews are rejected. Omit the version or send zero to create. Send the existing version to update or restore a withdrawn review. The response is the caller's review ID.",
    parameters: {
      p_course_run_id: uuid,
      p_lecturer_id: uuid,
      p_rating: { type: "integer", minimum: 1, maximum: 5 },
      p_comment: {
        type: "string",
        maxLength: 2000,
        description:
          "Review text. Empty text is allowed and surrounding whitespace is removed.",
      },
      p_version: { type: "integer", minimum: 0, default: 0 },
    },
    result: uuid,
    errors: {
      "400": "Invalid rating, comment or version, or a self-review (22023).",
      "403":
        "The course, lecturer or caller's current membership is ineligible for review.",
      "409":
        "The review version changed (PT409). Refresh the caller's review before retrying.",
    },
  },
  topic_invitation_inbox: {
    summary: "List the caller's pending topic invitations",
    description:
      "Lists pending invitations addressed to the current eligible staff caller. Each invitation still requires an eligible current owner who is a member of the topic. Results expose the invitation and topic IDs, topic title, inviter's display name and creation time. They are ordered newest first, then by invitation ID. A pending invitation alone grants no room access.",
    result: invitationList({
      id: uuid,
      room_id: uuid,
      title: { type: "string" },
      inviter_name: { type: "string" },
      created_at: instant,
    }),
  },
  topic_invitation_only: {
    summary: "Read an accessible topic group's membership mode",
    description:
      "Requires current access to the supplied topic room. Returns true if adding someone requires an accepted invitation, and false if the owner can add eligible staff directly.",
    parameters: { p_room_id: uuid },
    result: boolean,
    errors: { "403": "The room is inaccessible or is not a topic group." },
  },
  topic_invitation_sent: {
    summary: "List pending invitations sent by the current topic owner",
    description:
      "Requires ownership of and current access to the exact topic. Returns the caller's pending invitations whose invitees are still eligible active staff, newest first with an invitation-ID tie-break. Each row contains the invitation ID, invitee ID, display name and creation time.",
    parameters: { p_room_id: uuid },
    result: invitationList({
      id: uuid,
      invitee_id: uuid,
      invitee_name: { type: "string" },
      created_at: instant,
    }),
    errors: {
      "403":
        "The caller is not the current owner with access to the supplied topic.",
    },
  },
  verify_lecturer_topic: {
    summary:
      "Record a management attestation for an existing teaching qualification",
    description:
      "Requires qualifications.verify and an active eligible lecturer who already selected the topic. Set an explicit decision. Verification can have no expiry or a finite future expiry. Revocation clears the expiry. This compatibility operation records an audited management attestation. Use attest_qualification for version checks, request IDs or a certificate-backed decision.",
    parameters: {
      p_user_id: uuid,
      p_topic_id: uuid,
      p_verified: boolean,
      p_valid_until: {
        type: ["string", "null"],
        format: "date-time",
        default: null,
        description: "Omit or pass null for no expiry.",
      },
    },
    errors: {
      "400":
        "Invalid decision or expiry, ineligible lecturer, or the topic was not selected (22023).",
      "403":
        "The caller lacks qualifications.verify or current account access.",
      "500":
        "The caller exceeded thirty qualification events in a minute (54000).",
    },
  },
  withdraw_resource_comment: {
    summary: "Withdraw the caller's comment from an accessible discussion",
    description:
      "Only the original author with current read access to the job or course-template discussion can withdraw a comment, including on an archived resource that remains readable. Use the current comment version. Withdrawal clears the visible text and records the revision and audit event. An already-withdrawn comment at the current version is a no-op.",
    parameters: { p_comment_id: uuid, p_version: version },
    errors: {
      "403":
        "The comment is unavailable or the caller lacks authorship or current discussion access.",
      "500":
        "The submitted comment version is stale (40001). Refresh before retrying.",
    },
  },
};
