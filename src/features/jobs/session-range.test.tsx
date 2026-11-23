import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { JobDateRange } from "./session-range";
import { resolveJobSessions, sessionsForDateRange } from "./session-schedule";

const retained = { starts_at: "2042-01-03T11:30", ends_at: "2042-01-03T14:00" };

it("generates every day inclusively and preserves the reviewed hours within the range", () => {
  expect(
    sessionsForDateRange("2042-01-02", "2042-01-04", [
      { starts_at: "2042-01-01T08:00", ends_at: "2042-01-01T09:00" },
      retained,
    ]),
  ).toEqual([
    { starts_at: "2042-01-02T09:00", ends_at: "2042-01-02T15:00" },
    retained,
    { starts_at: "2042-01-04T09:00", ends_at: "2042-01-04T15:00" },
  ]);
  expect(sessionsForDateRange("2042-01-05", "2042-01-04", [])).toBeNull();
  expect(sessionsForDateRange("2042-01-01", "2042-03-15", [])).toBeNull();
});

it("applies the period only after the explicit action", () => {
  const onApply = vi.fn();
  render(
    <JobDateRange prefix="fixture" sessions={[retained]} onApply={onApply} />,
  );
  const last = screen.getByLabelText(/Last day|Letzter Tag/);
  fireEvent.change(last, { target: { value: "2042-01-04" } });
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: /Apply date range|Zeitraum übernehmen/,
    }),
  );
  expect(onApply).toHaveBeenCalledWith([
    retained,
    { starts_at: "2042-01-04T09:00", ends_at: "2042-01-04T15:00" },
  ]);
});

it("resolves exact Berlin and Brisbane instants and rejects overlap and DST gaps", () => {
  expect(
    resolveJobSessions([retained], "Europe/Berlin", [], 0)?.[0].starts_at,
  ).toBe("2042-01-03T10:30:00.000Z");
  expect(
    resolveJobSessions([retained], "Australia/Brisbane", [], 0)?.[0].starts_at,
  ).toBe("2042-01-03T01:30:00.000Z");
  expect(
    resolveJobSessions([retained, retained], "Europe/Berlin", [], 0),
  ).toBeNull();
  expect(
    resolveJobSessions(
      [{ starts_at: "2026-03-29T02:15", ends_at: "2026-03-29T05:00" }],
      "Europe/Berlin",
      [],
      0,
    ),
  ).toBeNull();
  const original = {
    starts_at: "2026-10-25T00:15:12Z",
    ends_at: "2026-10-25T02:15:00Z",
  };
  expect(
    resolveJobSessions(
      [{ starts_at: "2026-10-25T02:15", ends_at: "2026-10-25T03:15" }],
      "Europe/Berlin",
      [original],
      0,
    ),
  ).toEqual([original]);
});
