import { describe, expect, it } from "vitest";
import { z } from "zod";
import { internalInstallationBrand } from "../../lib/installation-brand";
import { defaultDashboardPreferences } from "../dashboard/personal-schema";
import { portalOpenApi } from "./contract";
import { personalPreferencesPaths } from "./personal-preferences-contract";

const backend = "https://portal.example.invalid";
const prefix = "/rest/v1/rpc/";
const json = "application/json";
const operation = (name: string) =>
  personalPreferencesPaths[
    (prefix + name) as keyof typeof personalPreferencesPaths
  ].post;
const request = (name: string) =>
  z.fromJSONSchema(operation(name).requestBody.content[json].schema);
const response = (name: string) =>
  z.fromJSONSchema(operation(name).responses["200"].content[json].schema);

describe("internal account preference contracts", () => {
  it("keeps the verified internal role scopes and advertises no dedicated operation", () => {
    const explorer = portalOpenApi(backend, false).paths;
    const download = portalOpenApi(backend, true).paths;
    for (const path of Object.keys(personalPreferencesPaths)) {
      const presentation = path.endsWith("ui_preferences");
      expect(explorer[path].post).toMatchObject({
        "x-luminovia-rest-gate": {
          postgresRole: "authenticated",
          operationalSession: true,
          participantSession: presentation,
          guestSession: presentation,
        },
      });
      expect(download[path]).toEqual(explorer[path]);
      for (const edition of [
        "customer-self-hosted",
        "customer-managed",
      ] as const) {
        const brand = { ...internalInstallationBrand, edition };
        expect(portalOpenApi(backend, true, brand).paths).not.toHaveProperty(
          path,
        );
      }
    }
    for (const name of [
      "ui_preferences",
      "get_welcome_progress",
      "dashboard_preferences",
    ]) {
      expect(operation(name).requestBody.required).toBe(false);
      expect(request(name).safeParse({}).success).toBe(true);
      expect(request(name).safeParse({ p_user_id: "other" }).success).toBe(
        false,
      );
    }
  });

  it("describes nonempty partial UI settings and exact language and appearance values", () => {
    const input = request("save_ui_preferences");
    for (const p_patch of [
      { language: "en" },
      { language: "de", theme: "system", sidebar_collapsed: false },
      { theme: "dark", sidebar_collapsed: true },
    ]) {
      expect(input.safeParse({ p_patch }).success).toBe(true);
    }
    for (const p_patch of [
      {},
      null,
      { language: "en-GB" },
      { theme: null },
      { sidebar_collapsed: "true" },
      { user_id: "other", theme: "dark" },
      { version: 0, theme: "dark" },
    ]) {
      expect(input.safeParse({ p_patch }).success).toBe(false);
    }
    expect(operation("save_ui_preferences").responses).not.toHaveProperty(
      "409",
    );
  });

  it("describes the exact versioned writes including widget uniqueness and stale responses", () => {
    const welcome = request("save_welcome_progress");
    const progress = {
      p_step: "finish",
      p_status: "completed",
      p_expected_version: 0,
    };
    expect(welcome.safeParse(progress).success).toBe(true);
    for (const invalid of [
      { p_step: "security" },
      { p_status: "unknown" },
      { p_expected_version: -1 },
      { p_expected_version: 2147483647 },
      { p_expected_version: null },
    ]) {
      expect(welcome.safeParse({ ...progress, ...invalid }).success).toBe(
        false,
      );
    }

    const { version, ...p_payload } = defaultDashboardPreferences;
    const dashboard = request("save_dashboard_preferences");
    const args = { p_payload, p_expected_version: version };
    expect(dashboard.safeParse(args).success).toBe(true);
    for (const invalid of [
      { widget_order: Array(5).fill("files") },
      { widget_order: p_payload.widget_order.slice(1) },
      { hidden_widgets: ["files", "files"] },
      { hidden_widgets: ["finance"] },
      { user_id: "other" },
    ]) {
      expect(
        dashboard.safeParse({
          ...args,
          p_payload: { ...p_payload, ...invalid },
        }).success,
      ).toBe(false);
    }
    for (const name of [
      "save_welcome_progress",
      "save_dashboard_preferences",
    ]) {
      expect(operation(name).responses).toMatchObject({
        "409": {
          content: {
            [json]: { schema: { properties: { code: { const: "PT409" } } } },
          },
        },
      });
    }
  });

  it("accepts exact own settings and excludes other account or business fields", () => {
    const preferences = {
      language: "de",
      theme: "system",
      sidebar_collapsed: false,
      version: 0,
    };
    const cases = {
      ui_preferences: preferences,
      save_ui_preferences: { ...preferences, theme: "light", version: 1 },
      get_welcome_progress: { step: "welcome", status: "active", version: 0 },
      save_welcome_progress: {
        step: "finish",
        status: "completed",
        version: 1,
      },
      dashboard_preferences: defaultDashboardPreferences,
      save_dashboard_preferences: {
        ...defaultDashboardPreferences,
        version: 1,
      },
    };
    for (const [name, expected] of Object.entries(cases)) {
      const decoder = response(name);
      expect(decoder.safeParse(expected).success).toBe(true);
      for (const field of [
        "user_id",
        "email",
        "permissions",
        "organisation_id",
      ]) {
        expect(
          decoder.safeParse({ ...expected, [field]: "private" }).success,
        ).toBe(false);
      }
    }
  });
});
