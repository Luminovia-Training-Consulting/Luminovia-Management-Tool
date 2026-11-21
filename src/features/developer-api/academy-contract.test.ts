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
] as const;
const writePaths = [
  "/rest/v1/rpc/set_course_meeting_link",
  "/rest/v1/rpc/publish_course_welcome_content",
  "/rest/v1/rpc/academy_ensure_course_chat",
  "/rest/v1/rpc/send_course_chat_message",
] as const;
const bootstrap = "/rest/v1/rpc/installation_capabilities";

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
        [bootstrap, ...readPaths, ...writePaths].sort(),
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
        false,
      );
      expect(
        isDocumentedRequest(backend + writePaths[2], "POST", backend),
      ).toBe(false);
    });
  });
}
