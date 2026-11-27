import { db } from "../lib/supabase";

/** Localized labels for the server's bounded, staff-scoped event projection. */
const historyLabels = {
  updated: ["Kurs bearbeitet", "Course edited"],
  copied: ["Kurs kopiert", "Course copied"],
  visibility: ["Sichtbarkeit geändert", "Visibility changed"],
  class: ["Klasse zugeordnet oder geändert", "Class assignment changed"],
  schedule: ["Terminplanung geändert", "Schedule changed"],
  published: ["Kurs veröffentlicht", "Course published"],
  unpublished: ["Kursveröffentlichung zurückgenommen", "Course unpublished"],
  archived: ["Kurs archiviert", "Course archived"],
  restored: ["Kurs wiederhergestellt", "Course restored"],
  series_pattern: ["Serienmuster geändert", "Series pattern changed"],
  capacity: ["Teilnahmeplätze angepasst", "Enrolment capacity changed"],
  instructor_confirmed: [
    "Dozentenzuweisung bestätigt",
    "Instructor assignment confirmed",
  ],
  instructor_released: [
    "Dozentenzuweisung aufgehoben",
    "Instructor assignment released",
  ],
};
type HistoryEvent = {
  id: string;
  at: string;
  kind: keyof typeof historyLabels;
};

/** Reads the allowed event metadata and ignores kinds unknown to this client. */
export async function readCourseMilestones(
  courseId: string,
  signal: AbortSignal,
) {
  const { data, error } = await db()
    .rpc("course_timeline", { p_run_id: courseId }, { get: true })
    .abortSignal(signal);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("invalid_course_timeline");
  return data
    .filter(
      (event): event is HistoryEvent =>
        typeof event?.id === "string" &&
        typeof event.at === "string" &&
        Object.hasOwn(historyLabels, event.kind),
    )
    .map(({ id, at, kind }) => ({ id, at, labels: historyLabels[kind] }));
}
