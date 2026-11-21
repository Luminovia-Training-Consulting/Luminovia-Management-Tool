import { describe, expect, it, vi } from "vitest";
import { accountOpenApi } from "../../../supabase/functions/accounts/openapi";
import { internalInstallationBrand } from "../../lib/installation-brand";
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

for (const edition of ["customer-self-hosted", "customer-managed"] as const) {
  const brand = {
    ...internalInstallationBrand,
    edition,
    name: "Example Academy",
    installationId: "d5e294ee-9126-4110-af6f-7c641c5c4d10",
  };
  describe(`${edition} API explorer boundary`, () => {
    const workspace = "/rest/v1/rpc/course_workspace";
    const download = portalOpenApi(backend, true, brand);
    const interactive = portalOpenApi(backend, false, brand);

    it("renders the exact branded RPC operations and leaves Edge operations in the download", () => {
      expect(interactive.info).toEqual(download.info);
      expect(interactive).toMatchObject({
        "x-portal-installation": {
          installation_id: brand.installationId,
          edition,
          customer_ready: false,
        },
      });
      const rpcPaths = Object.fromEntries(
        Object.entries(download.paths).filter(([path]) =>
          path.startsWith("/rest/v1/rpc/"),
        ),
      );
      expect(interactive.paths).toEqual(rpcPaths);
      expect(interactive.paths).toHaveProperty(workspace);
      expect(interactive.paths).not.toHaveProperty(
        "/rest/v1/rpc/job_discovery",
      );
      for (const path of [
        "/functions/v1/accounts/v1/academy/users",
        "/functions/v1/files",
        "/functions/v1/course-documents",
      ]) {
        expect(download.paths).toHaveProperty(path);
        expect(interactive.paths).not.toHaveProperty(path);
      }
    });

    it("binds a fresh account token, method and relative RPC to the configured backend prefix", async () => {
      const request = await authorizeExplorerRequest(
        {
          url: workspace.slice(1),
          method: "POST",
          headers: {
            Authorization: "stale-token",
            cookie: "fixture",
            "Content-Profile": "private",
            "X-HTTP-Method-Override": "GET",
            "Content-Type": "application/json",
          },
        },
        backend + "/",
        "publishable",
        who.user.id,
        async () => who,
        brand,
      );
      expect(request).toMatchObject({
        url: backend + workspace,
        headers: {
          "Content-Type": "application/json",
          apikey: "publishable",
          Authorization: "Bearer test-token",
        },
        credentials: "omit",
        redirect: "error",
      });
      expect(Object.keys(request.headers ?? {}).sort()).toEqual(
        ["Authorization", "Content-Type", "apikey"].sort(),
      );
    });

    it.each([
      { url: backend + workspace, method: "GET" },
      { url: backend + workspace + "?select=*", method: "POST" },
      { url: backend + workspace + "#result", method: "POST" },
      { url: backend + "/rest/v1/course_runs", method: "GET" },
      { url: backend + "/rest/v1/rpc/job_discovery", method: "POST" },
      {
        url: backend + "/rest/v1/rpc/reserve_academy_attendance_pdf",
        method: "POST",
      },
      {
        url: backend + "/functions/v1/accounts/v1/academy/users",
        method: "POST",
      },
      {
        url: backend + "/functions/v1/files?mode=academy-attendance",
        method: "POST",
      },
      { url: backend + "/functions/v1/course-documents", method: "POST" },
      {
        url: "https://different.example.invalid/backend" + workspace,
        method: "POST",
      },
      {
        url: "https://guest@portal.example.invalid/backend" + workspace,
        method: "POST",
      },
      { url: "https://portal.example.invalid" + workspace, method: "POST" },
    ])(
      "rejects a request outside the academy contract before reading its token",
      async (request) => {
        const session = vi.fn(async () => who);
        await expect(
          authorizeExplorerRequest(
            request,
            backend,
            "publishable",
            who.user.id,
            session,
            brand,
          ),
        ).rejects.toThrow("api_request_destination_denied");
        expect(session).not.toHaveBeenCalled();
      },
    );

    it("does not reuse the user's opt-in with another current session", async () => {
      await expect(
        authorizeExplorerRequest(
          { url: backend + workspace, method: "POST" },
          backend,
          "publishable",
          who.user.id,
          async () => ({ ...who, user: { id: "another-user" } }),
          brand,
        ),
      ).rejects.toThrow("api_session_required");
    });
  });
}
