import { z } from "zod";
import {
  academySupportReply,
  academySupportRequest,
} from "../accounts/academy-support-schema.ts";

const json = (schema: z.ZodType) => ({
  "application/json": { schema: z.toJSONSchema(schema) },
});

export const academySupportPaths = {
  "/rest/v1/rpc/academy_support_access": {
    post: {
      operationId: "academySupportAccess",
      tags: ["Local academy administration"],
      summary: "Grant, inspect or revoke temporary Academy support access",
      description:
        "A current local administrator names a confirmed role-free support account, purpose, diagnostic scope and duration (15–1440 minutes). Use a fresh UUID for a new grant, or repeat the same decision with the original UUID. Only the named account reads the consenting installation or course diagnostics while both its grant and the licence are active. List and audit views apply access checks on every request. Diagnostics exclude learning content, private documents, learner data and secrets.",
      security: [{ apiKey: [], bearerAuth: [] }],
      requestBody: { required: true, content: json(academySupportRequest) },
      responses: {
        "200": {
          description:
            "A scoped list, a decision receipt, audit events or diagnostic data.",
          content: json(academySupportReply),
        },
        "400": { description: "Invalid support account, scope or arguments." },
        "401": { description: "Authentication required." },
        "403": {
          description:
            "The caller, grant or licence cannot authorize the operation.",
        },
        "409": {
          description: "The grant ID is already bound to another decision.",
        },
      },
    },
  },
};
