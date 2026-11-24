import { expect, it } from "vitest";
import { z } from "zod";
import { portalOpenApi } from "./contract";
import { internalInstallationBrand } from "../../lib/installation-brand";
import { learningProgramPaths } from "./learning-program-contract";

const base = "/rest/v1/rpc/";
const app = "https://portal.example.invalid";

it("lists typed learning programme operations and separates Academy write entitlement", () => {
  for (const edition of [
    "internal",
    "customer-managed",
    "customer-self-hosted",
  ] as const) {
    const document = portalOpenApi(app, false, {
      ...internalInstallationBrand,
      edition,
    });
    const paths: Record<string, Record<string, unknown>> = document.paths;
    for (const rpc of [
      "learning_programs",
      "save_learning_program",
      "enrol_learning_program",
      "start_learning_program_course",
    ]) {
      expect(paths[base + rpc].post).toMatchObject({
        "x-luminovia-rest-gate": {
          operationalSession: true,
          participantSession:
            rpc === "learning_programs" ||
            rpc === "start_learning_program_course",
          guestSession: false,
        },
        ...(edition === "internal"
          ? {}
          : {
              "x-portal-licence":
                rpc === "learning_programs" ? "active-or-grace" : "active",
            }),
      });
    }
    expect(paths[base + "learning_programs"].get).toMatchObject({
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: "p_program_id" }),
      ]),
      responses: {
        "200": {
          content: { "application/json": { schema: { type: "object" } } },
        },
      },
    });
  }
});

it("documents an exact saved scope and does not accept opaque course or actor data", () => {
  const request =
    learningProgramPaths()["/rest/v1/rpc/save_learning_program"].post
      .requestBody.content["application/json"].schema;
  const schema = z.fromJSONSchema(request);
  const correct = {
    p_program_id: "23e3ac26-57f8-4d41-9c6b-6d2bde23b3c9",
    p_organisation_id: "32e3ac26-57f8-4d41-9c6b-6d2bde23b3c9",
    p_title: "Fictional programme",
    p_description: "",
    p_sequential: true,
    p_course_ids: [
      "42e3ac26-57f8-4d41-9c6b-6d2bde23b3c9",
      "52e3ac26-57f8-4d41-9c6b-6d2bde23b3c9",
    ],
    p_archived: false,
    p_expected_version: 1,
  };
  expect(schema.safeParse(correct).success).toBe(true);
  expect(
    schema.safeParse({ ...correct, p_actor_id: correct.p_program_id }).success,
  ).toBe(false);
  expect(
    schema.safeParse({ ...correct, p_course_ids: [correct.p_program_id] })
      .success,
  ).toBe(false);
});
