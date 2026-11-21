import { z } from "zod";
import { academyLicenceReceiptSchema } from "../accounts/academy-licence-schema.ts";

const json = (schema: z.ZodType) => ({
  "application/json": { schema: z.toJSONSchema(schema) },
});
const errorContent = json(
  z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z.string().nullable(),
    hint: z.string().nullable(),
  }),
);

export const academyLicencePaths = {
  "/rest/v1/rpc/academy_licence_receipt": {
    post: {
      operationId: "readAcademyLicenceReceipt",
      tags: ["Local academy administration"],
      summary: "Read the current academy licence and quotas",
      description:
        "Requires a confirmed current local academy administrator and the enabled release with an active licence or grace period. Seat use includes active role-holding accounts and pending seat reservations. Storage use includes retained and pending document versions. Available capacity is zero when recorded use reaches or exceeds the signed limit. The API limit reports the licensed requests per minute.",
      security: [{ apiKey: [], bearerAuth: [] }],
      "x-portal-licence": "active-or-grace",
      requestBody: { required: false, content: json(z.strictObject({})) },
      responses: {
        "200": {
          description:
            "Current verified licence dates, limits and measured local seat and storage use.",
          content: json(academyLicenceReceiptSchema),
        },
        "401": {
          description: "Authentication required.",
          content: errorContent,
        },
        "403": {
          description:
            "The current account or academy release cannot access this receipt.",
          content: errorContent,
        },
      },
    },
  },
};
