/** Spreadsheet-safe UTF-8 from the exact same authorised facts as the attendance PDF. */
type Facts = Record<string, unknown>;

function cell(value: unknown) {
    const text = value == null ? "" : String(value);
    const safe = /^[\s=+@-]/.test(text) ? "'" + text : text;
    return `"${safe.replaceAll('"', '""')}"`;
}

export function renderAttendanceCsv(facts: Facts): Uint8Array {
    const session = (facts.sessions as Facts[])[0];
    const lines = [
        "course_id,course,session_id,session_start,session_end,time_zone,user_id,name,status,arrival_at,departure_at,verified_minutes",
    ];
    for (const person of facts.roster as Facts[]) {
        const attendance = (person.sessions as Facts[])[0];
        lines.push([
            facts.id, facts.course, session.id, session.starts_at, session.ends_at,
            facts.time_zone, person.user_id, person.name, attendance.status ?? "not_marked",
            attendance.arrival_at, attendance.departure_at, attendance.minutes,
        ].map(cell).join(","));
    }
    return new TextEncoder().encode("\uFEFF" + lines.join("\r\n") + "\r\n");
}
