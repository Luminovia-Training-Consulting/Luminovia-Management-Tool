/**
 * Vitest-Regressionen für eindeutige zonierte Fenster, exakte erhaltene Instants und weitergereichte Request-Abbrüche. Lokale SDK-/DOM-Fixtures isolieren den Browservertrag; echte Datenbank-/API-Abnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import { describe, expect, it, vi } from "vitest";
import {
  availabilityPayload,
  availabilityRange,
  myAvailabilityQuery,
  type AvailabilityValues,
} from "./api";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const body: AvailabilityValues = {
  kind: "unavailable",
  starts_at: "2026-03-29T03:00",
  ends_at: "2026-03-29T04:00",
  time_zone: "Europe/Berlin",
  notes: "Private note",
  share_with_management: false,
};
describe("availability local-time boundary", () => {
  it("keeps exact Berlin instants through DST and refuses nonexistent or ambiguous local times", () => {
    expect(availabilityPayload(body)).toMatchObject({
      starts_at: "2026-03-29T01:00:00.000Z",
      ends_at: "2026-03-29T02:00:00.000Z",
      share_with_management: false,
    });
    expect(() =>
      availabilityPayload({ ...body, starts_at: "2026-03-29T02:30" }),
    ).toThrow("invalid-time");
    expect(() =>
      availabilityPayload({
        ...body,
        starts_at: "2026-10-25T02:30",
        ends_at: "2026-10-25T04:00",
      }),
    ).toThrow("invalid-time");
    expect(() =>
      availabilityPayload({ ...body, ends_at: body.starts_at }),
    ).toThrow("invalid-time");
  });
  it("preserves original seconds and explicit offsets for unchanged local fields", () => {
    const previous = {
      starts_at: "2026-03-29T01:00:30.001Z",
      ends_at: "2026-03-29T02:00:45.500Z",
      time_zone: "Europe/Berlin",
    };
    expect(availabilityPayload(body, previous)).toMatchObject({
      starts_at: previous.starts_at,
      ends_at: previous.ends_at,
    });
  });
  it("uses inclusive local dates for bounded calendar views and rejects excessive ranges", () => {
    expect(
      availabilityRange("2026-03-29", "2026-03-29", "Europe/Berlin"),
    ).toEqual({
      from: "2026-03-28T23:00:00.000Z",
      to: "2026-03-29T22:00:00.000Z",
    });
    expect(availabilityRange("2026-01-01", "2027-01-01", "UTC")).toBeNull();
    expect(availabilityRange("", "2026-01-01", "UTC")).toBeNull();
  });
  it("keys private reads by actor and bounds and forwards the real request abort signal", async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: [], error: null });
    rpc.mockReturnValue({ abortSignal });
    const a = myAvailabilityQuery("a", "from", "to"),
      b = myAvailabilityQuery("b", "from", "to");
    expect(a.queryKey).not.toEqual(b.queryKey);
    const signal = new AbortController().signal;
    await a.queryFn!({ signal } as never);
    expect(rpc).toHaveBeenCalledWith("my_availability", {
      p_from: "from",
      p_to: "to",
    });
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });
});
