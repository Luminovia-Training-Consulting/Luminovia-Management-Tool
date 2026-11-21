import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isDocumentedRequest, portalOpenApi } from "./contract";

const backend = "https://portal.example.invalid";
const paths = portalOpenApi(backend, false).paths as Record<
  string,
  {
    post: {
      requestBody: { content: Record<string, { schema: unknown }> };
      responses: Record<string, unknown>;
    };
  }
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

describe("shared amendments and internal exceptional invoices", () => {
  it("documents the consent group on assignment changes and flags eligible candidates", () => {
    for (const [rpc, expected] of [
      [
        "assignment_changes",
        {
          shared_schedule_only: { type: "boolean" },
          shared_schedule: {
            anyOf: expect.arrayContaining([
              expect.objectContaining({
                properties: {
                  required: { type: "integer", minimum: 2, maximum: 20 },
                  accepted: { type: "integer", minimum: 0, maximum: 20 },
                  state: {
                    type: "string",
                    enum: ["awaiting_consent", "ready", "blocked", "applied"],
                  },
                },
              }),
            ]),
          },
        },
      ],
      ["changeable_assignments", { shared_schedule_only: { type: "boolean" } }],
    ]) {
      expect(paths["/rest/v1/rpc/" + rpc].post.responses["200"]).toMatchObject({
        content: {
          "application/json": { schema: { items: { properties: expected } } },
        },
      });
    }
  });

  it("exposes an internal approval and a separate submission bound to a clean invoice file", () => {
    const approval = "/rest/v1/rpc/approve_invoice_exception";
    const submission = "/rest/v1/rpc/submit_exception_invoice";
    expect(requestSchema(approval)).toMatchObject({
      additionalProperties: false,
      required: [
        "p_request_id",
        "p_contract_id",
        "p_amount",
        "p_due_on",
        "p_note",
      ],
      properties: {
        p_due_on: { format: "date" },
        p_amount: { minimum: 0.01, multipleOf: 0.01 },
      },
    });
    expect(requestSchema(submission)).toMatchObject({
      additionalProperties: false,
      required: [
        "p_exception_id",
        "p_number",
        "p_document_version_id",
        "p_issued_on",
        "p_client_id",
      ],
    });
    expect(
      paths["/rest/v1/rpc/revoke_invoice_exception"].post.responses,
    ).toHaveProperty("204");
    expect(
      paths["/rest/v1/rpc/my_invoice_exceptions"].post.responses["200"],
    ).toMatchObject({
      content: {
        "application/json": {
          schema: {
            items: {
              additionalProperties: false,
              properties: {
                due_on: { format: "date" },
                currency: { enum: ["EUR", "AUD"] },
              },
            },
          },
        },
      },
    });
  });
});

describe("installation and integration credential contracts", () => {
  it("describes the public internal bootstrap without a bearer token", () => {
    const bootstrap = portalOpenApi(backend, false).paths[
      "/rest/v1/rpc/installation_capabilities"
    ];
    for (const method of ["get", "post"]) {
      expect(bootstrap[method]).toMatchObject({
        security: [{ publicApiKey: [] }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  additionalProperties: false,
                  properties: {
                    edition: { const: "internal" },
                    licence_status: { const: "not-required" },
                  },
                },
              },
            },
          },
        },
      });
    }
  });

  it("resolves the security scheme on every published operation", () => {
    const catalogue = portalOpenApi(backend);
    const schemes = catalogue.components.securitySchemes;
    for (const [path, methods] of Object.entries(catalogue.paths)) {
      for (const method of Object.values(methods)) {
        const { security = [] } = method as {
          security?: Record<string, string[]>[];
        };
        for (const entry of security) {
          for (const name of Object.keys(entry)) {
            expect(schemes, path).toHaveProperty(name);
          }
        }
      }
    }
  });

  it("describes both internal mail transports while keeping secret-bearing operations download-only", () => {
    const read = "/rest/v1/rpc/get_mail_configuration";
    const save = "/rest/v1/rpc/save_mail_configuration";
    const test = "/functions/v1/mail-admin";
    const { paths: download } = portalOpenApi(backend);
    expect(paths[read].post.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: {
            additionalProperties: false,
            properties: {
              smtp: { additionalProperties: false },
              imap: { additionalProperties: false },
            },
          },
        },
      },
    });
    expect(download[save].post).toHaveProperty(
      "requestBody.content.application/json.schema.properties.p_imap.anyOf",
    );
    expect(download[test].post).toHaveProperty(
      "requestBody.content.application/json.schema.properties.protocol.enum",
      ["smtp", "imap"],
    );
    expect(paths[save]).toBeUndefined();
    expect(paths[test]).toBeUndefined();
  });

  it("keeps one-time credentials in the download and exposes a closed list projection", () => {
    const prefix = "/rest/v1/rpc/";
    const issue = prefix + "issue_company_integration_key";
    const list = prefix + "company_integration_keys";
    const revoke = prefix + "revoke_company_integration_key";
    const download = portalOpenApi(backend, true).paths;
    expect(paths).not.toHaveProperty(issue);
    expect(download[issue].post).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                required: ["id", "version", "credential"],
                properties: { credential: { format: "password" } },
              },
            },
          },
        },
        "409": { description: expect.stringContaining("Read the list again") },
      },
    });
    expect(paths[list].post.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: {
            maxItems: 100,
            items: {
              additionalProperties: false,
              required: [
                "id",
                "label",
                "created_at",
                "expires_at",
                "revoked_at",
                "version",
                "last_used_at",
              ],
            },
          },
        },
      },
    });
    expect(paths[revoke].post.responses).toMatchObject({
      "204": { description: expect.any(String) },
      "409": { description: expect.stringContaining("Read the list again") },
    });
  });
});

describe("internal publication and discussion contracts", () => {
  it("enforces the complete draft and versioned publication command shapes", () => {
    const command = z.fromJSONSchema(
      requestSchema(
        "/rest/v1/rpc/manage_announcement",
      ) as z.core.JSONSchema.JSONSchema,
    );
    const id = "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca";
    const draft = {
      p_id: null,
      p_expected_version: 0,
      p_request_id: id,
      p_action: "save",
      p_payload: {
        title_de: "Fiktiv",
        title_en: "Fictional",
        body_de: "Fiktive Mitteilung",
        body_en: "Fictional announcement",
        starts_at: "2040-04-30T10:00:00Z",
        ends_at: "2040-05-01T10:00:00Z",
        time_zone: "UTC",
        important: false,
        audience_roles: ["lecturer"],
      },
    };
    expect(command.safeParse(draft).success).toBe(true);
    expect(command.safeParse({ ...draft, p_expected_version: 2 }).success).toBe(
      false,
    );
    expect(
      command.safeParse({
        ...draft,
        p_payload: {
          ...draft.p_payload,
          audience_roles: ["lecturer", "lecturer"],
        },
      }).success,
    ).toBe(false);
    const publish = {
      p_id: id,
      p_expected_version: 1,
      p_request_id: id,
      p_action: "publish",
    };
    expect(command.safeParse(publish).success).toBe(true);
    expect(
      command.safeParse({ ...publish, p_payload: draft.p_payload }).success,
    ).toBe(false);
  });
});

describe("private calendar contracts", () => {
  it("describes bounded private import and actor-owned export", () => {
    const prefix = "/rest/v1/rpc/";
    expect(requestSchema(prefix + "export_my_calendar")).toMatchObject({
      required: ["p_from", "p_until"],
    });
    expect(requestSchema(prefix + "import_my_calendar")).toMatchObject({
      properties: { p_events: { minItems: 1, maxItems: 500 } },
    });
    expect(
      paths[prefix + "export_my_calendar"].post.responses["200"],
    ).toMatchObject({
      content: {
        "application/json": {
          schema: {
            maxItems: 500,
            items: {
              additionalProperties: false,
              required: [
                "id",
                "kind",
                "title",
                "starts_at",
                "ends_at",
                "time_zone",
              ],
            },
          },
        },
      },
    });
  });

  it("keeps a private feed and token issuance out of the interactive explorer", () => {
    const feed = "/functions/v1/calendar-feed";
    const subscription = "/rest/v1/rpc/save_calendar_subscription";
    for (const path of [feed, subscription])
      expect(paths).not.toHaveProperty(path);
    const download = portalOpenApi(backend, true).paths;
    expect(download[feed].get).toMatchObject({
      security: [],
      parameters: [
        {
          name: "token",
          in: "query",
          required: true,
          schema: { format: "password" },
        },
      ],
    });
    expect(download[subscription].post).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              properties: { p_token: { format: "password" } },
            },
          },
        },
      },
      responses: { "409": { description: expect.any(String) } },
    });
  });
});

describe("finance and operations contracts", () => {
  it.each([false, true])(
    "describes invoice submission, exception review and exact retries with download enabled: %s",
    (download) => {
      const document = portalOpenApi(backend, download);
      const submission = document.paths["/rest/v1/rpc/submit_invoice"].post;
      const review = document.paths["/rest/v1/rpc/request_invoice_review"].post;
      expect(submission).toMatchObject({
        description: expect.stringContaining("final scheduled session"),
        responses: {
          "400": {
            description: expect.stringContaining("invoice_review_required"),
          },
          "403": {
            description: expect.stringContaining("exact clean invoice PDF"),
          },
          "409": { description: expect.stringContaining("active invoice") },
        },
      });
      expect(review).toMatchObject({
        description: expect.stringContaining("without creating an invoice"),
      });

      const request = (operation: unknown) => {
        const { requestBody } = operation as {
          requestBody: {
            content: {
              "application/json": {
                schema: Parameters<typeof z.fromJSONSchema>[0];
              };
            };
          };
        };
        return requestBody.content["application/json"].schema;
      };
      const id = "ca6a3930-ea90-4dc3-998b-52f767c37a55";
      const args = {
        p_number: "Fictional statement 01",
        p_claim_ids: [id],
        p_document_version_id: id,
        p_issued_on: "2026-11-21",
        p_client_id: id,
      };
      expect(request(submission)).toMatchObject({
        properties: {
          p_claim_ids: { minItems: 1, maxItems: 50, uniqueItems: true },
          p_due_on: {
            description: expect.stringContaining("30 calendar days"),
          },
        },
      });
      const parseInvoice = z.fromJSONSchema(request(submission));
      expect(parseInvoice.safeParse(args).success).toBe(true);
      expect(parseInvoice.safeParse({ ...args, p_due_on: null }).success).toBe(
        true,
      );
      expect(
        parseInvoice.safeParse({ ...args, p_due_on: "2026-12-21" }).success,
      ).toBe(true);
      expect(parseInvoice.safeParse({ ...args, p_claim_ids: [] }).success).toBe(
        false,
      );
      expect(
        parseInvoice.safeParse({ ...args, p_client_id: null }).success,
      ).toBe(false);
      expect(
        parseInvoice.safeParse({ ...args, p_issued_on: "2026-02-30" }).success,
      ).toBe(false);
      const parseReview = z.fromJSONSchema(request(review));
      expect(
        parseReview.safeParse({ p_claim_id: id, p_request_id: id }).success,
      ).toBe(true);
      expect(parseReview.safeParse({ p_claim_id: id }).success).toBe(false);
    },
  );

  it.each([false, true])(
    "publishes scoped forecast and review queues with download enabled: %s",
    (download) => {
      const document = portalOpenApi(backend, download);
      const forecast = document.paths["/rest/v1/rpc/finance_forecast"].post;
      const center = document.paths["/rest/v1/rpc/control_center"].post;

      for (const operation of [forecast, center]) {
        expect(operation).toMatchObject({
          description: expect.stringContaining("exclusive end date"),
          "x-luminovia-rest-gate": {
            postgresRole: "authenticated",
            operationalSession: true,
            participantSession: false,
            guestSession: false,
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  required: ["p_from", "p_until"],
                  additionalProperties: false,
                  properties: {
                    p_from: { type: "string", format: "date" },
                    p_until: { type: "string", format: "date" },
                  },
                },
              },
            },
          },
          responses: {
            "400": expect.any(Object),
            "403": expect.any(Object),
          },
        });
      }

      expect(forecast).toMatchObject({
        description: expect.stringContaining("finance.gross.read"),
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  p_pipeline_probability: {
                    type: "number",
                    minimum: 0,
                    maximum: 1,
                    default: 0,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  additionalProperties: false,
                  properties: {
                    payment_basis: {
                      const: "lecturer_invoice_payment_records",
                    },
                    months: {
                      type: "array",
                      items: {
                        additionalProperties: false,
                        properties: {
                          currency: { enum: ["EUR", "AUD"] },
                          accepted_gross_known: {
                            type: ["number", "null"],
                          },
                          pipeline_cost_unknown_positions: {
                            type: "integer",
                            minimum: 0,
                          },
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
      expect(center).toMatchObject({
        description: expect.stringContaining("jobs.manage"),
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  additionalProperties: false,
                  required: expect.arrayContaining([
                    "overdue_tasks",
                    "contracts_expiring",
                    "qualifications_expiring",
                    "preparation",
                    "quality",
                  ]),
                  properties: {
                    quality: {
                      type: "array",
                      items: {
                        additionalProperties: false,
                        properties: {
                          average_rating: {
                            type: ["number", "null"],
                          },
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
    },
  );
});

describe("documented Premium course and spending operations", () => {
  it("documents course creation, bounded offset-aware sessions and the visibility response", () => {
    expect(requestSchema("/rest/v1/rpc/save_course_run")).toMatchObject({
      required: ["p_id", "p_payload"],
      properties: {
        p_id: { type: ["string", "null"] },
        p_payload: {
          required: ["template_id", "sessions"],
          properties: {
            sessions: {
              minItems: 1,
              maxItems: 60,
              items: {
                required: ["starts_at", "ends_at"],
                properties: {
                  starts_at: {
                    format: "date-time",
                    pattern: expect.any(String),
                  },
                },
              },
            },
            published: { type: "boolean", default: false },
          },
        },
      },
    });
    expect(
      paths["/rest/v1/rpc/set_course_visibility"].post.responses,
    ).toHaveProperty("204.description");
    expect(
      paths["/rest/v1/rpc/duplicate_course_run"].post.responses["200"],
    ).toMatchObject({
      content: { "application/json": { schema: { format: "uuid" } } },
    });
  });

  it("documents exactly the scoped course destinations shown in the workspace", () => {
    const destination =
      paths["/rest/v1/rpc/course_operation_destinations"].post;
    expect(
      destination.requestBody.content["application/json"].schema,
    ).toMatchObject({
      required: ["p_run_id"],
      properties: { p_run_id: { type: "string", format: "uuid" } },
    });
    expect(destination.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: {
            required: ["organisation", "lecturers", "jobs", "rooms"],
            additionalProperties: false,
            properties: {
              rooms: {
                items: {
                  additionalProperties: false,
                  required: ["id", "name"],
                },
              },
              jobs: {
                items: {
                  additionalProperties: false,
                  required: ["id", "title"],
                },
              },
            },
          },
        },
      },
    });
  });

  it("describes assignment changes with optional reads, bounded sessions and explicit transitions", () => {
    const prefix = "/rest/v1/rpc/";
    expect(requestSchema(prefix + "assignment_changes")).toMatchObject({
      required: [],
      properties: { p_id: { type: ["string", "null"], format: "uuid" } },
    });
    expect(
      paths[prefix + "assignment_changes"].post.responses["200"],
    ).toMatchObject({
      content: {
        "application/json": {
          schema: {
            type: "array",
            items: {
              properties: {
                original: {
                  properties: {
                    amount: { type: ["number", "null"] },
                  },
                },
                proposed: {
                  properties: {
                    sessions: { items: { required: ["starts_at", "ends_at"] } },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(requestSchema(prefix + "save_assignment_change")).toMatchObject({
      properties: {
        p_payload: {
          required: ["reason", "changes"],
          properties: {
            changes: {
              additionalProperties: false,
              properties: {
                sessions: { maxItems: 60 },
              },
            },
          },
        },
      },
    });
    expect(requestSchema(prefix + "save_assignment_change")).not.toHaveProperty(
      "properties.p_payload.properties.changes.properties.currency",
    );
    expect(requestSchema(prefix + "assignment_change_action")).toMatchObject({
      properties: {
        p_action: { enum: ["submit", "accept", "reject", "withdraw", "apply"] },
      },
    });
  });

  it("publishes migrated scalar, table and defaulted signatures across business areas", () => {
    expect(Object.keys(paths).length).toBeGreaterThan(250);
    expect(requestSchema("/rest/v1/rpc/job_discovery")).toMatchObject({
      required: [],
      properties: {
        p_filters: {
          type: "object",
          additionalProperties: false,
          properties: { include_history: { type: "boolean", default: false } },
        },
        p_cursor: {
          anyOf: [
            { required: ["id", "number", "text", "fingerprint"] },
            { type: "null" },
          ],
        },
        p_limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
    });
    expect(requestSchema("/rest/v1/rpc/claim_job").required).toEqual([
      "p_job_id",
      "p_idempotency_key",
      "p_terms_version",
    ]);
    expect(paths["/rest/v1/rpc/portal_access"].post).toMatchObject({
      security: [{ publicApiKey: [], bearerAuth: [] }],
      responses: {
        "412": {
          content: {
            "application/json": {
              schema: { properties: { code: { const: "PT412" } } },
            },
          },
        },
        "428": {
          content: {
            "application/json": {
              schema: { properties: { code: { const: "PT428" } } },
            },
          },
        },
        "200": {
          content: {
            "application/json": { schema: { type: "boolean" } },
          },
        },
      },
    });
    expect(paths["/rest/v1/rpc/my_course_workspaces"].post).toMatchObject({
      "x-luminovia-rest-gate": {
        postgresRole: "authenticated",
        participantSession: true,
        guestSession: false,
      },
    });
    expect(paths["/rest/v1/rpc/client_requests"].post).toMatchObject({
      "x-luminovia-rest-gate": {
        participantSession: false,
        guestSession: false,
      },
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: { properties: { id: { format: "uuid" } } },
              },
            },
          },
        },
      },
    });
    expect(paths["/rest/v1/rpc/cancel_client_request"].post).toMatchObject({
      responses: { "204": { description: expect.any(String) } },
    });
    expect(
      isDocumentedRequest(
        backend + "/rest/v1/rpc/client_requests",
        "POST",
        backend,
      ),
    ).toBe(true);
  });

  it("keeps dormant customer instructor routes out of the internal API explorer and download", () => {
    for (const path of [
      "/rest/v1/rpc/academy_assign_course_instructor",
      "/rest/v1/rpc/academy_release_course_instructor",
      "/rest/v1/rpc/academy_course_instructor_candidates",
    ]) {
      expect(portalOpenApi(backend).paths).not.toHaveProperty(path);
      expect(isDocumentedRequest(backend + path, "POST", backend)).toBe(false);
    }
  });

  it("describes secret-bearing RPCs only in the noninteractive download", () => {
    const download = portalOpenApi(backend);
    for (const name of [
      "save_calendar_subscription",
      "save_mail_configuration",
      "issue_company_integration_key",
      "company_course_webhook_subscribe",
    ]) {
      const path = "/rest/v1/rpc/" + name;
      expect(download.paths[path].post).toBeDefined();
      expect(paths).not.toHaveProperty(path);
      expect(isDocumentedRequest(backend + path, "POST", backend)).toBe(false);
    }
  });

  it("documents the signed receiver event only in the downloadable contract", () => {
    expect(portalOpenApi(backend, false)).not.toHaveProperty("webhooks");
    expect(portalOpenApi(backend)).toHaveProperty(
      "webhooks.companyCourseEvent.post",
      expect.objectContaining({
        parameters: expect.arrayContaining([
          expect.objectContaining({
            name: "X-Luminovia-Signature",
            required: true,
          }),
        ]),
        responses: expect.objectContaining({ "2XX": expect.any(Object) }),
      }),
    );
  });

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
    [
      "course_session_register",
      "20261121021808_course_session_attendance_register.sql",
    ],
    [
      "save_course_session_attendance",
      "20261121021808_course_session_attendance_register.sql",
    ],
    [
      "attach_course_session_evidence",
      "20261121021808_course_session_attendance_register.sql",
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
    expect(requestSchema("/rest/v1/rpc/course_chat_messages")).toMatchObject({
      required: ["p_room_id"],
      properties: { p_limit: { minimum: 1, maximum: 100, default: 50 } },
    });
    expect(paths["/rest/v1/rpc/course_chat_messages"].post).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                maxItems: 100,
                items: { properties: { deleted_at: { format: "date-time" } } },
              },
            },
          },
        },
      },
    });
    expect(paths).not.toHaveProperty("/rest/v1/rpc/chat_messages");
    expect(paths).not.toHaveProperty("/rest/v1/rpc/send_message");
    expect(
      requestSchema("/rest/v1/rpc/send_course_chat_message"),
    ).toMatchObject({
      properties: { p_body: { minLength: 1, maxLength: 8000 } },
    });
    expect(
      requestSchema("/rest/v1/rpc/send_course_chat_attachment"),
    ).toMatchObject({
      properties: { p_body: { maxLength: 8000 } },
    });
  });

  it("types the bounded fields of company Premium settings and retained summaries", () => {
    const schema = (name: string) =>
      (
        paths["/rest/v1/rpc/" + name].post.responses["200"] as {
          content: Record<string, { schema: unknown }>;
        }
      ).content["application/json"].schema;
    expect(schema("company_premium_settings")).toMatchObject({
      type: "array",
      items: {
        required: ["organisation_id", "enabled", "version", "updated_at"],
        additionalProperties: false,
      },
    });
    expect(schema("set_company_premium")).toMatchObject({
      properties: {
        status: { enum: ["updated", "unchanged", "conflict"] },
      },
      additionalProperties: false,
    });
    expect(requestSchema("/rest/v1/rpc/retained_company_lms").required).toEqual(
      ["p_organisation_id"],
    );
    expect(schema("retained_company_lms")).toMatchObject({
      additionalProperties: false,
      properties: {
        courses: {
          items: {
            additionalProperties: false,
            required: expect.arrayContaining([
              "attendance_entries",
              "course_group_messages",
              "resources",
            ]),
            properties: {
              resources: {
                items: {
                  required: ["name", "version", "audience", "removed"],
                  additionalProperties: false,
                },
              },
            },
          },
        },
      },
    });
  });

  it("documents resource, teaching and self-service learning action payloads", () => {
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
      "preparation_create",
      "preparation_toggle",
      "contact_select",
      "notebook",
      "question",
      "answer",
      "feedback",
      "quiz_config",
      "quiz_attempt",
      "completion_issue",
      "completion_revoke",
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
    expect(paths["/rest/v1/rpc/course_workspace_action"].post).toMatchObject({
      description: expect.stringContaining(
        "immutable staff, company or lecturer ownership",
      ),
    });
    expect(
      source(
        "supabase/migrations/20261121123000_course_resource_ownership.sql",
      ),
    ).toContain(
      "private.course_resource_command(p_run_id, p_action, p_payload)",
    );
    expect(paths).not.toHaveProperty("/rest/v1/rpc/course_resource_command");
  });

  it("keeps participant onboarding schema and REST gates aligned", () => {
    const rpc = (name: string) => paths[`/rest/v1/rpc/${name}`].post;
    expect(rpc("my_company_participant_invitations")).toMatchObject({
      requestBody: { required: false },
      "x-luminovia-rest-gate": { participantSession: true },
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                items: {
                  required: [
                    "organisation_id",
                    "organisation_name",
                    "version",
                    "expires_at",
                    "source",
                  ],
                },
              },
            },
          },
        },
      },
    });
    expect(rpc("accept_company_participant_invitation")).toMatchObject({
      "x-luminovia-rest-gate": { participantSession: true },
    });
    expect(rpc("manage_course_enrolment")).toMatchObject({
      responses: { "204": { description: expect.any(String) } },
    });
    expect(rpc("manage_course_enrolment").responses).not.toHaveProperty("200");
    expect(rpc("cancel_own_course_enrolment")).toMatchObject({
      responses: { "204": { description: expect.any(String) } },
    });
  });

  it("types the session register, versioned correction and retained PDF evidence", () => {
    expect(
      requestSchema("/rest/v1/rpc/course_session_register").required,
    ).toEqual(["p_run_id", "p_session_id"]);
    expect(
      requestSchema("/rest/v1/rpc/save_course_session_attendance").required,
    ).toEqual([
      "p_run_id",
      "p_session_id",
      "p_user_id",
      "p_status",
      "p_arrival_at",
      "p_departure_at",
      "p_note",
      "p_reason",
      "p_expected_version",
    ]);
    expect(
      requestSchema("/rest/v1/rpc/attach_course_session_evidence").required,
    ).toEqual(["p_run_id", "p_session_id", "p_version_id"]);
    expect(paths["/rest/v1/rpc/course_session_register"].post).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                required: [
                  "session_id",
                  "starts_at",
                  "ends_at",
                  "time_zone",
                  "rows",
                  "evidence",
                  "history",
                ],
                properties: {
                  rows: {
                    items: {
                      required: [
                        "user_id",
                        "name",
                        "status",
                        "arrival_at",
                        "departure_at",
                        "note",
                        "version",
                      ],
                    },
                  },
                  evidence: {
                    items: {
                      required: [
                        "id",
                        "resource_id",
                        "version_id",
                        "name",
                        "attached_at",
                      ],
                    },
                  },
                  history: {
                    items: {
                      additionalProperties: false,
                      properties: {
                        actor_id: { format: "uuid" },
                        new_state: {
                          anyOf: [
                            {
                              required: ["state", "minutes"],
                              additionalProperties: false,
                            },
                            {
                              required: [
                                "state",
                                "minutes",
                                "arrival_at",
                                "departure_at",
                                "staff_note",
                                "register_status",
                              ],
                              additionalProperties: false,
                            },
                          ],
                        },
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
    expect(
      paths["/rest/v1/rpc/save_course_session_attendance"].post,
    ).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                required: ["status", "version", "minutes"],
              },
            },
          },
        },
      },
    });
    expect(
      paths["/rest/v1/rpc/attach_course_session_evidence"].post,
    ).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                required: ["id", "resource_id", "version_id"],
              },
            },
          },
        },
      },
    });
    expect(
      source(
        "supabase/migrations/20261121021808_course_session_attendance_register.sql",
      ),
    ).toContain("Retained attendance evidence cannot be unshared");
  });

  it("describes the actual protected gateways and company spending DTO", () => {
    const documentHandler = source(
      "supabase/functions/course-documents/handler.ts",
    );
    expect(documentHandler).toContain(
      '["resource", "exam", "completion", "attendance_evidence"].includes(kind)',
    );
    expect(documentHandler).toContain('kind === "attendance" && uuid(body.id)');
    expect(source("supabase/functions/files/index.ts")).toContain(
      "request.headers.get('content-type')?.startsWith('multipart/form-data')",
    );
    expect(requestSchema("/functions/v1/course-documents").oneOf).toMatchObject(
      [
        {
          properties: {
            kind: { enum: ["resource", "exam", "completion", "attendance"] },
          },
          required: ["kind", "id"],
        },
        {
          properties: { kind: { const: "course_chat_attachment" } },
          required: ["kind", "id", "version_id"],
        },
        {
          properties: { kind: { const: "course_chat_attachment" } },
          required: ["kind", "id", "version_id", "organisation_id", "reason"],
        },
      ],
    );
    expect(
      requestSchema("/rest/v1/rpc/send_course_chat_attachment").required,
    ).toEqual([
      "p_room_id",
      "p_body",
      "p_client_id",
      "p_document_id",
      "p_version_id",
    ]);
    expect(paths["/functions/v1/files"].post).toMatchObject({
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: {
              required: ["file", "client_id"],
              properties: {
                message_only: { const: "true" },
                course_chat: { const: "true" },
              },
            },
          },
          "application/json": {
            schema: {
              oneOf: expect.arrayContaining([
                expect.objectContaining({
                  required: ["action", "evidence_id"],
                }),
                expect.objectContaining({ required: ["action", "id"] }),
              ]),
            },
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
      "/rest/v1/rpc/course_chat_attachment_access",
      "/rest/v1/rpc/reserve_course_chat_document",
      "/rest/v1/rpc/course_resource_command",
      "/rest/v1/rpc/deletion_upload_begin",
      "/functions/v1/company-integration",
    ]) {
      expect(paths).not.toHaveProperty(path);
      expect(isDocumentedRequest(backend + path, "POST", backend)).toBe(false);
    }
  });
});
