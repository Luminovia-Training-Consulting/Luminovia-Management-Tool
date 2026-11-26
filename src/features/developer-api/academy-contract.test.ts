import { z } from "zod";
import { describe, expect, it } from "vitest";
import { internalInstallationBrand } from "../../lib/installation-brand";
import { academyExplorerOpenApi, academyOpenApi } from "./academy-contract";
import { academyWorkflowIndex } from "../../../scripts/academy-workflows";
import { isDocumentedRequest, portalOpenApi } from "./contract";
import { humanAuthPaths } from "./human-auth-contract";

const backend = "https://academy.example.invalid/backend";
const id = "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca";
const readPaths = [
  "/rest/v1/rpc/my_course_workspaces",
  "/rest/v1/rpc/course_workspace",
  "/rest/v1/rpc/course_welcome_content",
  "/rest/v1/rpc/course_chat_rooms",
  "/rest/v1/rpc/course_chat_messages",
  "/rest/v1/rpc/course_session_register",
  "/rest/v1/rpc/academy_course_participation_report",
  "/rest/v1/rpc/learning_analytics_access",
  "/rest/v1/rpc/learning_analytics_report",
  "/rest/v1/rpc/notification_inbox",
  "/rest/v1/rpc/delivery_preferences",
  "/rest/v1/rpc/academy_course_publication",
  "/rest/v1/rpc/academy_timetable",
  "/rest/v1/rpc/academy_licence_receipt",
  "/rest/v1/rpc/course_chat_protection",
  "/rest/v1/rpc/course_class_options",
  "/rest/v1/rpc/course_submissions",
  "/rest/v1/rpc/search_course_materials",
  "/rest/v1/rpc/course_attendance_summary",
  "/rest/v1/rpc/course_gradebook",
] as const;
const writePaths = [
  "/rest/v1/rpc/set_course_meeting_link",
  "/rest/v1/rpc/publish_course_welcome_content",
  "/rest/v1/rpc/academy_ensure_course_chat",
  "/rest/v1/rpc/send_course_chat_message",
  "/rest/v1/rpc/academy_course_material_action",
  "/rest/v1/rpc/save_course_session_attendance",
  "/rest/v1/rpc/set_course_exam_required",
  "/rest/v1/rpc/academy_student_exam_pdf_options",
  "/rest/v1/rpc/share_course_exam_pdf",
  "/rest/v1/rpc/mark_notifications",
  "/rest/v1/rpc/save_delivery_preferences",
  "/rest/v1/rpc/academy_publish_course",
  "/rest/v1/rpc/academy_set_course_capacity",
  "/rest/v1/rpc/academy_learning_action",
  "/rest/v1/rpc/remove_course_exam_pdf",
  "/rest/v1/rpc/send_course_chat_attachment",
  "/rest/v1/rpc/attach_course_session_evidence",
  "/rest/v1/rpc/set_course_chat_protection",
  "/rest/v1/rpc/set_course_class",
  "/rest/v1/rpc/set_course_submissions",
  "/rest/v1/rpc/withdraw_course_submission",
  "/rest/v1/rpc/import_table_row",
  "/rest/v1/rpc/set_course_material_metadata",
] as const;
const bootstrap = "/rest/v1/rpc/installation_capabilities";
const upload = "/functions/v1/files";
const examDownload = "/functions/v1/course-documents";
const mailPaths = [
  "/functions/v1/mail-admin",
  "/rest/v1/rpc/get_mail_configuration",
  "/rest/v1/rpc/save_mail_configuration",
  "/rest/v1/rpc/queue_mail_connection_test",
] as const;
const attendanceImport = "/rest/v1/rpc/import_course_session_attendance";
const withdrawalWindow = "/rest/v1/rpc/course_withdrawal_window";
const withdraw = "/rest/v1/rpc/cancel_own_course_enrolment";
const administrationPaths = [
  "/rest/v1/rpc/academy_administration",
  "/rest/v1/rpc/academy_support_access",
  "/rest/v1/rpc/academy_create_organisation",
  "/rest/v1/rpc/academy_set_member_active",
  "/rest/v1/rpc/academy_set_management",
  "/functions/v1/accounts/v1/academy/users",
  "/functions/v1/accounts/v1/academy/company-invitations",
] as const;
const personalPaths = [
  "/rest/v1/rpc/academy_personal_settings",
  "/rest/v1/rpc/academy_save_display_name",
  "/rest/v1/rpc/academy_save_appearance",
] as const;
const academyParityPaths = [
  "/rest/v1/rpc/company_lecturer_blocks",
  "/rest/v1/rpc/set_company_lecturer_block",
  "/rest/v1/rpc/academy_lecturer_block_organisations",
  "/rest/v1/rpc/course_evaluations",
  "/rest/v1/rpc/course_evaluation_comments",
  "/rest/v1/rpc/save_course_evaluation",
  "/rest/v1/rpc/portal_access",
  "/rest/v1/rpc/authenticator_settings_available",
  "/rest/v1/rpc/course_workspace_entitlement",
  "/rest/v1/rpc/course_enrolments",
  "/rest/v1/rpc/course_enrolment_candidates",
  "/rest/v1/rpc/manage_course_enrolment",
  "/rest/v1/rpc/academy_course_instructor_candidates",
  "/rest/v1/rpc/academy_assign_course_instructor",
  "/rest/v1/rpc/academy_release_course_instructor",
  "/rest/v1/rpc/academy_member_roles",
  "/rest/v1/rpc/academy_set_member_role",
  "/functions/v1/human-login",
] as const;
const draftPaths = [
  "/rest/v1/rpc/academy_course_draft_options",
  "/rest/v1/rpc/academy_create_course_draft",
  "/rest/v1/rpc/academy_draft_schedule",
  "/rest/v1/rpc/academy_save_draft_schedule",
] as const;

for (const edition of ["customer-self-hosted", "customer-managed"] as const) {
  describe(`${edition} branded OpenAPI catalogue`, () => {
    const brand = {
      ...internalInstallationBrand,
      edition,
      name: "Practice Academy",
      installationId: id,
    };
    const spec = academyOpenApi(backend + "/", brand);

    it("accounts for native and HTTP aliases while keeping documented-only actions out of the explorer", () => {
      const explorer = academyExplorerOpenApi(backend, brand);
      const inventory = academyWorkflowIndex(spec, explorer);
      expect(inventory.installation).toEqual(spec["x-portal-installation"]);
      expect(inventory.apiVersion).toBe(spec.info.version);
      const operations = inventory.workflows.flatMap(
        (group) => group.operations,
      );
      const endpoints = operations.flatMap((operation) => operation.endpoints);
      const expected = Object.values(spec.paths)
        .flatMap((methods) => Object.values(methods))
        .map((operation) => operation.operationId)
        .sort();
      expect(endpoints.map((endpoint) => endpoint.operationId).sort()).toEqual(
        expected,
      );
      const byId = new Map(
        operations.map((operation) => [operation.operationId, operation]),
      );
      expect(byId.get("saveAcademyWhiteLabel")?.endpoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "POST", interactive: true }),
          expect.objectContaining({
            method: "PUT",
            interactive: true,
            statuses: expect.arrayContaining(["409", "415"]),
          }),
        ]),
      );
      expect(byId.get("issueAcademyScopedIntegrationKey")?.endpoints).toEqual([
        expect.objectContaining({ method: "POST", interactive: false }),
      ]);
      expect(byId.get("publishAcademyCourseMaterial")?.actions).toEqual({
        argument: "p_action",
        values: ["resource_share", "resource_remove"],
      });
      for (const exception of inventory.exceptions) {
        expect(exception.reason.de).toBeTruthy();
        expect(exception.reason.en).toBeTruthy();
        expect(exception.relatedOperations.every((id) => byId.has(id))).toBe(
          true,
        );
      }
    });

    it("publishes exactly the reviewed paths and closed public installation fields", () => {
      expect(portalOpenApi(backend, true, brand)).toEqual(spec);
      expect(spec.info.title).toEqual("Practice Academy API");
      expect(spec.info.description).toMatch(
        /disabled profile.*mismatched release.*expired licence denies course access/i,
      );
      expect(spec.servers).toEqual([{ url: backend }]);
      expect(spec["x-portal-installation"]).toEqual({
        installation_id: id,
        edition,
        customer_ready: false,
      });
      expect(
        Object.keys(spec.paths)
          .filter((path) => !path.startsWith("/functions/v1/portal-api/v1/"))
          .sort(),
      ).toEqual(
        [
          bootstrap,
          "/rest/v1/rpc/company_course_webhook_list",
          "/rest/v1/rpc/company_integration_keys",
          "/rest/v1/rpc/issue_company_integration_key",
          "/rest/v1/rpc/issue_scoped_company_integration_key",
          "/rest/v1/rpc/revoke_company_integration_key",
          "/functions/v1/company-integration",
          "/functions/v1/company-integration/enrolments",
          "/functions/v1/company-integration/participation",
          "/rest/v1/rpc/academy_subscribe_course_webhook",
          "/rest/v1/rpc/academy_revoke_course_webhook",
          "/rest/v1/rpc/academy_public_branding",
          "/rest/v1/rpc/save_academy_public_branding",
          "/rest/v1/rpc/save_academy_white_label",
          "/rest/v1/rpc/admin_audit_events",
          "/rest/v1/rpc/clear_administration_activity",
          "/rest/v1/rpc/academy_public_brand_links",
          "/rest/v1/rpc/academy_public_logo",
          "/rest/v1/rpc/academy_pwa_icon",
          "/rest/v1/rpc/clear_academy_pwa_icon",
          "/rest/v1/rpc/clear_academy_public_logo",
          "/rest/v1/rpc/save_academy_public_brand_links",
          upload,
          examDownload,
          ...mailPaths,
          ...administrationPaths,
          "/rest/v1/rpc/mail_delivery_failures",
          "/rest/v1/rpc/retry_course_mail_delivery",
          "/functions/v1/accounts/v1/academy/invitations/{id}/retry",
          "/rest/v1/rpc/course_series_classes",
          "/rest/v1/rpc/plan_course_series",
          "/rest/v1/rpc/learning_programs",
          "/rest/v1/rpc/learning_program_class_progress",
          "/rest/v1/rpc/set_company_participant_class",
          "/rest/v1/rpc/save_learning_program",
          "/rest/v1/rpc/enrol_learning_program",
          "/rest/v1/rpc/start_learning_program_course",
          ...personalPaths,
          attendanceImport,
          withdrawalWindow,
          withdraw,
          ...readPaths,
          ...writePaths,
          ...draftPaths,
          ...academyParityPaths,
          "/rest/v1/rpc/course_exam_state",
          "/rest/v1/rpc/published_course_exam_results",
          "/rest/v1/rpc/save_course_exam_grades",
          "/rest/v1/rpc/save_course_exam_schedule",
          "/rest/v1/rpc/submit_course_exam",
        ].sort(),
      );
      expect(spec.webhooks.companyCourseEvent.post.operationId).toBe(
        "receiveCompanyCourseEvent",
      );
      expect(Object.keys(spec.components.securitySchemes).sort()).toEqual([
        "apiKey",
        "bearerAuth",
        "integrationKey",
      ]);
      const capability = spec.paths[bootstrap].get;
      expect(capability.security).toEqual([{ apiKey: [] }]);
      const schema =
        capability.responses["200"].content["application/json"].schema;
      expect(schema).toEqual({
        type: "object",
        additionalProperties: false,
        required: [
          "installation_id",
          "edition",
          "licence_status",
          "customer_ready",
          "lms_available",
          "marketplace_available",
          "company_premium_switch_available",
        ],
        properties: {
          installation_id: { const: id },
          edition: { const: edition },
          licence_status: {
            enum: ["unlicensed", "scheduled", "active", "grace", "expired"],
          },
          customer_ready: { const: false },
          lms_available: { const: false },
          marketplace_available: { const: false },
          company_premium_switch_available: { const: false },
        },
      });
    });

    it("publishes shared ingress responses and retains the handler's JSON errors", () => {
      const retryAfter = {
        schema: { type: "integer", minimum: 0 },
        example: 60,
      };
      const maintenance =
        "Kurze Wartung. Bitte gleich erneut versuchen. / Brief maintenance. Please try again shortly.";
      expect(spec.info.version).toBe("1.39.0");
      for (const methods of Object.values(spec.paths)) {
        for (const { responses } of Object.values(methods)) {
          expect(responses["429"]).toMatchObject({
            headers: { "Retry-After": retryAfter },
            content: {
              "text/plain": { schema: { const: "local_rate_limited" } },
            },
          });
          expect(responses["503"]).toMatchObject({
            headers: { "Retry-After": retryAfter },
            content: { "text/plain": { schema: { const: maintenance } } },
          });
        }
      }
      const integration = spec.paths["/functions/v1/company-integration"].get;
      expect(
        integration.responses["429"].content["application/json"].schema,
      ).toMatchObject({ properties: { error: { const: "rate_limited" } } });
      expect(
        spec.paths["/rest/v1/rpc/send_course_chat_message"].post.responses[
          "429"
        ].content["application/json"].schema,
      ).toMatchObject({ required: ["code", "message", "details", "hint"] });
      expect(
        spec.paths[upload].post.responses["503"].content["application/json"]
          .schema,
      ).toMatchObject({
        properties: {
          error: { enum: expect.arrayContaining(["scanner_unavailable"]) },
        },
      });
      expect(spec.webhooks.companyCourseEvent.post.responses["429"]).toEqual({
        description: "Receiver throttled the request. Delivery may be retried.",
      });
    });

    it("documents the signed receiver and tolerates legacy delivery receipts", () => {
      const receiver = spec.webhooks.companyCourseEvent.post;
      expect(Object.keys(receiver.responses)).toEqual(
        expect.arrayContaining([
          "204",
          "401",
          "404",
          "405",
          "408",
          "409",
          "413",
          "415",
          "429",
          "503",
        ]),
      );
      const history =
        spec.paths["/rest/v1/rpc/company_course_webhook_list"].post;
      expect(
        history.responses["200"].content["application/json"].schema,
      ).toMatchObject({
        items: {
          properties: {
            deliveries: {
              items: {
                properties: { event_id: { type: "string", format: "uuid" } },
                required: expect.arrayContaining(["id"]),
              },
            },
          },
        },
      });
      expect(
        history.responses["200"].content["application/json"].schema,
      ).not.toMatchObject({
        items: {
          properties: {
            deliveries: {
              items: { required: expect.arrayContaining(["event_id"]) },
            },
          },
        },
      });
    });

    it("documents session prerequisites and keeps human credential requests download-only", () => {
      const read = spec.paths["/rest/v1/rpc/portal_access"].post;
      expect(read["x-portal-licence"]).toBe("active-or-grace");
      expect(
        read.responses["412"].content["application/json"].schema.properties
          .code,
      ).toEqual({ const: "PT412" });
      expect(
        read.responses["428"].content["application/json"].schema.properties
          .code,
      ).toEqual({ const: "PT428" });
      const explorer = portalOpenApi(backend, false, brand);
      const internal = portalOpenApi(backend);
      for (const path of ["/functions/v1/human-login"] as const) {
        const operation = humanAuthPaths[path].post;
        expect(internal.paths[path].post).toEqual(operation);
        const { responses, ...shared } = operation;
        const { responses: dedicatedResponses, ...dedicated } =
          spec.paths[path].post;
        expect(dedicated).toEqual(shared);
        for (const [status, response] of Object.entries(responses)) {
          if (status === "429" || status === "503") {
            expect(dedicatedResponses[status]).toMatchObject({
              ...response,
              description: expect.stringContaining(response.description),
            });
          } else {
            expect(dedicatedResponses).toHaveProperty(status, response);
          }
        }
        expect(explorer.paths[path]).toBeUndefined();
        expect(spec.paths[path].post.security).toEqual([]);
      }
    });

    it("describes licence, assignment, enrolment and scoped role states", () => {
      const roster = spec.paths["/rest/v1/rpc/course_enrolments"].post;
      expect(roster["x-portal-licence"]).toBe("active-or-grace");
      const enrol = spec.paths["/rest/v1/rpc/manage_course_enrolment"].post;
      expect(enrol["x-portal-licence"]).toBe("active");
      expect(enrol.responses).toHaveProperty("204");
      expect(enrol.responses).not.toHaveProperty("200");
      expect(enrol.responses).toHaveProperty("409");

      const assign =
        spec.paths["/rest/v1/rpc/academy_assign_course_instructor"].post;
      const assignment = z.fromJSONSchema(
        assign.responses["200"].content["application/json"]
          .schema as z.core.JSONSchema.JSONSchema,
      );
      expect(
        assignment.safeParse({ status: "cancelled", claim_id: id }).success,
      ).toBe(true);
      expect(assignment.safeParse({ status: "conflict" }).success).toBe(true);
      expect(
        assignment.safeParse({ status: "confirmed", amount: 50 }).success,
      ).toBe(false);

      const change = spec.paths["/rest/v1/rpc/academy_set_member_role"].post;
      const roleRequest = z.fromJSONSchema(
        change.requestBody.content["application/json"].schema,
      );
      const request = {
        p_user_id: id,
        p_role: "participant",
        p_organisation_id: id,
        p_enabled: true,
        p_expected_revision: "f".repeat(32),
      };
      expect(roleRequest.safeParse(request).success).toBe(true);
      expect(
        roleRequest.safeParse({ ...request, p_organisation_id: null }).success,
      ).toBe(false);
      expect(
        roleRequest.safeParse({ ...request, p_role: "lecturer" }).success,
      ).toBe(false);
      expect(
        roleRequest.safeParse({
          ...request,
          p_role: "admin",
          p_organisation_id: null,
        }).success,
      ).toBe(false);
      expect(
        roleRequest.safeParse({
          ...request,
          p_enabled: false,
          p_organisation_id: null,
        }).success,
      ).toBe(true);
    });

    it("keeps the scanner-bound logo contract public for read and admin-only for deletion", () => {
      const read = spec.paths["/rest/v1/rpc/academy_public_logo"].get;
      const clear = spec.paths["/rest/v1/rpc/clear_academy_public_logo"].post;
      const intake = spec.paths[upload].post;
      expect(read.security).toEqual([{ apiKey: [] }]);
      expect(clear.security).toEqual([{ apiKey: [], bearerAuth: [] }]);
      expect(clear.responses).toHaveProperty("409");
      expect(intake.requestBody.content["image/png"].schema).toMatchObject({
        format: "binary",
      });
      expect(
        intake.responses["200"].content["application/json"].schema,
      ).toHaveProperty(
        "anyOf.1",
        read.responses["200"].content["application/json"].schema,
      );
    });

    it("documents the learner's scoped deadline read and active-only 204 withdrawal", () => {
      const read = spec.paths[withdrawalWindow].post;
      const write = spec.paths[withdraw].post;
      expect(read["x-portal-licence"]).toBe("active-or-grace");
      expect(write["x-portal-licence"]).toBe("active");
      expect(
        read.responses["200"].content["application/json"].schema,
      ).toMatchObject({
        required: ["deadline_at", "can_withdraw"],
        additionalProperties: false,
      });
      expect(
        write.requestBody.content["application/json"].schema,
      ).toMatchObject({
        required: ["p_course_run_id"],
        additionalProperties: false,
      });
      expect(write.responses).toHaveProperty("204");
      expect(write.responses).not.toHaveProperty("200");
    });

    it("advertises the private receipt in the dedicated catalogue only", () => {
      const path = "/rest/v1/rpc/academy_licence_receipt";
      const read = spec.paths[path].post;
      expect(read["x-portal-licence"]).toBe("active-or-grace");
      expect(read.requestBody.required).toBe(false);
      expect(read.requestBody.content["application/json"].schema).toMatchObject(
        {
          additionalProperties: false,
          properties: {},
        },
      );
      expect(
        read.responses["200"].content["application/json"].schema,
      ).toMatchObject({
        additionalProperties: false,
        properties: {
          seats: {
            properties: {
              limit: expect.any(Object),
              occupied: expect.any(Object),
              available: expect.any(Object),
            },
          },
        },
      });
      expect(
        portalOpenApi(backend, true, internalInstallationBrand).paths,
      ).not.toHaveProperty(path);
    });

    it("documents active manager options and a closed single-template draft request", () => {
      const [choices, command] = draftPaths.map(
        (path) => spec.paths[path].post,
      );
      expect(choices["x-portal-licence"]).toBe("active");
      expect(choices.requestBody.required).toBe(false);
      expect(command["x-portal-licence"]).toBe("active");
      expect(
        command.requestBody.content["application/json"].schema,
      ).toMatchObject({
        required: [
          "p_request_id",
          "p_organisation_id",
          "p_template_id",
          "p_template_title",
          "p_payload",
        ],
        oneOf: expect.any(Array),
        properties: {
          p_payload: {
            additionalProperties: false,
            properties: { sessions: { maxItems: 60 } },
          },
        },
      });
      expect(command.responses).toHaveProperty("409");
    });

    it("documents the active-only atomic attendance import and version conflicts", () => {
      const operation = spec.paths[attendanceImport].post;
      expect(operation["x-portal-licence"]).toBe("active");
      expect(operation.responses).toHaveProperty("409");
      expect(
        operation.requestBody.content["application/json"].schema,
      ).toMatchObject({
        required: ["p_run_id", "p_session_id", "p_rows"],
        properties: {
          p_rows: {
            minItems: 1,
            maxItems: 200,
            items: {
              additionalProperties: false,
              required: expect.arrayContaining([
                "user_id",
                "status",
                "expected_version",
              ]),
            },
          },
        },
      });
    });

    it("documents active exam publication and withdrawal with grace-readable exact PDFs", () => {
      const write = spec.paths[writePaths[6]].post;
      expect(write["x-portal-licence"]).toBe("active");
      expect(write.responses).toHaveProperty("409");
      expect(
        write.requestBody.content["application/json"].schema,
      ).toMatchObject({
        required: ["p_run_id", "p_required", "p_expected_version"],
      });
      expect(
        spec.paths[readPaths[1]].post.responses["200"].content[
          "application/json"
        ].schema,
      ).toMatchObject({
        properties: {
          exams: {
            properties: {
              documents: {
                items: {
                  properties: {
                    audience: {
                      type: "string",
                      enum: ["students", "exam_staff"],
                    },
                  },
                },
              },
            },
          },
        },
      });
      expect(
        spec.paths[writePaths[8]].post.requestBody.content["application/json"]
          .schema,
      ).toMatchObject({
        properties: {
          p_audience: { type: "string", enum: ["students", "exam_staff"] },
        },
      });
      expect(spec.paths[examDownload].post["x-portal-licence"]).toBe(
        "active-or-grace",
      );
      expect(
        spec.paths[examDownload].post.responses["200"].content[
          "application/pdf"
        ].schema,
      ).toMatchObject({ format: "binary" });
      const withdrawal = spec.paths["/rest/v1/rpc/remove_course_exam_pdf"].post;
      expect(withdrawal["x-portal-licence"]).toBe("active");
      expect(withdrawal.responses).toHaveProperty("204");
      expect(
        withdrawal.requestBody.content["application/json"].schema,
      ).toMatchObject({
        required: ["p_run_id", "p_exam_id"],
      });
    });

    it("describes read-only grace, version conflicts, scanned evidence and report exports", () => {
      const read = spec.paths[readPaths[5]].post;
      expect(read["x-portal-licence"]).toBe("active-or-grace");
      expect(
        read.responses["200"].content["application/json"].schema,
      ).toMatchObject({
        properties: {
          evidence: {
            items: {
              required: [
                "id",
                "resource_id",
                "version_id",
                "name",
                "attached_at",
              ],
              properties: { resource_id: { type: "null" } },
            },
          },
        },
      });
      const save = spec.paths[writePaths[5]].post;
      expect(save["x-portal-licence"]).toBe("active");
      expect(save.responses).toHaveProperty("409");
      expect(save.requestBody.content["application/json"].schema).toMatchObject(
        {
          required: expect.arrayContaining(["p_expected_version"]),
        },
      );
      const evidence =
        spec.paths["/rest/v1/rpc/attach_course_session_evidence"].post;
      expect(evidence["x-portal-licence"]).toBe("active");
      expect(
        evidence.requestBody.content["application/json"].schema,
      ).toMatchObject({
        required: ["p_run_id", "p_session_id", "p_version_id"],
      });
      expect(
        evidence.responses["200"].content["application/json"].schema,
      ).toMatchObject({
        properties: { resource_id: { type: "null" } },
      });
      const report = spec.paths[examDownload].post;
      expect(
        report.requestBody.content["application/json"].schema,
      ).toMatchObject({
        oneOf: expect.arrayContaining([
          {
            type: "object",
            required: ["kind", "id"],
            additionalProperties: false,
            properties: {
              kind: { const: "attendance_evidence" },
              id: { type: "string", format: "uuid" },
            },
          },
        ]),
      });
      expect(report["x-portal-licence"]).toBe("active-or-grace");
      expect(
        report.requestBody.content["application/json"].schema,
      ).toMatchObject({
        oneOf: expect.arrayContaining([
          expect.objectContaining({
            type: "object",
            additionalProperties: false,
            required: ["kind", "id"],
            properties: {
              kind: { const: "attendance" },
              id: { type: "string", format: "uuid" },
              format: { enum: ["pdf", "csv"], default: "pdf" },
            },
          }),
        ]),
      });
      expect(Object.keys(report.responses["200"].content)).toEqual(
        expect.arrayContaining(["application/pdf", "text/csv"]),
      );
    });

    it("documents grace-readable material metadata and versioned active-only edits", () => {
      const read = spec.paths["/rest/v1/rpc/search_course_materials"].post;
      const write =
        spec.paths["/rest/v1/rpc/set_course_material_metadata"].post;
      expect(read["x-portal-licence"]).toBe("active-or-grace");
      expect(
        read.responses["200"].content["application/json"].schema,
      ).toMatchObject({
        items: {
          required: expect.arrayContaining([
            "metadata",
            "metadata_revision",
            "can_edit_metadata",
          ]),
        },
      });
      expect(write["x-portal-licence"]).toBe("active");
      expect(write.responses).toHaveProperty("409");
      expect(
        write.requestBody.content["application/json"].schema,
      ).toMatchObject({
        required: ["p_resource_id", "p_expected_revision", "p_metadata"],
      });
      expect(
        write.responses["200"].content["application/json"].schema,
      ).toMatchObject({ type: "integer", minimum: 1 });
    });

    it("describes the scoped multipart upload and exact publication without scanner APIs", () => {
      const intake = spec.paths[upload].post;
      expect(intake).toMatchObject({
        "x-portal-licence": "active",
        security: [{ apiKey: [], bearerAuth: [] }],
        parameters: expect.arrayContaining([
          {
            name: "mode",
            in: "query",
            required: true,
            schema: {
              type: "string",
              enum: [
                "academy-material",
                "academy-student-exam",
                "academy-answer-key",
                "academy-course-chat",
                "academy-attendance",
                "academy-logo",
                "academy-pwa-icon",
                "course-submission",
                "exam-submission",
              ],
            },
          },
        ]),
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                oneOf: [
                  {
                    additionalProperties: false,
                    required: ["client_id", "file"],
                    oneOf: [
                      { required: ["academy_course_id"] },
                      { required: ["academy_room_id"] },
                      { required: ["academy_session_id"] },
                      { required: ["course_run_id"] },
                    ],
                    properties: { file: { format: "binary" } },
                  },
                  {
                    additionalProperties: false,
                    required: ["icon_192", "icon_512", "maskable_512"],
                  },
                ],
              },
            },
          },
        },
      });
      const receipt =
        intake.responses["200"].content["application/json"].schema;
      expect(receipt).toHaveProperty(
        "anyOf.0.properties.document.properties.status.const",
        "clean",
      );
      expect(receipt).toHaveProperty(
        "anyOf.0.properties.document.properties.current_version_id.format",
        "uuid",
      );
      expect(
        spec.paths[writePaths[4]].post.requestBody.content["application/json"]
          .schema,
      ).toMatchObject({
        additionalProperties: false,
        oneOf: [
          {
            properties: { p_action: { const: "resource_share" } },
            required: ["p_audience", "p_category"],
          },
          { properties: { p_action: { const: "resource_remove" } } },
        ],
      });
      expect(intake.description).toContain("publishAcademyStudentExamPdf");
      for (const servicePath of [
        "/rest/v1/rpc/course_submission_storage_path",
        "/rest/v1/rpc/course_submission_scan",
        "/rest/v1/rpc/reserve_course_submission",
        "/rest/v1/rpc/reserve_academy_student_exam_pdf",
        "/rest/v1/rpc/reserve_academy_answer_key_pdf",
        "/rest/v1/rpc/reserve_academy_course_chat_file",
        "/rest/v1/rpc/reserve_academy_attendance_pdf",
        "/rest/v1/rpc/academy_attendance_upload_status",
        "/rest/v1/rpc/course_chat_upload_status",
        "/rest/v1/rpc/course_chat_attachment_access",
        "/rest/v1/rpc/reserve_academy_course_material",
        "/rest/v1/rpc/academy_course_material_status",
        "/rest/v1/rpc/academy_course_material_scan",
      ])
        expect(Object.keys(spec.paths)).not.toContain(servicePath);
    });

    it("documents grace reads, rejects writes in grace and keeps file fields out of text chat", () => {
      for (const path of [...readPaths, ...writePaths]) {
        const operation = spec.paths[path].post;
        expect(operation.security).toEqual([{ apiKey: [], bearerAuth: [] }]);
        expect(operation.responses).toHaveProperty("403");
      }
      for (const path of readPaths)
        expect(spec.paths[path].post["x-portal-licence"]).toBe(
          "active-or-grace",
        );
      for (const path of writePaths)
        expect(spec.paths[path].post["x-portal-licence"]).toBe("active");
      for (const path of writePaths.slice(0, 2))
        expect(spec.paths[path].post.responses).toHaveProperty("409");
      expect(
        spec.paths[writePaths[3]].post.requestBody.content["application/json"]
          .schema,
      ).toMatchObject({
        additionalProperties: false,
        required: ["p_room_id", "p_body", "p_client_id"],
      });
      expect(
        spec.paths[readPaths[4]].post.responses["200"].content[
          "application/json"
        ].schema,
      ).toMatchObject({
        items: {
          additionalProperties: false,
          properties: {
            attachment: {
              anyOf: [
                {
                  additionalProperties: false,
                  required: ["version_id", "name", "size_bytes"],
                },
                { type: "null" },
              ],
            },
          },
        },
      });
      expect(
        spec.paths[readPaths[1]].post.responses["200"].content[
          "application/json"
        ].schema,
      ).toMatchObject({
        additionalProperties: false,
        properties: { repeat_request: { type: "null" } },
      });
      expect(
        spec.paths["/rest/v1/rpc/send_course_chat_attachment"].post.requestBody
          .content["application/json"].schema,
      ).toMatchObject({
        additionalProperties: false,
        required: [
          "p_room_id",
          "p_body",
          "p_client_id",
          "p_document_id",
          "p_version_id",
        ],
      });
      expect(
        spec.paths[examDownload].post.requestBody.content["application/json"]
          .schema,
      ).toMatchObject({
        oneOf: expect.arrayContaining([
          expect.objectContaining({
            additionalProperties: false,
            required: ["kind", "id", "version_id"],
          }),
        ]),
      });
      expect(isDocumentedRequest(backend + bootstrap, "GET", backend)).toBe(
        true,
      );
      expect(
        isDocumentedRequest(backend + writePaths[2], "POST", backend),
      ).toBe(false);
    });
  });
}
