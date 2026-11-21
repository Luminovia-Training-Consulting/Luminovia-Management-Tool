/** Converts a local attendance template into a versioned register preview. */
import { DateTime } from "luxon";
import type {
  AttendanceRegister,
  AttendanceRow,
  AttendanceStatus,
} from "./attendance-api";
import {
  maxAttendanceImportRows,
  type AttendanceImportRow,
} from "./attendance-schema";

export { maxAttendanceImportRows } from "./attendance-schema";

export const attendanceCsvHeader =
  "user_id,name,status,arrival_at,departure_at,note,reason";
const maxImportTextBytes = 65_536;
const acceptedStatuses: readonly string[] = ["present", "absent", "excused"];
const isoInstant =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export type AttendanceImportSession = Pick<
  AttendanceRegister,
  "starts_at" | "ends_at"
>;

/** Reports the worksheet row or CSV record the operator needs to review. */
export class AttendanceImportError extends Error {
  constructor(
    readonly row: number,
    options?: ErrorOptions,
  ) {
    super("invalid_attendance_import", options);
  }
}

/** Parse the seven-column import template, including quoted commas and line breaks. */
export function parseAttendanceCsv(
  source: string,
  current: AttendanceRow[],
  session?: AttendanceImportSession,
): AttendanceImportRow[] {
  if (new TextEncoder().encode(source).length > maxImportTextBytes)
    throw new AttendanceImportError(1);
  const input = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const headerEnd = input.indexOf("\n");
  if (headerEnd < 0 || input.slice(0, headerEnd) !== attendanceCsvHeader)
    throw new AttendanceImportError(1);
  return validateAttendanceRows(
    csvRows(input.slice(headerEnd + 1)),
    current,
    session,
  );
}

/** Keep CSV quoting, physical file syntax and logical record numbers out of domain validation. */
function* csvRows(data: string) {
  // Each match consumes a complete field. A quote inside an unquoted field or
  // text after its closing quote cannot be consumed by this grammar.
  const field = /(?:"((?:[^"]|"")*)"|([^",\n]*))(,|\n|$)/gy;
  let offset = 0;
  let columns: string[] = [];
  let rowNumber = 2;
  while (offset < data.length) {
    const match = field.exec(data);
    if (!match) throw new AttendanceImportError(rowNumber);
    offset = field.lastIndex;
    columns.push(
      match[1] === undefined ? match[2] : match[1].replaceAll('""', '"'),
    );
    if (match[3] === ",") {
      if (offset === data.length) columns.push("");
      else continue;
    }
    yield { rowNumber, columns };
    rowNumber++;
    columns = [];
  }
}

/** Bind imported edits to the current register's eligible identities and versions. */
export function validateAttendanceRows(
  records: Iterable<{ rowNumber: number; columns: string[] }>,
  current: AttendanceRow[],
  session?: AttendanceImportSession,
): AttendanceImportRow[] {
  const roster = new Map(current.map((row) => [row.user_id, row]));
  const start = session && DateTime.fromISO(session.starts_at);
  const end = session && DateTime.fromISO(session.ends_at);
  const rows: AttendanceImportRow[] = [];
  const seen = new Set<string>();
  const encoder = new TextEncoder();
  let textBytes = 0;
  for (const { rowNumber, columns } of records) {
    // Shared XLSX strings can repeat the same text many times across cells.
    textBytes += encoder.encode(columns.join(",")).byteLength;
    const [id, , proposed, arrival, departure, note, reason] = columns;
    const user = roster.get(id);
    if (
      rowNumber > 1 + maxAttendanceImportRows ||
      columns.length !== 7 ||
      textBytes > maxImportTextBytes ||
      !user ||
      seen.has(id)
    ) {
      throw new AttendanceImportError(rowNumber);
    }
    seen.add(id);
    if (!proposed && !arrival && !departure && !note && !reason) continue;
    const arrivalTime = arrival && DateTime.fromISO(arrival);
    const departureTime = departure && DateTime.fromISO(departure);
    if (
      !acceptedStatuses.includes(proposed) ||
      (proposed !== "present" && (arrival || departure)) ||
      (arrivalTime && (!isoInstant.test(arrival) || !arrivalTime.isValid)) ||
      (departureTime &&
        (!isoInstant.test(departure) || !departureTime.isValid)) ||
      (arrivalTime && departureTime && arrivalTime > departureTime) ||
      (start &&
        end &&
        arrivalTime &&
        (arrivalTime < start.minus({ hours: 1 }) || arrivalTime > end)) ||
      (start &&
        end &&
        departureTime &&
        (departureTime < start || departureTime > end.plus({ hours: 1 }))) ||
      note.length > 1000 ||
      reason.length > 500 ||
      (user.version > 0 && reason.trim().length < 3)
    ) {
      throw new AttendanceImportError(rowNumber);
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
  }
  if (!rows.length) throw new AttendanceImportError(2);
  return rows;
}

/** Provide the current session template with formula-like names escaped for spreadsheets. */
export function attendanceCsvTemplate(rows: AttendanceRow[]) {
  const entries = rows
    .slice(0, maxAttendanceImportRows)
    .map(({ user_id, name }) => {
      const value = /^[\s=+@-]/.test(name) ? "'" + name : name;
      return `${user_id},"${value.replaceAll('"', '""')}",,,,,`;
    });
  return [attendanceCsvHeader, ...entries].join("\r\n") + "\r\n";
}

/** Decode only a bounded UTF-8 CSV file before making a local preview. */
export async function readAttendanceCsv(
  file: File,
  current: AttendanceRow[],
  session?: AttendanceImportSession,
) {
  if (
    file.size > maxImportTextBytes ||
    !file.name.toLowerCase().endsWith(".csv")
  )
    throw new AttendanceImportError(1);
  return parseAttendanceCsv(
    new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()),
    current,
    session,
  );
}
