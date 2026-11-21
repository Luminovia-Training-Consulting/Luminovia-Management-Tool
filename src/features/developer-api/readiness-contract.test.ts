import { describe, expect, it } from "vitest";
import { portalOpenApi } from "./contract";

const paths = portalOpenApi("https://portal.example.invalid", false).paths;
const operation = (name: string) => paths["/rest/v1/rpc/" + name].post;
const json = "application/json";
const writes = {
  save_readiness_settings: [
    "p_course_run_id",
    "p_payload",
    "p_expected_version",
    "p_request_id",
  ],
  confirm_course_sessions: [
    "p_course_run_id",
    "p_expected_version",
    "p_request_id",
  ],
  save_readiness_task: [
    "p_course_run_id",
    "p_task_id",
    "p_payload",
    "p_expected_version",
    "p_request_id",
  ],
  complete_readiness_task: [
    "p_task_id",
    "p_completed",
    "p_expected_version",
    "p_request_id",
  ],
  acknowledge_course_instructions: [
    "p_course_run_id",
    "p_instruction_version",
    "p_request_id",
  ],
};

describe("course readiness OpenAPI", () => {
  it("keeps the actor-scoped overview optional and describes its exact projected records", () => {
    expect(operation("course_readiness")).toMatchObject({
      "x-luminovia-rest-gate": {
        postgresRole: "authenticated",
        participantSession: false,
        guestSession: false,
      },
      requestBody: {
        required: false,
        content: {
          [json]: {
            schema: {
              required: [],
              additionalProperties: false,
              properties: {
                p_course_run_id: { type: ["string", "null"], format: "uuid" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          content: {
            [json]: {
              schema: {
                type: "array",
                maxItems: 250,
                items: {
                  additionalProperties: false,
                  properties: {
                    settings: { additionalProperties: false },
                    checks: { items: { additionalProperties: false } },
                    tasks: { items: { additionalProperties: false } },
                    documents: {
                      items: {
                        additionalProperties: false,
                        required: ["id", "name", "job_id"],
                      },
                    },
                    responsible_people: {
                      items: {
                        additionalProperties: false,
                        required: ["id", "display_name"],
                        properties: { acknowledged: { type: "boolean" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it.each(Object.entries(writes))(
    "documents a closed %s command and UUID receipt",
    (name, required) => {
      expect(operation(name)).toMatchObject({
        "x-luminovia-rest-gate": {
          postgresRole: "authenticated",
          participantSession: false,
          guestSession: false,
        },
        requestBody: {
          required: true,
          content: {
            [json]: { schema: { required, additionalProperties: false } },
          },
        },
        responses: {
          "200": {
            content: { [json]: { schema: { type: "string", format: "uuid" } } },
          },
          "403": {},
          "409": {},
        },
      });
    },
  );

  it("documents only editable settings and task data", () => {
    expect(operation("save_readiness_settings")).toMatchObject({
      requestBody: {
        content: {
          [json]: {
            schema: {
              properties: {
                p_payload: {
                  additionalProperties: false,
                  required: [
                    "materials_required",
                    "customer_required",
                    "contact_required",
                    "agreement_required",
                    "instructions_required",
                    "instructions",
                    "meeting_url",
                    "preparation_deadline",
                  ],
                  properties: {
                    instructions: { maxLength: 20000 },
                    meeting_url: { maxLength: 2000 },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(operation("save_readiness_task")).toMatchObject({
      requestBody: {
        content: {
          [json]: {
            schema: {
              properties: {
                p_task_id: { type: ["string", "null"], format: "uuid" },
                p_payload: {
                  additionalProperties: false,
                  required: [
                    "title",
                    "responsible_user_id",
                    "required",
                    "due_at",
                    "archived",
                  ],
                  properties: { title: { minLength: 1, maxLength: 500 } },
                },
              },
            },
          },
        },
      },
    });
  });
});
