import { describe, expect, it } from "vitest";
import { z } from "zod";
import { portalOpenApi } from "./contract";
import { fileDiscoveryPaths } from "./file-discovery-contract";

const backend = "https://portal.example.invalid";
const prefix = "/rest/v1/rpc/";
const json = "application/json";
const id = "a9bfdb1a-5094-41ee-80db-faf7161a184a";
const instant = "2041-01-01T00:00:00+00:00";
const operation = (name: string) =>
  fileDiscoveryPaths[(prefix + name) as keyof typeof fileDiscoveryPaths].post;
const accepts = (name: string, body: object) =>
  z
    .fromJSONSchema(operation(name).requestBody.content[json].schema)
    .safeParse(body).success;

const responseValidator = (name: string) => {
  const responses = operation(name).responses;
  if (!("200" in responses) || !responses["200"])
    throw new Error("Missing documented JSON response for " + name);
  return z.fromJSONSchema(responses["200"].content[json].schema);
};

describe("internal file discovery and own file administration", () => {
  it("retains existing authenticated role gates and scoped bodyless write confirmations", () => {
    const paths = portalOpenApi(backend, false).paths;
    for (const path of Object.keys(fileDiscoveryPaths)) {
      expect(paths[path].post).toMatchObject({
        "x-luminovia-rest-gate": {
          postgresRole: "authenticated",
          participantSession: false,
          guestSession: false,
        },
      });
    }
    for (const name of ["rename_document", "restore_personal_material"]) {
      expect(operation(name).responses).toHaveProperty("204");
      expect(operation(name).responses).not.toHaveProperty("200");
    }
    expect(paths).not.toHaveProperty("/rest/v1/documents");
    expect(paths).not.toHaveProperty("/rest/v1/document_versions");
  });

  it("describes cursor pairs, existing filter limits and required write fields", () => {
    for (const name of ["document_discovery", "archived_personal_materials"]) {
      expect(accepts(name, {})).toBe(true);
      expect(accepts(name, { p_before_at: instant, p_before_id: id })).toBe(
        true,
      );
      expect(accepts(name, { p_before_at: instant })).toBe(false);
    }
    expect(
      accepts("document_discovery", {
        p_limit: 100,
        p_folder: null,
        p_kind: "avatar",
      }),
    ).toBe(true);
    expect(accepts("document_discovery", { p_limit: 101 })).toBe(false);
    expect(accepts("archived_personal_materials", { p_limit: 51 })).toBe(false);
    expect(
      accepts("save_document_organisation", {
        p_document_id: id,
        p_expected_version: 0,
        p_payload: { tags: ["Practice"], folder: "Training files" },
      }),
    ).toBe(true);
    expect(
      accepts("save_document_organisation", {
        p_document_id: id,
        p_expected_version: 0,
        p_payload: { tags: [], folder: "", user_id: id },
      }),
    ).toBe(false);
    expect(
      accepts("rename_document", { p_id: id, p_name: "Nested/filename.txt" }),
    ).toBe(false);
    expect(
      operation("save_document_organisation").responses["409"],
    ).toMatchObject({
      content: {
        [json]: { schema: { properties: { code: { const: "PT409" } } } },
      },
    });
  });

  it("describes the exact file and archive projections without exposing storage or scanning credentials", () => {
    const row = {
      id,
      owner_id: id,
      uploaded_by: id,
      scope: "personal",
      kind: "material",
      room_id: null,
      job_id: null,
      original_name: "Practice.txt",
      mime_type: "text/plain",
      size_bytes: 12,
      status: "clean",
      client_id: id,
      message_only: false,
      current_version_id: id,
      created_at: instant,
      deleted_at: null,
      personal_tags: [],
      personal_folder: "",
      personal_version: 0,
    };
    const spec = portalOpenApi(backend).paths;
    expect(spec[prefix + "document_discovery"].post).toMatchObject({
      responses: {
        "200": {
          content: { [json]: { schema: { oneOf: expect.any(Array) } } },
        },
      },
    });
    const discovery = responseValidator("document_discovery");
    expect(
      discovery.safeParse({ items: [row], has_more: false, next_cursor: null })
        .success,
    ).toBe(true);
    expect(
      discovery.safeParse({ items: [row], has_more: true, next_cursor: null })
        .success,
    ).toBe(false);
    for (const field of [
      "object_path",
      "sha256",
      "scanner_version",
      "service_role_key",
    ]) {
      expect(
        discovery.safeParse({
          items: [{ ...row, [field]: "fictional" }],
          has_more: false,
          next_cursor: null,
        }).success,
      ).toBe(false);
    }
    const archived = responseValidator("archived_personal_materials");
    expect(
      archived.safeParse([
        { id, original_name: "Practice.txt", archived_at: instant },
      ]).success,
    ).toBe(true);
    expect(
      archived.safeParse([
        {
          id,
          original_name: "Practice.txt",
          archived_at: instant,
          owner_id: id,
        },
      ]).success,
    ).toBe(false);
  });
});
