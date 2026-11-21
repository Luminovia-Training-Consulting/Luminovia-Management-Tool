import { describe, expect, it } from "vitest";
import {
  attendanceCsvHeader,
  attendanceCsvTemplate,
  parseAttendanceCsv,
} from "./attendance-import";

const roster = [
  {
    user_id: "a",
    name: "Fictional Learner A",
    status: null,
    arrival_at: null,
    departure_at: null,
    note: "",
    version: 0,
  },
  {
    user_id: "b",
    name: "=some formula",
    status: null,
    arrival_at: null,
    departure_at: null,
    note: "",
    version: 2,
  },
];

describe("attendance import preview", () => {
  it("uses current identities and versions and supports quotes and an explicit offset", () => {
    expect(
      parseAttendanceCsv(
        [
          attendanceCsvHeader,
          'a,Name,present,2026-11-20T09:20+01:00,,"Comma, a ""quote"" and\na new line",',
          "b,Name,excused,,,,updated reason",
        ].join("\r\n"),
        roster,
      ),
    ).toEqual([
      {
        user_id: "a",
        status: "present",
        arrival_at: "2026-11-20T09:20+01:00",
        departure_at: null,
        note: 'Comma, a "quote" and\na new line',
        reason: "",
        expected_version: 0,
      },
      {
        user_id: "b",
        status: "excused",
        arrival_at: null,
        departure_at: null,
        note: "",
        reason: "updated reason",
        expected_version: 2,
      },
    ]);
  });

  it("ignores unchanged rows and makes formula-like names inert in downloaded templates", () => {
    const template = attendanceCsvTemplate(roster);
    expect(template).toContain(`b,"'=some formula",,,,,`);
    expect(
      parseAttendanceCsv(
        template.replace(
          'a,"Fictional Learner A",,,,,',
          'a,"Fictional Learner A",absent,,,,',
        ),
        roster,
      ),
    ).toHaveLength(1);
  });

  it.each([
    "x,Foreign,present,,,,",
    "a,Name,other,,,,",
    "a,Name,present,2026-11-20T09:20,,,,",
    'a,Name,present,,,"bad"quote",',
    "a,Name,present,,,,\na,Duplicate,absent,,,,",
    "b,Name,excused,,,,",
  ])("does not produce an import preview for invalid input", (rows) => {
    expect(() =>
      parseAttendanceCsv(attendanceCsvHeader + "\n" + rows, roster),
    ).toThrow("invalid_attendance_csv");
  });
});
