import { describe, expect, it } from "vitest";
import { internalInstallationBrand } from "../../lib/installation-brand";
import { academyOpenApi } from "./academy-contract";
import { isDocumentedRequest, portalOpenApi } from "./contract";

const backend = "https://academy.example.invalid/backend";
const id = "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca";
const readPaths = [
  "/rest/v1/rpc/my_course_workspaces",
  "/rest/v1/rpc/course_workspace",
  "/rest/v1/rpc/course_welcome_content",
  "/rest/v1/rpc/course_chat_rooms",
  "/rest/v1/rpc/course_chat_messages",
  "/rest/v1/rpc/course_session_register",
  "/rest/v1/rpc/notification_inbox",
  "/rest/v1/rpc/academy_course_publication",
  "/rest/v1/rpc/academy_timetable",
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
  "/rest/v1/rpc/academy_publish_course",
  "/rest/v1/rpc/academy_learning_action",
  "/rest/v1/rpc/remove_course_exam_pdf",
] as const;
const bootstrap = "/rest/v1/rpc/installation_capabilities";
const upload = "/functions/v1/files";
const examDownload = "/functions/v1/course-documents";
const attendanceImport = "/rest/v1/rpc/import_course_session_attendance";
const administrationPaths = [
  "/rest/v1/rpc/academy_administration",
  "/rest/v1/rpc/academy_create_organisation",
  "/functions/v1/accounts/v1/academy/users",
] as const;
const draftPaths = [
  "/rest/v1/rpc/academy_course_draft_options",
  "/rest/v1/rpc/academy_create_course_draft",
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
      expect(Object.keys(spec.paths).sort()).toEqual(
        [
          bootstrap,
          upload,
          examDownload,
          ...administrationPaths,
          attendanceImport,
          ...readPaths,
          ...writePaths,
          ...draftPaths,
        ].sort(),
      );
      expect(spec).not.toHaveProperty("webhooks");
      expect(Object.keys(spec.components.securitySchemes).sort()).toEqual([
        "apiKey",
        "bearerAuth",
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

    it("describes read-only grace, version conflicts and empty attendance attachments", () => {
      const read = spec.paths[readPaths[5]].post;
      expect(read["x-portal-licence"]).toBe("active-or-grace");
      expect(
        read.responses["200"].content["application/json"].schema,
      ).toMatchObject({
        properties: { evidence: { maxItems: 0 } },
      });
      const save = spec.paths[writePaths[5]].post;
      expect(save["x-portal-licence"]).toBe("active");
      expect(save.responses).toHaveProperty("409");
      expect(save.requestBody.content["application/json"].schema).toMatchObject(
        {
          required: expect.arrayContaining(["p_expected_version"]),
        },
      );
      expect(spec.paths).not.toHaveProperty(
        "/rest/v1/rpc/attach_course_session_evidence",
      );
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
              ],
            },
          },
        ]),
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                additionalProperties: false,
                required: ["academy_course_id", "client_id", "file"],
                properties: { file: { format: "binary" } },
              },
            },
          },
        },
      });
      expect(
        intake.responses["200"].content["application/json"].schema,
      ).toMatchObject({
        properties: {
          document: {
            properties: {
              status: { const: "clean" },
              current_version_id: { format: "uuid" },
            },
          },
        },
      });
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
        "/rest/v1/rpc/reserve_academy_student_exam_pdf",
        "/rest/v1/rpc/reserve_academy_answer_key_pdf",
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
          properties: { attachment: { type: "null" } },
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
      expect(isDocumentedRequest(backend + bootstrap, "GET", backend)).toBe(
        true,
      );
      expect(
        isDocumentedRequest(backend + writePaths[2], "POST", backend),
      ).toBe(false);
    });
  });
}
