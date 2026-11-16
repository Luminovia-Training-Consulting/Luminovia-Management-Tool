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
} from "./discovery-api";
describe("discovery data contracts", () => {
  it("round trips deep links with combined original currency/unit/date/topic filters", () => {
    const filters = jobFiltersSchema.parse({
      q: "literal %_ <script>",
      customer: "Fictional [office]",
      topic_ids: ["d7000000-0000-4000-8000-000000000001"],
      from: "2060-01-02",
      to: "2060-01-10",
      zone: "Australia/Brisbane",
      currency: "AUD",
      unit: "per_hour",
      min_rate: 25.01,
      max_total: 100,
      sort: "rate_desc",
      available_only: true,
    });
    expect(filtersFromParams(filterParams(filters))).toMatchObject({
      success: true,
      data: filters,
    });
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
