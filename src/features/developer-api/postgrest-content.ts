/** Shared OpenAPI content for PostgREST JSON and its structured error envelope. */
import { z } from "zod";

const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
});

/** Describe an application/json body using the supplied wire schema. */
export function jsonContent(schema: z.ZodType) {
  return { "application/json": { schema: z.toJSONSchema(schema) } };
}

/** Describe PostgREST errors, optionally narrowing the code for a specific status. */
export function postgrestErrorResponse(description: string, code?: z.ZodType) {
  return {
    description,
    content: jsonContent(code ? errorSchema.extend({ code }) : errorSchema),
  };
}
