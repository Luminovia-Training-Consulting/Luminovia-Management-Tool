import { afterEach, expect, it, vi } from "vitest";
import { csvText } from "../commercial/api";
import {
  deliveryCsvRows,
  deliveryDraft,
  deliverySchema,
  deliveryWrite,
} from "./api";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
afterEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});
const values = {
  outcome: "completed" as const,
  start: "2026-11-01T09:00",
  end: "2026-11-01T10:00",
  zone: "Europe/Berlin",
  notes: "Fictional notes",
  reason: "",
};
it("preserves canonical instants and the intended time zone, refusing ambiguous and missing DST times", () => {
  expect(deliveryDraft(values, false)).toMatchObject({
    actual_start: "2026-11-01T08:00:00.000Z",
    time_zone: "Europe/Berlin",
  });
  for (const start of ["2026-03-29T02:30", "2026-10-25T02:30"])
    expect(() => deliveryDraft({ ...values, start }, false)).toThrow(
      "delivery_invalid",
    );
  expect(() =>
    deliveryDraft({ ...values, zone: "Mars/Olympus" }, false),
  ).toThrow();
});
it("requires ordered bounded real times, noncomplete explanations and correction reasons", () => {
  for (const fields of [
    { end: values.start },
    { end: "2026-11-03T09:00" },
    { outcome: "partial" as const, notes: "" },
  ])
    expect(() => deliveryDraft({ ...values, ...fields }, false)).toThrow();
  expect(() => deliveryDraft(values, true)).toThrow();
  expect(
    deliveryDraft({ ...values, reason: "Corrected delivery duration" }, true)
      .correction_reason,
  ).toContain("Corrected");
  expect(
    deliveryDraft(
      {
        ...values,
        outcome: "cancelled",
        notes: "Fictional cancellation",
        start: "",
        end: "",
      },
      false,
    ),
  ).toMatchObject({ actual_start: null, actual_end: null });
});
it("never writes offline or treats an absent/invalid server acknowledgement as success", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  await expect(deliveryWrite("submit_delivery", {})).rejects.toThrow("offline");
  expect(rpc).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  rpc.mockResolvedValue({ data: null, error: null });
  await expect(deliveryWrite("submit_delivery", {})).rejects.toThrow();
  rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
  await expect(deliveryWrite("submit_delivery", {})).rejects.toMatchObject({
    code: "40001",
  });
});
it("exports exact original instants and formula-safe authored text without financial terms", () => {
  const row = deliverySchema.parse({
    session_id: "d6000000-0000-4000-8000-000000000001",
    claim_id: "d6000000-0000-4000-8000-000000000002",
    job_id: "d6000000-0000-4000-8000-000000000003",
    course_run_id: null,
    title: "=FictionalFormula()",
    lecturer_name: "Fictional teacher",
    scheduled_start: "2026-11-01T08:00:00Z",
    scheduled_end: "2026-11-01T09:00:00Z",
    time_zone: "Europe/Berlin",
    status: "missing",
    version: 0,
    draft: null,
    submission: null,
    scheduled_minutes: 60,
    actual_minutes: 0,
    invoice_id: null,
    can_edit: true,
    can_review: false,
    can_customer_confirm: false,
    customer_confirmed: false,
  });
  const csv = csvText(deliveryCsvRows([row], ["Fictional headers"]));
  expect(csv).toContain('"\'=FictionalFormula()"');
  expect(csv).toContain("2026-11-01T08:00:00Z");
  expect(csv).not.toContain("amount");
});
