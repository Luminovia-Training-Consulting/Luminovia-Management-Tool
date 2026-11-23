import { describe, expect, it, vi } from "vitest";
import {
  portalHttpActions,
  portalHttpMethods,
  portalHttpPutTargets,
  portalHttpPutVersions,
} from "../../../supabase/functions/_shared/portal-http-methods";
import { internalInstallationBrand } from "../../lib/installation-brand";
import { isDocumentedRequest, portalOpenApi } from "./contract";
import {
  authorizeDocumentedRequest,
  isAcademyExplorerRequest,
} from "./request-boundary";

const backend = "https://fictional.example.invalid/backend";
const aliasPrefix = "/functions/v1/portal-api/v1/";
const rpcPrefix = "/rest/v1/rpc/";
const run = "d1ce34b9-129f-4cea-9137-5d3e57b7f4d0";
const input = new URLSearchParams({
  input: JSON.stringify({ p_run_id: run }),
}).toString();
const academy = {
  ...internalInstallationBrand,
  edition: "customer-self-hosted" as const,
};

describe("Portal HTTP aliases", () => {
  it.each([
    ["internal", internalInstallationBrand],
    ["dedicated", academy],
  ])(
    "publishes the registered intersection of %s operations and preserves their RPC contracts",
    (_, brand) => {
      for (const includeNonInteractive of [true, false]) {
        const document = portalOpenApi(backend, includeNonInteractive, brand);
        const paths: Record<string, Record<string, unknown>> = document.paths;
        const expected = [
          ...Object.keys(portalHttpMethods),
          ...Object.keys(portalHttpActions),
        ]
          .filter((name) => {
            const operation = paths[rpcPrefix + name]?.post as
              | { requestBody?: unknown; "x-portal-document-only"?: boolean }
              | undefined;
            return (
              operation?.requestBody && !operation["x-portal-document-only"]
            );
          })
          .map((name) => aliasPrefix + name)
          .sort();
        const methods = new Set<string>();
        const aliases = Object.entries(paths).filter(([path]) =>
          path.startsWith(aliasPrefix),
        );

        expect(aliases.map(([path]) => path).sort()).toEqual(expected);
        for (const [path, item] of aliases) {
          const name = path.slice(aliasPrefix.length);
          const expectedMethods = Object.keys(
            portalHttpActions[name] ?? { [portalHttpMethods[name]]: true },
          ).map((method) => method.toLowerCase());
          expect(Object.keys(item)).toEqual(expectedMethods);
          for (const method of expectedMethods) {
            methods.add(method);
            expect(item[method]).toMatchObject({
              operationId: `http_${method}_${name}`,
              responses: (paths[rpcPrefix + name].post as { responses: object })
                .responses,
            });
          }
        }
        expect(methods).toEqual(new Set(["get", "put", "delete"]));
        expect(paths[rpcPrefix + "course_workspace"]).toHaveProperty("post");
      }
    },
  );

  it("publishes distinct update and removal branches while keeping the original POST", () => {
    const { paths } = portalOpenApi(backend);
    const route = aliasPrefix + "manage_wiki_attachment";
    for (const [method, remove] of [
      ["put", false],
      ["delete", true],
    ] as const) {
      expect(paths[route][method]).toMatchObject({
        requestBody: {
          content: {
            "application/json": {
              schema: {
                allOf: [
                  expect.any(Object),
                  expect.objectContaining({
                    required: ["p_remove"],
                    properties: { p_remove: { enum: [remove] } },
                  }),
                ],
              },
            },
          },
        },
      });
      expect(isDocumentedRequest(backend + route, method, backend)).toBe(true);
    }
    expect(paths[rpcPrefix + "manage_wiki_attachment"]).toHaveProperty("post");
    expect(isDocumentedRequest(backend + route, "GET", backend)).toBe(false);
  });

  it("omits the create-new example from calendar PUT", () => {
    const { paths } = portalOpenApi(backend);
    expect(paths[aliasPrefix + "manage_global_event"].put).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              allOf: [
                {
                  oneOf: [
                    expect.objectContaining({
                      properties: expect.objectContaining({
                        p_id: { type: "string", format: "uuid" },
                      }),
                    }),
                    expect.objectContaining({
                      properties: expect.objectContaining({
                        p_id: { type: "string", format: "uuid" },
                      }),
                    }),
                  ],
                },
                expect.any(Object),
              ],
            },
          },
        },
      },
    });
  });

  it("describes the GET JSON argument and requires an existing identifier for mixed PUT operations", () => {
    const { paths } = portalOpenApi(backend);
    const workspace = paths[aliasPrefix + "course_workspace"];
    const canonical = paths[rpcPrefix + "course_workspace"].post as {
      requestBody: { content: object };
    };
    expect(workspace.get).not.toHaveProperty("requestBody");
    expect(workspace.get).toHaveProperty("parameters", [
      {
        name: "input",
        in: "query",
        required: true,
        content: canonical.requestBody.content,
      },
    ]);
    expect(portalHttpPutTargets.save_course_run).toBe("p_id");
    expect(paths[aliasPrefix + "save_course_run"].put).toMatchObject({
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              allOf: [
                expect.any(Object),
                {
                  type: "object",
                  required: ["p_id"],
                  properties: { p_id: { type: "string", format: "uuid" } },
                },
              ],
            },
          },
        },
      },
    });
    expect(portalHttpPutVersions.save_job_view).toBe("p_expected_version");
    expect(paths[aliasPrefix + "save_job_view"].put).toMatchObject({
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              allOf: [
                expect.any(Object),
                expect.objectContaining({
                  required: expect.arrayContaining(["p_expected_version"]),
                  properties: expect.objectContaining({
                    p_expected_version: { type: "integer", minimum: 1 },
                  }),
                }),
              ],
            },
          },
        },
      },
    });
    expect(paths[aliasPrefix + "delete_forum_post"].delete).toMatchObject({
      requestBody: { required: true },
    });
  });

  it("accepts only the documented method and safe query shape on the exact backend", () => {
    const workspace = backend + aliasPrefix + "course_workspace";
    expect(isDocumentedRequest(workspace + "?" + input, "GET", backend)).toBe(
      true,
    );
    expect(isDocumentedRequest(workspace, "GET", backend)).toBe(true);
    for (const [url, method] of [
      [workspace + "?input=%5B%5D", "GET"],
      [workspace + "?input=%7B", "GET"],
      [workspace + "?" + input + "&input=%7B%7D", "GET"],
      [workspace + "?select=*", "GET"],
      [workspace + "#anything", "GET"],
      [workspace, "POST"],
      [workspace.replace("fictional.example", "other.example"), "GET"],
      [backend + aliasPrefix + "save_ui_preferences?input=%7B%7D", "PUT"],
      [backend + aliasPrefix + "delete_forum_post?input=%7B%7D", "DELETE"],
      [backend + aliasPrefix + "fictional_rpc", "GET"],
    ]) {
      expect(isDocumentedRequest(url, method, backend), url).toBe(false);
    }
    expect(
      isDocumentedRequest(
        backend + aliasPrefix + "save_ui_preferences",
        "PUT",
        backend,
      ),
    ).toBe(true);
    expect(
      isDocumentedRequest(
        backend + aliasPrefix + "delete_forum_post",
        "DELETE",
        backend,
      ),
    ).toBe(true);
  });

  it("authorizes dedicated calls through the live session and excludes internal operations", async () => {
    const { paths } = portalOpenApi(backend, false, academy);
    const request = {
      url: backend + aliasPrefix + "remove_course_exam_pdf",
      method: "DELETE",
    };
    expect(isAcademyExplorerRequest(request, backend, paths)).toBe(true);
    expect(
      isAcademyExplorerRequest(
        { ...request, url: backend + aliasPrefix + "delete_forum_post" },
        backend,
        paths,
      ),
    ).toBe(false);
    const session = vi.fn(async () => ({
      user: { id: "caller" },
      access_token: "fictional-token",
    }));
    await expect(
      authorizeDocumentedRequest(
        request,
        "publishable",
        "caller",
        session,
        isAcademyExplorerRequest(request, backend, paths),
      ),
    ).resolves.toMatchObject({
      ...request,
      headers: {
        apikey: "publishable",
        Authorization: "Bearer fictional-token",
      },
      redirect: "error",
    });
    expect(session).toHaveBeenCalledOnce();
  });
});
