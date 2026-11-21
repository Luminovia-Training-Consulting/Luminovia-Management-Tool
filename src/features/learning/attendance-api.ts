/** Exact-session staff register. The RPC checks the caller's current course scope. */
import {queryOptions} from "@tanstack/react-query";
import {db} from "../../lib/supabase";
import {requireOnline} from "../../lib/online";

export type AttendanceStatus = "present" | "absent" | "excused";
export interface AttendanceRow {
    user_id: string;
    name: string;
    status: AttendanceStatus | null;
    arrival_at: string | null;
    departure_at: string | null;
    note: string;
    version: number;
}
export interface AttendanceRegister {
    session_id: string;
    starts_at: string;
    ends_at: string;
    time_zone: string;
    rows: AttendanceRow[];
    evidence: {
        id: string;
        resource_id: string;
        version_id: string;
        name: string;
        attached_at: string;
    }[];
    history: {
        id: string;
        user_id: string;
        actor_id: string;
        old_state: unknown;
        new_state: unknown;
        reason: string;
        created_at: string;
    }[];
}

export const attendanceRegisterKey = (actor: string, run: string, session: string) =>
    ["attendance-register", actor, run, session] as const;

export const attendanceRegisterQuery = (actor: string, run: string, session: string) =>
    queryOptions({
        queryKey: attendanceRegisterKey(actor, run, session),
        queryFn: async ({signal}) => {
            const {data, error} = await db().rpc("course_session_register", {
                p_run_id: run,
                p_session_id: session,
            }).abortSignal(signal);
            if (error) throw error;
            return data as AttendanceRegister;
        },
        enabled: Boolean(session),
        staleTime: 0,
        retry: false,
    });

export async function saveAttendance(run: string, session: string, row: AttendanceRow,
    status: AttendanceStatus, arrival: string | null, departure: string | null,
    note: string, reason: string) {
    requireOnline();
    const {data, error} = await db().rpc("save_course_session_attendance", {
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
    return data as {status: AttendanceStatus; version: number; minutes: number};
}

export async function attachAttendancePdf(run: string, session: string, version: string) {
    requireOnline();
    const {data, error} = await db().rpc("attach_course_session_evidence", {
        p_run_id: run,
        p_session_id: session,
        p_version_id: version,
    });
    if (error) throw error;
    return data as {id: string; resource_id: string; version_id: string};
}
