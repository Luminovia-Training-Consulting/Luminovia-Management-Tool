import { describe, expect, it, vi } from "vitest";
import { accountOpenApi } from "../../../supabase/functions/accounts/openapi";
import { portalOpenApi } from "./contract";
import { authorizeExplorerRequest } from "./requests";

const backend = "https://portal.example.invalid/backend";
const who = { user: { id: "fictional" }, access_token: "test-token" };
const readMe = { url: backend + "/functions/v1/accounts/v1/me", method: "GET" };

describe("API explorer public document and session boundary", () => {
  it("reuses the deployed account operation contracts without exposing service-only RPCs", () => {
    const spec = portalOpenApi(backend + "/");
    expect(spec.servers).toEqual([{ url: backend }]);
    expect(spec.openapi).toBe("3.1.0");
    for (const [path, methods] of Object.entries(accountOpenApi.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(
          spec.paths["/functions/v1/accounts" + path][method],
        ).toMatchObject(operation);
      }
    }
    expect(spec.paths).not.toHaveProperty(
      "/rest/v1/rpc/claim_company_participant_invitation",
    );
  });

  it("documents the company key for servers without offering it in the session explorer", () => {
    const path = "/functions/v1/company-integration";
    expect(portalOpenApi(backend).paths[path].get).toMatchObject({
      security: [{ integrationKey: [] }],
    });
    expect(portalOpenApi(backend, false).paths).not.toHaveProperty(path);
    for (const credentials of ["human-login", "human-recovery"]) {
      const route = "/functions/v1/" + credentials;
      expect(portalOpenApi(backend).paths[route].post).toMatchObject({
        security: [],
      });
      expect(portalOpenApi(backend, false).paths).not.toHaveProperty(route);
    }
    expect(
      portalOpenApi(backend, false).components.securitySchemes,
    ).not.toHaveProperty("integrationKey");
  });

  it("adds fresh session credentials only to the configured resource", async () => {
    const request = await authorizeExplorerRequest(
      {
        ...readMe,
        headers: {
          cookie: "test",
          authorization: "stale",
          apikey: "other",
          "Accept-Profile": "unapproved",
          "CONTENT-PROFILE": "unapproved",
        },
      },
      backend,
      "publishable",
      "fictional",
      async () => who,
    );
    expect(request.headers).toEqual({
      apikey: "publishable",
      Authorization: "Bearer test-token",
    });
    expect(request).toMatchObject({ redirect: "error", credentials: "omit" });
  });

  it.each([
    {
      ...readMe,
      url: "https://different.example.invalid/backend/functions/v1/accounts/v1/me",
    },
    {
      ...readMe,
      url: backend.replace("/backend", "") + "/functions/v1/accounts/v1/me",
    },
    {
      ...readMe,
      url: backend + "/rest/v1/rpc/claim_company_participant_invitation",
      method: "POST",
    },
    {
      ...readMe,
      url: backend + "/rest/v1/profiles",
    },
    {
      ...readMe,
      url: backend + "/rest/v1/rpc/save_mail_configuration",
      method: "POST",
    },
    { ...readMe, method: "DELETE" },
    { ...readMe, url: backend + "/functions/v1/company-integration" },
    {
      ...readMe,
      url: backend + "/functions/v1/accounts/v1/users/not-a-uuid/status",
      method: "PATCH",
    },
  ])(
    "rejects unlisted URL or method before requesting credentials",
    async (request) => {
      const session = vi.fn(async () => who);
      await expect(
        authorizeExplorerRequest(
          request,
          backend,
          "publishable",
          "fictional",
          session,
        ),
      ).rejects.toThrow("api_request_destination_denied");
      expect(session).not.toHaveBeenCalled();
    },
  );

  it("stops when the original explorer user has signed out or switched accounts", async () => {
    for (const session of [null, { ...who, user: { id: "other" } }]) {
      await expect(
        authorizeExplorerRequest(
          readMe,
          backend,
          "publishable",
          "fictional",
          async () => session,
        ),
      ).rejects.toThrow("api_session_required");
    }
  });
});
