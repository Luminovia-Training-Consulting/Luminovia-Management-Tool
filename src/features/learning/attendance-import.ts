import { DateTime } from "luxon";
import type { AttendanceRow, AttendanceStatus } from "./attendance-api";

export const attendanceCsvHeader =
  "user_id,name,status,arrival_at,departure_at,note,reason";
const maxBytes = 65_536;
const acceptedStatuses: readonly string[] = ["present", "absent", "excused"];
const isoInstant =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

type ImportRow = {
  user_id: string;
  status: AttendanceStatus;
  arrival_at: string | null;
  departure_at: string | null;
  note: string;
  reason: string;
  expected_version: number;
};

export class AttendanceCsvError extends Error {
  constructor(readonly row: number) {
    super("invalid_attendance_csv");
  }
}

/** Parse the seven-column import template, including quoted commas and line breaks. */
export function parseAttendanceCsv(
  source: string,
  current: AttendanceRow[],
): ImportRow[] {
  if (new TextEncoder().encode(source).length > maxBytes)
    throw new AttendanceCsvError(1);
  const input = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const headerEnd = input.indexOf("\n");
  if (headerEnd < 0 || input.slice(0, headerEnd) !== attendanceCsvHeader)
    throw new AttendanceCsvError(1);
  const data = input.slice(headerEnd + 1);
  const roster = new Map(current.map((row) => [row.user_id, row]));
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  // Each match consumes a complete field. A quote inside an unquoted field or
  // text after its closing quote cannot be consumed by this grammar.
  const field = /(?:"((?:[^"]|"")*)"|([^",\n]*))(,|\n|$)/gy;
  let offset = 0;
  let columns: string[] = [];
  let rowNumber = 2;
  while (offset < data.length) {
    const match = field.exec(data);
    if (!match || rowNumber > 201) throw new AttendanceCsvError(rowNumber);
    offset = field.lastIndex;
    columns.push(
      match[1] === undefined ? match[2] : match[1].replaceAll('""', '"'),
    );
    if (match[3] === ",") {
      if (offset === data.length) columns.push("");
      else continue;
    }
    const [id, , proposed, arrival, departure, note, reason] = columns;
    const user = roster.get(id);
    if (columns.length !== 7 || !user || seen.has(id))
      throw new AttendanceCsvError(rowNumber);
    seen.add(id);
    columns = [];
    if (!proposed && !arrival && !departure && !note && !reason) {
      rowNumber++;
      continue;
    }
    if (
      !acceptedStatuses.includes(proposed) ||
      (proposed !== "present" && (arrival || departure)) ||
      [arrival, departure].some(
        (value) =>
          value &&
          (!isoInstant.test(value) || !DateTime.fromISO(value).isValid),
      ) ||
      (arrival &&
        departure &&
        DateTime.fromISO(arrival) > DateTime.fromISO(departure)) ||
      note.length > 1000 ||
      reason.length > 500 ||
      (user.version > 0 && reason.trim().length < 3)
    ) {
      throw new AttendanceCsvError(rowNumber);
    }
    rows.push({
      user_id: id,
      status: proposed as AttendanceStatus,
      arrival_at: arrival || null,
      departure_at: departure || null,
      note,
      reason,
      expected_version: user.version,
    });
    rowNumber++;
  }
  if (!rows.length) throw new AttendanceCsvError(2);
  return rows;
}

export function attendanceCsvTemplate(rows: AttendanceRow[]) {
  const entries = rows.slice(0, 200).map(({ user_id, name }) => {
    const value = /^[\s=+@-]/.test(name) ? "'" + name : name;
    return `${user_id},"${value.replaceAll('"', '""')}",,,,,`;
  });
  return [attendanceCsvHeader, ...entries].join("\r\n") + "\r\n";
}

export async function readAttendanceCsv(file: File, current: AttendanceRow[]) {
  if (file.size > maxBytes || !file.name.toLowerCase().endsWith(".csv"))
    throw new AttendanceCsvError(1);
  return parseAttendanceCsv(
    new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()),
    current,
  );
}
