/** Validate real migrated SQL payloads against the same OpenAPI JSON written by the build. */
import assert from "node:assert/strict";
import { z } from "zod";
import { portalOpenApi } from "../../src/features/developer-api/contract.ts";

const paths = portalOpenApi("https://portal.example.invalid").paths;

/** Compile the appropriate schema and require both presence and a successful payload match. */
export function assertLmsResponse(name, response) {
  const schema =
    paths[`/rest/v1/rpc/${name}`]?.post?.responses?.["200"]?.content?.[
      "application/json"
    ]?.schema;
  assert.ok(schema, `Missing reviewed response schema for ${name}`);
  const result = z.fromJSONSchema(schema).safeParse(response);
  assert.ok(result.success, `${name} response: ${result.error?.message}`);
}
