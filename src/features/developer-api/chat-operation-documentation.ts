/** Business rules for internal chat RPCs. The native catalogue supplies SQL signatures and transport metadata. */
const uuid = { type: "string", format: "uuid" };
const currentRoom = {
  ...uuid,
  description: "Room ID from the caller's current chat list.",
};
const messageId = { ...uuid, description: "ID of the message in scope." };
const pinState = {
  type: "boolean",
  description: "True pins the item and false removes its pin.",
};
const messageParameters = {
  p_room_id: currentRoom,
  p_body: {
    type: "string",
    maxLength: 8000,
    description:
      "Literal message text. Text consisting only of spaces requires an attachment.",
    examples: ["The practice handout is ready."],
  },
  p_client_id: {
    ...uuid,
    description:
      "Caller-generated request ID. Reuse it only for the same message request.",
  },
  p_document_id: {
    default: null,
    description:
      "Optional document owned by the caller with a clean current version in this room.",
  },
  p_mention_ids: {
    type: "array",
    items: uuid,
    uniqueItems: true,
    maxItems: 20,
    default: [],
    description:
      "IDs of distinct eligible current members other than the sender.",
  },
};

const retentionHours = {
  type: "integer",
  enum: [0, 8, 168, 336],
};
const nullableRetentionHours = {
  anyOf: [retentionHours, { type: "null" }],
};
const retentionScope = {
  anyOf: [uuid, { type: "null" }],
  description:
    "Use null for the installation default or provide an accessible room ID.",
};
const retentionVersion = { type: "integer", minimum: 0 };
const retentionPolicy = {
  type: "object",
  properties: {
    hours: nullableRetentionHours,
    default_hours: retentionHours,
    version: retentionVersion,
    can_edit: { type: "boolean" },
  },
  required: ["hours", "default_hours", "version", "can_edit"],
  additionalProperties: false,
};

export const chatOperationDocumentation = {
  chat_retention_policy: {
    summary: "Read the chat retention policy",
    description:
      "Requires current room access or installation administration authority for the default. A null room duration inherits the default. Zero disables expiry.",
    parameters: { p_room_id: retentionScope },
    result: retentionPolicy,
    errors: { "403": "The caller lacks access to the requested scope." },
  },
  set_chat_retention_policy: {
    summary: "Set the retention policy for a chat or the installation",
    description:
      "Use the version from the most recent policy read. Policy changes apply to existing and new messages. The installation default requires administration authority. Room writes require current access and management authority.",
    parameters: {
      p_room_id: retentionScope,
      p_hours: {
        ...nullableRetentionHours,
        description:
          "Set zero to disable expiry. Null is only valid for a room and restores inheritance.",
      },
      p_expected_version: retentionVersion,
    },
    result: retentionPolicy,
    errors: {
      "400": "The retention duration or version is invalid.",
      "403": "The caller cannot change the policy in this scope.",
      "409": "Reload the policy because its version has changed.",
    },
  },
  chat_room_members: {
    summary: "List members of an accessible chat room",
    description:
      "Requires current room access. Returns membership rows that have not been removed, ordered by display name and account ID. Each row contains the member's account ID, display name and join time.",
    parameters: { p_room_id: currentRoom },
    result: {
      type: "array",
      items: {
        type: "object",
        properties: {
          user_id: uuid,
          display_name: { type: "string" },
          joined_at: { type: "string", format: "date-time" },
        },
        required: ["user_id", "display_name", "joined_at"],
        additionalProperties: false,
      },
    },
    errors: { "403": "The caller lacks current access to the room." },
  },
  clear_chat_manual_unread: {
    summary: "Clear the caller's manual unread flag",
    description:
      "Requires current room membership and access. Clears only the caller's manual flag if the flag predates or equals the start of this request. The read cursor and newer manual marks are preserved. Use this on a room that appeared empty to avoid acknowledging messages that arrived after the read.",
    parameters: { p_room_id: currentRoom },
    errors: { "403": "The caller lacks current access to the room." },
  },
  delete_message: {
    summary: "Remove message content for everyone in the room",
    description:
      "Requires current room access. The sender may remove their message. Outside direct messages, an accessible room's owner or a caller with chat.moderate may also remove a message. This clears the shared message body, attachment link and active reactions. The message ID and protected revision history are retained. A subsequent authorised call for the same removed message makes no further change.",
    parameters: { p_message_id: messageId },
    errors: {
      "403":
        "The message is unavailable or the caller lacks authority to remove it.",
    },
  },
  hide_chat_message: {
    summary: "Hide a chat message for the current account",
    description:
      "Requires current room membership and access. Hides the message from this account's message reads and search results across its sessions. The shared message and other members' views are preserved. Repeating the call leaves the existing personal hide in place.",
    parameters: { p_message_id: messageId },
    errors: { "403": "The message is unavailable to the caller." },
  },
  leave_topic_group: {
    summary: "Leave a topic chat group",
    description:
      "Requires an active account and current access to the topic group. Ends the caller's membership and records the departure. The group owner must first transfer ownership to an eligible member. This operation supports topic groups only.",
    parameters: { p_room_id: currentRoom },
    errors: {
      "400": "The owner must transfer the group before leaving (22023).",
      "403":
        "The group is unavailable, the caller already left or the room is not a topic group.",
    },
  },
  manage_chat_member: {
    summary: "Add, reactivate or remove a chat member",
    description:
      "Requires current room access and ownership, or courses.manage for a course room. Direct and general rooms are excluded. Topic and lecturer-course additions require an eligible active staff account. Invitation-only topic groups require the invitee's acceptance for additions. The owner remains a member, and participant-course removal is refused while a confirmed assignment or current enrolment still grants access. Successful changes are audited.",
    parameters: {
      p_room_id: currentRoom,
      p_user_id: { description: "Account ID of the member to add or remove." },
      p_remove: {
        type: "boolean",
        description:
          "True removes access. False adds or reactivates the member.",
      },
    },
    errors: {
      "400":
        "The membership decision or target is invalid, or an applicable assignment or enrolment blocks removal (22023).",
      "403":
        "Management is denied, or an invitation-only group requires invitation acceptance.",
    },
  },
  mark_chat_read: {
    summary: "Advance the caller's read cursor or change room mute",
    description:
      "Requires current room access. A message ID advances the caller's cursor up to that message without moving it backwards. With both optional inputs omitted or null, the server uses the latest message. A mute value with no message ID changes only mute. A read clears manual unread marks that existed when the request began. Use clear_chat_manual_unread when a known-empty read must leave the cursor untouched.",
    parameters: {
      p_room_id: currentRoom,
      p_message_id: {
        default: null,
        description: "Optional message ID in this room to acknowledge through.",
      },
      p_muted: {
        default: null,
        description:
          "Optional mute setting. Null preserves the current setting.",
      },
    },
    errors: {
      "400": "The provided message ID is not in the requested room (22023).",
      "403": "The caller lacks current access to the room.",
    },
  },
  mark_chat_unread: {
    summary: "Flag the room as unread for the current account",
    description:
      "Requires current room membership and access. Records a personal attention flag without changing the read cursor, actual unread message count or the other members' state.",
    parameters: { p_room_id: currentRoom },
    errors: { "403": "The caller lacks current access to the room." },
  },
  move_chat_pin: {
    summary: "Move a personal room pin by one position",
    description:
      "Pass the exact ordered list from chat_pinned_rooms. Moves the selected pinned room one step up or down if the order is still current and both affected rooms are accessible. Read the new order before attempting another move. Replaying an already applied move with the old order causes a stale-state error.",
    parameters: {
      p_room_id: currentRoom,
      p_direction: { type: "string", enum: ["up", "down"] },
      p_expected_order: {
        type: "array",
        items: uuid,
        description: "Complete caller-owned pin order from the latest read.",
      },
    },
    errors: {
      "400":
        "The move is invalid or the selected pin is already at that edge (22023).",
      "403": "The selected or adjacent pinned room is unavailable.",
      "500":
        "The reviewed order changed (40001). Reload the pins before attempting another move.",
    },
  },
  react_to_message: {
    summary: "Add or remove the caller's reaction to a message",
    description:
      "Requires a non-deleted message in a currently accessible room. Sets the caller's reaction for this emoji without changing anyone else's reactions. One record per message, actor and emoji prevents duplicate reactions on retry.",
    parameters: {
      p_message_id: messageId,
      p_emoji: { type: "string", enum: ["👍", "❤️", "🎉", "💡", "👀", "✅"] },
      p_remove: { type: "boolean", default: false },
    },
    errors: {
      "400": "The emoji or removal value is invalid (22023).",
      "403": "The message is deleted or unavailable to the caller.",
    },
  },
  resolve_participant_chat_origin: {
    summary: "Record why a course chat member has access",
    description:
      "Requires current access to a participant-course room and room ownership or courses.manage. The target must be a current room member. A true decision records independent membership. A false decision requires a confirmed assignment or an enrolled or completed enrolment and cannot be used for the owner. The decision resolves historical unknown provenance and records an audit event.",
    parameters: {
      p_room: currentRoom,
      p_user: {
        ...uuid,
        description: "Current member whose access origin is being reviewed.",
      },
      p_independent: { type: "boolean" },
    },
    errors: {
      "400":
        "The target or the explicit membership decision is invalid (22023).",
      "403": "The caller lacks participant-room management authority.",
    },
  },
  send_chat_reply: {
    summary: "Send a chat reply with optional mentions",
    description:
      "Requires current room membership. The parent must be a visible, non-deleted message in that room when the reply is created. The reply stores a message reference, so reading its preview uses current parent permissions without a copied quote. After current room and mention checks, an exact retry with the same request ID returns the original reply ID. Keep the same mention order on a retry.",
    parameters: {
      ...messageParameters,
      p_reply_to_id: {
        ...uuid,
        description: "Visible parent message in this room.",
      },
    },
    result: uuid,
    errors: {
      "400":
        "The message, mentions or request ID are invalid (22023), or the sender reached the 30-message-per-minute limit (P0001).",
      "403":
        "The room, parent, mention targets or attachment are unavailable to the caller.",
    },
  },
  send_message_with_mentions: {
    summary: "Send a chat message with optional mentions",
    description:
      "Requires current room membership and current eligibility for each mention. Returns the new message ID. Reusing the same request ID, room, body, attachment and set of mentions returns the original ID after current membership checks. Mention order is normalised. The new message and mention records commit together.",
    parameters: messageParameters,
    result: uuid,
    errors: {
      "400":
        "The message, mentions or request ID are invalid (22023), or the sender reached the 30-message-per-minute limit (P0001).",
      "403":
        "The room, mention targets or attachment are unavailable to the caller.",
    },
  },
  clear_personal_chat: {
    summary: "Delete a conversation from the caller's chat list",
    description:
      "Requires current room membership. Hides the existing messages for the caller and clears their pin, personal archive and manual unread state. The room reappears with a new visible message. Other members retain the shared messages and room access.",
    parameters: { p_room_id: currentRoom },
    errors: {
      "403": "The caller lacks current access to the room.",
    },
  },
  set_chat_personal_archive: {
    summary: "Archive or restore a room in the caller's chat list",
    description:
      "Requires an active account with current access to the direct message or topic group. Changes only the caller's list preference. Room membership, messages and other users' views are preserved. Sending the same value again keeps the preference set.",
    parameters: {
      p_room_id: currentRoom,
      p_archived: { type: "boolean" },
    },
    errors: {
      "400":
        "The archive value is invalid or the room type does not support personal archives (22023).",
      "403": "The caller lacks current access to the room.",
    },
  },
  set_chat_pin: {
    summary: "Pin or unpin a room in the caller's chat list",
    description:
      "Requires current room access. Changes only the caller's room pin. A newly pinned room is appended to the current pin order. Sending true for an existing pin preserves its position, and sending false removes it from the order.",
    parameters: { p_room_id: currentRoom, p_pinned: pinState },
    errors: {
      "400": "The pin state is invalid (22023).",
      "403": "The caller lacks current access to the room.",
    },
  },
  set_chat_topic_message_pin: {
    summary: "Pin or unpin a message for the whole topic group",
    description:
      "Requires current topic-group access and either group ownership or chat.moderate. The message must be non-deleted and visible to the caller. Up to 50 messages can be pinned in a group. Only an actual pin change updates the message generation and records an audit event.",
    parameters: { p_message_id: messageId, p_pinned: pinState },
    errors: {
      "400": "The pin state is invalid (22023).",
      "403": "The caller lacks authority or the topic message is unavailable.",
      "500":
        "The group already has 50 pinned messages (54000). Remove a pin before adding another.",
    },
  },
  transfer_topic_group_owner: {
    summary: "Transfer ownership of a topic group",
    description:
      "Requires current access and ownership of the topic group. The new owner must be a different, active staff member who already belongs to that group. The operation records an audit event. The previous owner keeps their membership and may leave separately.",
    parameters: {
      p_room_id: currentRoom,
      p_new_owner_id: {
        ...uuid,
        description: "Account ID of the eligible member taking ownership.",
      },
    },
    errors: {
      "400": "The target is the caller or an ineligible group member (22023).",
      "403":
        "The caller lacks current ownership or access, or the room is not a topic group.",
    },
  },
};
