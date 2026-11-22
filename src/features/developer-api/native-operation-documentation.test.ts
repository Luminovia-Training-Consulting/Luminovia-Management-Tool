/** Verify the published RPC descriptions keep the replayed transport and edition boundaries. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import catalogue from "../../../data/native-rpc.generated.json";
import { internalInstallationBrand } from "../../lib/installation-brand";
import { chatOperationDocumentation } from "./chat-operation-documentation";
import { commercialOperationDocumentation } from "./commercial-operation-documentation";
import { portalOpenApi } from "./contract";
import { knowledgeOperationDocumentation } from "./knowledge-operation-documentation";
import { operationsRpcDocumentation } from "./operations-rpc-documentation";

type Documentation = {
  summary: string;
  parameters?: Record<string, unknown>;
  required?: readonly string[];
  result?: unknown;
};
type Operation = {
  operationId: string;
  description: string;
  requestBody: {
    content: {
      "application/json": { schema: z.core.JSONSchema.JSONSchema };
    };
  };
  responses: Record<string, { description: string; content?: unknown }>;
  "x-luminovia-rest-gate": {
    postgresRole: string;
    operationalSession: boolean;
    participantSession: boolean;
    guestSession: boolean;
  };
};

const backend = "https://portal.example.invalid/backend";
const id = "21d62545-1673-41e8-bab9-15a7957ddb73";
const path = (name: string) => `/rest/v1/rpc/${name}`;
const definitions: [string, Documentation][] = [
  ...Object.entries(chatOperationDocumentation),
  ...Object.entries(commercialOperationDocumentation),
  ...Object.entries(knowledgeOperationDocumentation),
  ...Object.entries(operationsRpcDocumentation),
];
const native = catalogue as Record<
  string,
  {
    participant: boolean;
    guest: boolean;
    overloads: {
      request: { properties: Record<string, unknown>; required: string[] };
      void?: boolean;
    }[];
  }
>;
const internal = portalOpenApi(backend);
const operation = (name: string) =>
  internal.paths[path(name)].post as Operation;
const input = (name: string) =>
  z.fromJSONSchema(
    operation(name).requestBody.content["application/json"].schema,
  );

describe("internal operation documentation", () => {
  it("covers the 63 former generic operations in both published documents", () => {
    expect(new Set(definitions.map(([name]) => name)).size).toBe(63);
    expect(definitions).toHaveLength(63);
    for (const includeNonInteractive of [true, false]) {
      const document = portalOpenApi(backend, includeNonInteractive);
      const generic = Object.entries(document.paths).filter(([, methods]) =>
        Object.values(methods).some(
          (method) =>
            typeof method === "object" &&
            method !== null &&
            "description" in method &&
            typeof method.description === "string" &&
            method.description.startsWith("Native PostgREST operation used"),
        ),
      );
      expect(generic.map(([name]) => name)).toEqual([]);
      for (const [name, documentation] of definitions) {
        const entry = native[name];
        expect(entry, name).toBeDefined();
        const current = document.paths[path(name)].post as Operation;
        expect(current).toMatchObject({
          operationId: `native_${name}`,
          "x-luminovia-rest-gate": {
            postgresRole: "authenticated",
            operationalSession: true,
            participantSession: entry.participant,
            guestSession: entry.guest,
          },
        });
        const availableParameters = entry.overloads.flatMap(({ request }) =>
          Object.keys(request.properties),
        );
        for (const key of [
          ...Object.keys(documentation.parameters ?? {}),
          ...(documentation.required ?? []),
        ]) {
          expect(availableParameters, name).toContain(key);
        }
        expect(Boolean(current.responses["204"]), name).toBe(
          entry.overloads.some((overload) => overload.void),
        );
        expect(Boolean(current.responses["200"]), name).toBe(
          entry.overloads.some((overload) => !overload.void),
        );
        if (documentation.result)
          expect(current.responses["200"].content, name).toBeDefined();
      }
    }
  });

  it("keeps actual assignment constraints and response states visible", () => {
    const capacity = {
      p_job_id: id,
      p_capacity: 2,
      p_expected_version: 1,
      p_request_id: id,
    };
    expect(input("set_job_capacity").safeParse(capacity).success).toBe(true);
    expect(
      input("set_job_capacity").safeParse({ ...capacity, p_capacity: 21 })
        .success,
    ).toBe(false);
    expect(
      operation("set_job_capacity").responses["500"].description,
    ).toContain("40001");
    expect(
      operation("cancel_client_request").responses["204"].content,
    ).toBeUndefined();
    const publish = input("publish_client_request");
    expect(publish.safeParse({ p_request_id: id }).success).toBe(true);
    expect(
      publish.safeParse({ p_request_id: id, p_platform_percent: 25 }).success,
    ).toBe(false);
  });

  it("requires the contract registration request ID even with a legacy SQL default", () => {
    const registration = input("register_executed_contract");
    const document = {
      p_user_id: id,
      p_title: "Fictional signed agreement",
      p_document_version_id: id,
      p_effective_from: "2030-05-06T10:00:00Z",
      p_expires_at: null,
    };
    expect(registration.safeParse(document).success).toBe(false);
    expect(
      registration.safeParse({ ...document, p_client_id: id }).success,
    ).toBe(true);
  });

  it("keeps internal commerce and activation routes out of Academy documents", () => {
    for (const edition of [
      "customer-managed",
      "customer-self-hosted",
    ] as const) {
      const academy = portalOpenApi(backend, true, {
        ...internalInstallationBrand,
        edition,
        installationId: id,
      });
      for (const name of [
        "publish_client_request",
        "set_job_capacity",
        "set_job_commission",
        "register_executed_contract",
        "set_user_active",
      ]) {
        expect(academy.paths).not.toHaveProperty(path(name));
      }
    }
  });
});
