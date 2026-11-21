import { describe, expect, it } from "vitest";
import { z } from "zod";
import { enquiriesSupportPaths } from "./enquiries-support-contract";
import { portalOpenApi } from "./contract";

const backend = "https://portal.example.invalid";
const uuid = "a9bfdb1a-5094-41ee-80db-faf7161a184a";
const request = { p_request_id: uuid, p_expected_version: 1 };
const json = "application/json";
const method = (name: string) =>
  enquiriesSupportPaths[
    ("/rest/v1/rpc/" + name) as keyof typeof enquiriesSupportPaths
  ].post;
const accepts = (name: string, body: object) =>
  z
    .fromJSONSchema(method(name).requestBody.content[json].schema)
    .safeParse(body).success;

describe("institution enquiry and support OpenAPI", () => {
  it("keeps role gates on all nine reviewed routes and the private Website intake off the portal surface", () => {
    const expected = Object.keys(enquiriesSupportPaths);
    expect(expected).toHaveLength(9);
    for (const download of [true, false]) {
      const { paths } = portalOpenApi(backend, download);
      for (const path of expected) {
        expect(paths[path].post).toMatchObject({
          "x-luminovia-rest-gate": {
            postgresRole: "authenticated",
            operationalSession: true,
            participantSession: false,
            guestSession: false,
          },
          responses: { "200": {}, "403": {} },
        });
      }
      expect(paths).not.toHaveProperty("/rest/v1/rpc/receive_website_enquiry");
    }
  });

  it.each(["enquiry_inbox", "support_tickets"])(
    "%s requires both cursor values when paging",
    (name) => {
      const page = {
        p_before_at: "2041-01-01T00:00:00+00:00",
        p_before_id: uuid,
      };
      expect(accepts(name, {})).toBe(true);
      expect(accepts(name, page)).toBe(true);
      expect(accepts(name, { p_before_at: page.p_before_at })).toBe(false);
      expect(accepts(name, { p_before_id: page.p_before_id })).toBe(false);
      expect(accepts(name, { p_limit: 101 })).toBe(false);
    },
  );

  it("validates enquiry action-specific payloads without accepting intake operations", () => {
    const base = { ...request, p_enquiry_id: uuid };
    expect(
      accepts("manage_enquiry", {
        ...base,
        p_action: "note",
        p_payload: { note: "Fictional history" },
      }),
    ).toBe(true);
    expect(
      accepts("manage_enquiry", {
        ...base,
        p_action: "note",
        p_payload: { reason: "Foreign field" },
      }),
    ).toBe(false);
    expect(
      accepts("manage_enquiry", {
        ...base,
        p_action: "create_customer",
        p_payload: {},
      }),
    ).toBe(true);
    expect(
      accepts("manage_enquiry", {
        ...base,
        p_action: "convert",
        p_payload: {
          delivery_type: "online",
          time_zone: "Europe/Berlin",
          sessions: [],
        },
      }),
    ).toBe(false);
  });

  it("retains bounded support creation, exact attachment input and the observed conflict and budget responses", () => {
    expect(
      accepts("create_support_ticket", {
        p_request_id: uuid,
        p_payload: {
          title: "Fictional",
          description: "Example support",
          category: "technical",
        },
      }),
    ).toBe(true);
    const base = { ...request, p_ticket_id: uuid, p_action: "attach" };
    expect(
      accepts("update_support_ticket", {
        ...base,
        p_payload: { document_id: uuid, internal: false },
      }),
    ).toBe(true);
    expect(
      accepts("update_support_ticket", {
        ...base,
        p_payload: { version_id: uuid, internal: false },
      }),
    ).toBe(false);
    expect(method("update_support_ticket").responses).toMatchObject({
      "409": {
        content: {
          [json]: { schema: { properties: { code: { const: "PT409" } } } },
        },
      },
      "500": {
        content: {
          [json]: { schema: { properties: { code: { const: "54000" } } } },
        },
      },
    });
  });

  it("keeps template choices and support reports scoped to current capabilities", () => {
    const choice = { id: uuid, label: "Fictional" };
    const enquiry = z.fromJSONSchema(
      method("enquiry_context").responses["200"].content[json].schema,
    );
    expect(
      enquiry.safeParse({
        can_convert: false,
        organisations: [],
        staff: [],
        templates: [choice],
      }).success,
    ).toBe(false);
    const support = z.fromJSONSchema(
      method("support_context").responses["200"].content[json].schema,
    );
    const context = {
      can_manage: false,
      courses: [],
      claims: [],
      organisations: [],
      report: [],
      staff: [],
    };
    expect(support.safeParse(context).success).toBe(true);
    expect(
      support.safeParse({
        ...context,
        staff: [{ id: uuid, name: "Fictional" }],
      }).success,
    ).toBe(false);
  });
});
