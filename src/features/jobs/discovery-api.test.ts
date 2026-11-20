/** DTO and paging regressions ensure restricted/current quotes are not replaced by zero or another account context. */
import { describe, it, expect } from "vitest";
import {
  defaultJobFilters,
  filtersFromParams,
  filterParams,
  filterDraftFromParams,
  jobFiltersSchema,
  discoveryPageSchema,
  jobDiscoveryQuery,
  jobDetailQuery,
  assignmentCalendarMetadataQuery,
  assignmentCalendarMetadataSchema,
} from "./discovery-api";
describe("discovery data contracts", () => {
  it("keeps accepted calendar metadata actor scoped and separate from legacy title reads", () => {
    const first = "d7000000-0000-4000-8000-000000000001",
      second = "d7000000-0000-4000-8000-000000000002";
    expect(
      assignmentCalendarMetadataQuery("actor-a", [first, second, first])
        .queryKey,
    ).toEqual(
      assignmentCalendarMetadataQuery("actor-a", [second, first]).queryKey,
    );
    expect(
      assignmentCalendarMetadataQuery("actor-a", [first]).queryKey,
    ).not.toEqual(assignmentCalendarMetadataQuery("actor-b", [first]).queryKey);
    expect(assignmentCalendarMetadataQuery("actor-a", []).enabled).toBe(false);
    const metadata = {
      id: first,
      title: "Accepted course",
      organisation_id: null,
      organisation_name: "Manual customer",
      topics: [{ id: second, label_de: "Thema", label_en: "Topic" }],
      amount: 999,
    };
    expect(
      assignmentCalendarMetadataSchema.parse([metadata])[0],
    ).not.toHaveProperty("amount");
    expect(
      assignmentCalendarMetadataSchema.safeParse([
        { ...metadata, organisation_id: "browser-role" },
      ]).success,
    ).toBe(false);
    expect(
      assignmentCalendarMetadataSchema.safeParse([
        { ...metadata, topics: [{ id: second, label_de: "Thema" }] },
      ]).success,
    ).toBe(false);
  });

  it("preserves a restricted null quote while rejecting coerced strings and resetting known role pages", () => {
    const item = {
      id: "d7000000-0000-4000-8000-000000000001",
      title: "Fictional quote",
      description: "",
      customer_name: "Fictional",
      delivery_type: "online",
      location: "",
      time_zone: "Europe/Berlin",
      status: "published",
      amount: null,
      total_amount: null,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Fictional",
      terms_version: 31,
      requires_contract: false,
      claim_deadline: null,
      capacity: 1,
      capacity_basis: "single_position",
      created_at: "2099-01-01T00:00:00Z",
      job_sessions: [],
      job_requirements: [],
      confirmed_count: 0,
      open_positions: 1,
    };
    const page = {
      items: [item],
      has_more: false,
      next_cursor: null,
      as_of: "2099-01-01T00:00:00Z",
      filters: defaultJobFilters,
    };
    expect(discoveryPageSchema.parse(page).items[0].total_amount).toBeNull();
    for (const invalid of ["0", "", undefined, true, [], {}, -1, Infinity, NaN])
      expect(
        discoveryPageSchema.safeParse({
          ...page,
          items: [{ ...item, amount: invalid, total_amount: invalid }],
        }).success,
      ).toBe(false);
    expect(
      discoveryPageSchema.parse({
        ...page,
        items: [{ ...item, amount: 0, total_amount: 0 }],
      }).items[0].total_amount,
    ).toBe(0);
    expect(
      jobDiscoveryQuery("same-account", defaultJobFilters, "lecturer").queryKey,
    ).not.toEqual(
      jobDiscoveryQuery("same-account", defaultJobFilters, "senior_lecturer")
        .queryKey,
    );
  });
    it("round trips deep links with OR topics and explicit history opt-in", () => {
    const filters = jobFiltersSchema.parse({
      q: "literal %_ <script>",
      customer: "Fictional [office]",
        topic_ids: [
            "d7000000-0000-4000-8000-000000000001",
            "d7000000-0000-4000-8000-000000000002",
        ],
      from: "2060-01-02",
      to: "2060-01-10",
      zone: "Australia/Brisbane",
      currency: "AUD",
      unit: "per_hour",
      min_rate: 25.01,
      max_total: 100,
      sort: "rate_desc",
      available_only: true,
        include_history: true,
    });
        const params = filterParams(filters);
        expect(params.getAll("topic")).toEqual(filters.topic_ids);
        expect(params.get("history")).toBe("1");
        expect(filtersFromParams(params)).toMatchObject({
      success: true,
      data: filters,
    });
  });
    it("defaults the open marketplace to upcoming offers without historical records", () => {
        expect(jobFiltersSchema.parse({})).toMatchObject({
            sort: "soonest",
            include_history: false,
        });
        expect(defaultJobFilters.sort).toBe("soonest");
        expect(defaultJobFilters.include_history).toBe(false);
        expect(filterParams(defaultJobFilters).has("history")).toBe(false);
    });
  it("supports old minimum-total URLs only with explicit currency and rejects invalid meaningful combinations", () => {
    expect(filterDraftFromParams(new URLSearchParams("min=100"))).toMatchObject(
      { min_total: 100, currency: "" },
    );
    expect(
      filtersFromParams(new URLSearchParams("min=100&currency=EUR")),
    ).toMatchObject({
      success: true,
      data: { min_total: 100, currency: "EUR" },
    });
    for (const input of [
      { min_total: 1 },
      { sort: "total_asc" },
      { currency: "AUD", sort: "rate_desc" },
      { from: "2060-02-31" },
      { from: "2061-01-01", to: "2060-01-01" },
      { min_hours: 3, max_hours: 2 },
      { zone: "Unknown/Zone" },
      { role: "admin" },
    ])
      expect(jobFiltersSchema.safeParse(input).success).toBe(false);
  });
  it("scopes pages and exact detail keys by actor and never uses an offset catalogue", () => {
    const a = jobDiscoveryQuery("a", defaultJobFilters),
      b = jobDiscoveryQuery("b", defaultJobFilters);
    expect(a.queryKey).not.toEqual(b.queryKey);
    expect(a.initialPageParam).toBe(null);
    expect(jobDetailQuery("a", "id").queryKey).toEqual([
      "jobs",
      "detail",
      "a",
      "id",
    ]);
    expect(
      a.getNextPageParam?.(
        {
          items: [],
          has_more: false,
          next_cursor: null,
          as_of: "2060-01-01T00:00:00Z",
          filters: defaultJobFilters,
        },
        [],
        null,
        [],
      ),
    ).toBeUndefined();
  });
  it("rejects malformed cursor/result payloads instead of presenting a false complete list", () => {
    expect(
      discoveryPageSchema.safeParse({
        items: [],
        has_more: true,
        next_cursor: null,
        as_of: "2060-01-01T00:00:00Z",
        filters: defaultJobFilters,
      }).success,
    ).toBe(false);
    expect(
      discoveryPageSchema.safeParse({
        items: [],
        has_more: false,
        next_cursor: null,
        as_of: "not-a-time",
        filters: defaultJobFilters,
      }).success,
    ).toBe(false);
    expect(
      discoveryPageSchema.safeParse({
        items: [],
        has_more: true,
        next_cursor: {
          id: "wrong",
          number: "NaN",
          text: "",
          fingerprint: "wrong",
        },
        as_of: "2060-01-01T00:00:00Z",
        filters: defaultJobFilters,
      }).success,
    ).toBe(false);
  });
});