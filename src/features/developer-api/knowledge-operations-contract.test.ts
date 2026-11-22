import { describe, expect, it } from "vitest";
import { z } from "zod";
import { internalInstallationBrand } from "../../lib/installation-brand";
import { portalOpenApi } from "./contract";

const backend = "https://portal.example.invalid";
const { paths } = portalOpenApi(backend);
const path = (name: string) => `/rest/v1/rpc/${name}`;
const operation = (name: string) =>
  paths[path(name)].post as {
    requestBody: {
      content: {
        "application/json": { schema: z.core.JSONSchema.JSONSchema };
      };
    };
    responses: Record<string, { description: string }>;
  };
const input = (name: string) =>
  z.fromJSONSchema(
    operation(name).requestBody.content["application/json"].schema,
  );
const id = "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca";

describe("scoped Wiki and Forum operations", () => {
  it("publishes stable native operation IDs only for the Internal edition", () => {
    const names = [
      "knowledge_categories",
      "save_knowledge_category",
      "wiki_pages_list",
      "manage_wiki_course_template",
      "forum_threads_list",
      "edit_forum_thread_metadata",
      "delete_forum_post",
      "moderate_forum_thread",
      "accept_forum_answer",
      "subscribe_forum_thread",
      "report_forum_post",
      "forum_reports",
      "resolve_forum_report",
    ];
    for (const download of [true, false]) {
      const internal = portalOpenApi(backend, download);
      const academy = (
        ["customer-managed", "customer-self-hosted"] as const
      ).map((edition) =>
        portalOpenApi(backend, download, {
          ...internalInstallationBrand,
          edition,
          installationId: id,
        }),
      );
      for (const name of names) {
        expect(internal.paths[path(name)].post).toMatchObject({
          operationId: `native_${name}`,
          tags: ["Knowledge"],
        });
        for (const document of academy)
          expect(document.paths).not.toHaveProperty(path(name));
      }
    }
  });

  it("accepts only documented filters and returns bounded, closed list rows", () => {
    const list = input("wiki_pages_list");
    expect(list.safeParse({}).success).toBe(true);
    expect(list.safeParse({ p_locale: "de", p_search: null }).success).toBe(
      true,
    );
    expect(list.safeParse({ p_locale: "fr" }).success).toBe(false);
    expect(list.safeParse({ p_user_id: id }).success).toBe(false);
    for (const name of [
      "wiki_pages_list",
      "forum_threads_list",
      "forum_reports",
    ])
      expect(operation(name).responses["200"]).toMatchObject({
        content: {
          "application/json": {
            schema: { maxItems: 200, items: { additionalProperties: false } },
          },
        },
      });
    expect(operation("forum_reports").responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: {
            items: {
              properties: {
                status: { enum: ["open", "resolved"] },
                created_at: { format: "date-time" },
              },
            },
          },
        },
      },
    });
  });

  it("describes omitted and nullable moderation flags and exact empty success statuses", () => {
    const moderation = input("moderate_forum_thread");
    expect(moderation.safeParse({ p_thread_id: id }).success).toBe(true);
    expect(
      moderation.safeParse({ p_thread_id: id, p_archived: null }).success,
    ).toBe(true);
    expect(moderation.safeParse({ p_archived: false }).success).toBe(false);
    for (const name of [
      "manage_wiki_course_template",
      "delete_forum_post",
      "moderate_forum_thread",
      "accept_forum_answer",
      "subscribe_forum_thread",
      "resolve_forum_report",
    ]) {
      const responses = operation(name).responses;
      expect(responses).toHaveProperty("204.description");
      expect(responses).not.toHaveProperty("200");
      expect(responses).not.toHaveProperty("204.content");
      expect(responses).toHaveProperty("403");
    }
    for (const [name, code] of [
      ["manage_wiki_course_template", "40001"],
      ["edit_forum_thread_metadata", "40001"],
      ["report_forum_post", "54000"],
    ])
      expect(operation(name).responses["500"].description).toContain(code);
  });
});
