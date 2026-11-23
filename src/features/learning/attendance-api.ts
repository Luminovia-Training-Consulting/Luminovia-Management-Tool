/** Exact-session staff register. The RPC checks the caller's current course scope. */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

import {
  academyAttendanceRegisterSchema,
  attendanceImportReceiptSchema,
  attendanceRegisterSchema,
  type AttendanceImportRow,
  type AttendanceRow,
  type AttendanceStatus,
} from "./attendance-schema";
export type {
  AttendanceRegister,
  AttendanceRow,
  AttendanceStatus,
} from "./attendance-schema";

/** Shared prefix for every cached session register of this actor and course. */
export const attendanceRegistersKey = (actor: string, run: string) =>
  ["attendance-register", actor, run] as const;

export const attendanceRegisterKey = (
  actor: string,
  run: string,
  session: string,
) => [...attendanceRegistersKey(actor, run), session] as const;

export const attendanceSummariesKey = (actor: string) =>
  ["course-attendance-summary", actor] as const;

export const attendanceRegisterQuery = (
  actor: string,
  run: string,
  session: string,
  academy = false,
) =>
  queryOptions({
    queryKey: attendanceRegisterKey(actor, run, session),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_session_register", {
          p_run_id: run,
          p_session_id: session,
        })
        .abortSignal(signal);
      if (error) throw error;
      return (
        academy ? academyAttendanceRegisterSchema : attendanceRegisterSchema
      ).parse(data);
    },
    enabled: Boolean(session),
    staleTime: 0,
    retry: false,
  });

export async function saveAttendance(
  run: string,
  session: string,
  row: AttendanceRow,
  status: AttendanceStatus,
  arrival: string | null,
  departure: string | null,
  note: string,
  reason: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_course_session_attendance", {
    p_run_id: run,
    p_session_id: session,
    p_user_id: row.user_id,
    p_status: status,
    p_arrival_at: arrival,
    p_departure_at: departure,
    p_note: note,
    p_reason: reason,
    p_expected_version: row.version,
  });
  if (error) throw error;
  return data as { status: AttendanceStatus; version: number; minutes: number };
}

export async function attachAttendancePdf(
  run: string,
  session: string,
  version: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("attach_course_session_evidence", {
    p_run_id: run,
    p_session_id: session,
    p_version_id: version,
  });
  if (error) throw error;
  return data as { id: string; resource_id: string | null; version_id: string };
}

/** Confirm one atomic batch for the exact session and verify its count. */
export async function saveAttendanceBatch(
  run: string,
  session: string,
  rows: AttendanceImportRow[],
) {
  requireOnline();
  if (!rows.length) throw new Error("attendance_import_empty");
  const { data, error } = await db().rpc("import_course_session_attendance", {
    p_run_id: run,
    p_session_id: session,
    p_rows: rows,
  });
  if (error) throw error;
  const receipt = attendanceImportReceiptSchema.safeParse(data);
  if (!receipt.success || receipt.data.saved !== rows.length)
    throw new Error("attendance_import_unconfirmed");
  return receipt.data.saved;
}
