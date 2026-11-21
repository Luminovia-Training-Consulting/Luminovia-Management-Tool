import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isDocumentedRequest, portalOpenApi } from "./contract";

const backend = "https://portal.example.invalid";
const paths = portalOpenApi(backend, false).paths as Record<
  string,
  { post: { requestBody: { content: Record<string, { schema: unknown }> } } }
>;
const requestSchema = (path: string) =>
  paths[path].post.requestBody.content["application/json"].schema as {
    required: string[];
    properties: { kind: { enum: string[] } };
    oneOf: {
      properties: {
        p_action: { const: string };
        p_payload: { required: string[] };
      };
    }[];
  };
const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("documented Premium course and spending operations", () => {
  it.each([
    [
      "set_course_exam_required",
      "20261121021231_company_premium_course_exams.sql",
    ],
    [
      "share_course_exam_pdf",
      "20261121021231_company_premium_course_exams.sql",
    ],
    [
      "remove_course_exam_pdf",
      "20261121021231_company_premium_course_exams.sql",
    ],
    [
      "course_chat_rooms",
      "20261121022414_premium_course_chat_participant_access.sql",
    ],
    [
      "course_chat_messages",
      "20261121022414_premium_course_chat_participant_access.sql",
    ],
    [
      "send_course_chat_message",
      "20261121022414_premium_course_chat_participant_access.sql",
    ],
    [
      "course_workspace_action",
      "20261120110000_company_premium_entitlement.sql",
    ],
    [
      "company_monthly_accepted_spending",
      "20261121022959_company_monthly_accepted_spending.sql",
    ],
  ])("exposes only an existing public RPC: %s", (name, migration) => {
    expect(source(`supabase/migrations/${migration}`)).toMatch(
      new RegExp(
        `(?:create|replace) (?:or replace )?function public\\.${name}\\(`,
      ),
    );
    expect(paths[`/rest/v1/rpc/${name}`]?.post).toBeDefined();
    expect(
      isDocumentedRequest(`${backend}/rest/v1/rpc/${name}`, "POST", backend),
    ).toBe(true);
  });

  it("matches the course chat DTO and keeps operational chat out of the explorer", () => {
    expect(requestSchema("/rest/v1/rpc/course_chat_messages").required).toEqual(
      ["p_room_id", "p_before_at", "p_before_id", "p_limit"],
    );
    expect(paths["/rest/v1/rpc/course_chat_messages"].post).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                items: { properties: { deleted_at: { format: "date-time" } } },
              },
            },
          },
        },
      },
    });
    expect(paths).not.toHaveProperty("/rest/v1/rpc/chat_messages");
    expect(paths).not.toHaveProperty("/rest/v1/rpc/send_message");
  });

  it("lists only the implemented resource and attendance action payloads", () => {
    const actions = requestSchema("/rest/v1/rpc/course_workspace_action").oneOf;
    expect(
      actions.map(
        (schema: { properties: { p_action: { const: string } } }) =>
          schema.properties.p_action.const,
      ),
    ).toEqual([
      "resource_share",
      "resource_remove",
      "resource_acknowledge",
      "attendance_report",
      "attendance_verify",
    ]);
    expect(actions[0].properties.p_payload.required).toEqual([
      "version_id",
      "audience",
      "category",
    ]);
    expect(actions[4].properties.p_payload.required).toEqual([
      "session_id",
      "user_id",
      "state",
      "minutes",
      "reason",
    ]);
  });

  it("describes the actual protected gateways and company spending DTO", () => {
    const documentHandler = source(
      "supabase/functions/course-documents/handler.ts",
    );
    expect(documentHandler).toContain(
      '["resource", "exam", "completion", "attendance"]',
    );
    expect(source("supabase/functions/files/index.ts")).toContain(
      "request.headers.get('content-type')?.startsWith('multipart/form-data')",
    );
    expect(
      requestSchema("/functions/v1/course-documents").properties.kind.enum,
    ).toEqual(["resource", "exam", "completion", "attendance"]);
    expect(paths["/functions/v1/files"].post).toMatchObject({
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: { required: ["file", "scope", "kind", "client_id"] },
          },
        },
      },
    });
    expect(
      paths["/rest/v1/rpc/company_monthly_accepted_spending"].post,
    ).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                items: {
                  required: [
                    "organisation_id",
                    "organisation_name",
                    "time_zone",
                    "currency",
                    "month_start",
                    "gross_amount",
                    "claim_count",
                  ],
                },
              },
            },
          },
        },
      },
    });
  });

  it("never offers internal or service-key operations to the session explorer", () => {
    for (const path of [
      "/rest/v1/rpc/course_document_access",
      "/rest/v1/rpc/course_resource_command",
      "/rest/v1/rpc/deletion_upload_begin",
      "/functions/v1/company-integration",
    ]) {
      expect(paths).not.toHaveProperty(path);
      expect(isDocumentedRequest(backend + path, "POST", backend)).toBe(false);
    }
  });
});
