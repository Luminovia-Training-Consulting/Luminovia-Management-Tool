import { describe, expect, it } from "vitest";
import { z } from "zod";
import { portalOpenApi } from "./contract";
import { courseBuildingBlockPaths } from "./course-building-block-contract";

const backend = "https://portal.example.invalid";
const id = "a9bfdb1a-5094-41ee-80db-faf7161a184a";
const prefix = "/rest/v1/rpc/";
const json = "application/json";
const operation = (name: string) =>
  courseBuildingBlockPaths[
    (prefix + name) as keyof typeof courseBuildingBlockPaths
  ].post;
const input = (name: string, body: object) =>
  z
    .fromJSONSchema(operation(name).requestBody.content[json].schema)
    .safeParse(body).success;

describe("course template and run-backed offer contracts", () => {
  it("keeps all four operations inside the existing authenticated REST role gates", () => {
    const paths = portalOpenApi(backend, false).paths;
    for (const name of Object.keys(courseBuildingBlockPaths)) {
      expect(paths[name].post).toMatchObject({
        "x-luminovia-rest-gate": {
          postgresRole: "authenticated",
          participantSession: false,
          guestSession: false,
        },
        responses: { "200": {}, "403": {} },
      });
    }
  });

  it("documents editable template fields separately from source provenance", () => {
    expect(
      input("save_course_template", {
        p_id: null,
        p_payload: { title: "Practice course" },
      }),
    ).toBe(true);
    expect(
      input("save_course_template", {
        p_id: id,
        p_payload: {
          title: "Practice course",
          topic_ids: [id],
          description: null,
          archived: false,
        },
      }),
    ).toBe(true);
    expect(
      input("save_course_template", {
        p_id: null,
        p_payload: { title: "Practice course", building_block_id: id },
      }),
    ).toBe(false);
    expect(
      input("save_course_template", {
        p_payload: { title: "Practice course" },
      }),
    ).toBe(false);
  });

  it("requires one reviewed source and an actor-bound client key with mutually exclusive pricing branches", () => {
    const fields = {
      source_revision: "b".repeat(64),
      currency: "EUR",
      rate_unit: "per_day",
      terms: "Fictional reviewed terms",
      status: "published",
    };
    const base = { p_course_run_id: id, p_client_id: id };
    const gross = {
      ...fields,
      gross_amount: 100.01,
      gross_total_amount: 300.03,
    };
    const net = { ...fields, amount: 50, total_amount: 150 };
    expect(input("create_course_run_job", { ...base, p_payload: gross })).toBe(
      true,
    );
    for (const [capacity, allowed] of [
      [1, true],
      [2, true],
      [20, true],
      [0, false],
      [2.5, false],
      [21, false],
      ["2", false],
    ]) {
      expect(
        input("create_course_run_job", {
          ...base,
          p_payload: { ...gross, capacity },
        }),
      ).toBe(allowed);
    }
    expect(
      input("create_course_run_job", {
        ...base,
        p_payload: net,
        p_platform_percent: 50,
      }),
    ).toBe(true);
    expect(
      input("create_course_run_job", {
        ...base,
        p_payload: gross,
        p_platform_percent: 50,
      }),
    ).toBe(true);
    expect(
      input("create_course_run_job", {
        ...base,
        p_payload: gross,
        p_platform_percent: 50.125,
      }),
    ).toBe(false);
    expect(
      input("create_course_run_job", {
        ...base,
        p_payload: { ...gross, ...net },
      }),
    ).toBe(false);
    expect(
      input("create_course_run_job", {
        ...base,
        p_payload: { ...gross, sessions: [] },
      }),
    ).toBe(false);
    expect(
      input("create_course_run_job", { p_course_run_id: id, p_payload: gross }),
    ).toBe(false);
    expect(
      input("create_course_run_job", {
        ...base,
        p_payload: { ...net, claim_deadline: "2039-01-01T07:00:00" },
      }),
    ).toBe(false);
    expect(
      operation("create_course_run_job").responses["400"].description,
    ).toContain("course_run_source_changed");
  });

  it("describes a complete preview with exact source sessions and paired provenance", () => {
    const payload = {
      source_revision: "b".repeat(64),
      course_run_id: id,
      template_id: id,
      building_block_id: null,
      building_block_source_id: null,
      title: "Practice",
      description: "",
      syllabus: "",
      prerequisites: "",
      organisation_id: null,
      customer_name: "",
      delivery_type: "onsite",
      location: "",
      time_zone: "Europe/Berlin",
      topic_ids: [],
      sessions: [
        {
          source_course_session_id: id,
          starts_at: "2039-01-01T07:00:00Z",
          ends_at: "2039-01-01T10:00:00Z",
        },
      ],
    };
    const schema = z.fromJSONSchema(
      operation("course_run_job_defaults").responses["200"].content[json]
        .schema,
    );
    expect(schema.safeParse(payload).success).toBe(true);
    expect(
      schema.safeParse({ ...payload, building_block_id: id }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...payload,
        building_block_id: id,
        building_block_source_id: id,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...payload, gross_amount: 99 }).success).toBe(
      false,
    );
    const reference = z.fromJSONSchema(
      operation("job_building_block_reference").responses["200"].content[json]
        .schema,
    );
    expect(reference.safeParse(null).success).toBe(true);
    expect(
      reference.safeParse({
        template_id: id,
        building_block_id: id,
        source_id: id,
      }).success,
    ).toBe(true);
  });
});
