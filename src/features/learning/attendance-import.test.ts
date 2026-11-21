/** Covers local CSV parsing and the validation used for both spreadsheet inputs. */
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

  it("previews reviewed times for the exact session and rejects a valid instant on another day", () => {
    const session = {
      starts_at: "2026-11-20T08:00:00Z",
      ends_at: "2026-11-20T10:00:00Z",
    };
    const document = `${attendanceCsvHeader}\na,Name,present,2026-11-20T09:15+01:00,2026-11-20T10:50+01:00,,`;
    expect(parseAttendanceCsv(document, roster, session)).toHaveLength(1);
    expect(() =>
      parseAttendanceCsv(
        document.replaceAll("2026-11-20", "2026-11-21"),
        roster,
        session,
      ),
    ).toThrow(expect.objectContaining({ row: 2 }));
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
    ).toThrow("invalid_attendance_import");
  });
});
