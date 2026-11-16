/**
 * Sichtbarkeitsgefilterte Personen-, Kurs-, Review- und Einschreibungsprojektionen. Eigene Details und geteiltes Profil bleiben getrennt; personenbezogene Ziel-IDs sind keine Berechtigungsnachweise.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
/** Bewusst geteilte Expertiseprojektion einschließlich überprüftem Status. */
export interface PublicTopic {
  id: string;
  label_de: string;
  label_en: string;
  kind: string;
  verified: boolean;
}
/** Freigegebene Personenübersicht ohne private Vertrags-/Kontaktdaten. */
export interface PersonSummary {
  id: string;
  display_name: string;
  bio_de: string;
  bio_en: string;
  time_zone: string;
  country: string;
  languages: string[];
  labels: string[];
  topics: PublicTopic[];
  rating_average: number;
  review_count: number;
}
/** Erweiterte erlaubte Profilansicht der ausgewählten Person. */
export interface PersonDetails extends Omit<
  PersonSummary,
  "rating_average" | "review_count"
> {
  teaching_experience: string;
  can_moderate: boolean;
}
/** Eigene zusätzliche Profildaten für Erfahrung, Sprachen, Land und Labels. */
export interface ProfileDetails {
  country: string;
  languages: string[];
  teaching_experience: string;
  labels: string[];
}
/** Freigegebene Unterrichtshistorie mit ausdrücklich ausgewiesener Öffnungserlaubnis. */
export interface TaughtCourse {
  can_open: boolean;
  course_run_id: string;
  title: string;
  time_zone: string;
  starts_at: string;
  ends_at: string;
  state: "upcoming" | "current" | "past";
  topic_ids: string[];
}
/** Berechtigte Kursbewertung mit Änderungs-/Rückzugsstand. */
export interface CourseReview {
  id: string;
  course_run_id: string;
  course_title: string;
  rating: number;
  comment: string;
  version: number;
  created_at: string;
  updated_at: string;
  mine: boolean;
  reviewer_label: "self" | "participant";
  reviewer_id: string | null;
  hidden: boolean;
  moderation_reason: string;
}
/** Vom Server bestätigte bewertbare Kurs-/Dozierendenbeziehung samt vorhandenem eigenen Review. */
export interface ReviewableCourse {
  course_run_id: string;
  title: string;
  lecturer_id: string;
  lecturer_name: string;
  ends_at: string;
  review: {
    id: string;
    rating: number;
    comment: string;
    version: number;
    hidden: boolean;
    moderation_reason: string;
    deleted: boolean;
  } | null;
}
/** Verwaltungsprojektion einer expliziten Kurseinschreibung. */
export interface Enrolment {
  user_id: string;
  display_name: string;
  status: "enrolled" | "completed" | "removed";
  updated_at: string;
}
/** Verwendet den gemeinsamen nativen Client und propagiert Fach-/Rechtefehler aus Personen-RPCs. */
export async function peopleRpc<T>(
  name: string,
  parameters: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await db().rpc(name, parameters);
  if (error) throw error;
  return data as T;
}
/** Lädt die freigegebene Personenprojektion für Suchtext, Label und Thema mit getrenntem Akteurscache. */
export const peopleDirectoryQuery = (
  actor: string,
  search: string,
  label: string,
  topic: string,
) =>
  queryOptions({
    queryKey: ["people-directory", actor, search, label, topic],
    queryFn: () =>
      peopleRpc<PersonSummary[]>("people_directory", {
        p_search: search,
        p_label: label,
        p_topic_id: topic || null,
      }),
  });
/** Lädt die erlaubte Profilansicht des Ziels; actor trennt Caches und target wird serverseitig auf Sichtbarkeit geprüft. */
export const personQuery = (actor: string, target: string) =>
  queryOptions({
    queryKey: ["person", actor, target],
    queryFn: () =>
      peopleRpc<PersonDetails>("person_profile", { p_user_id: target }),
  });
/** Lädt nur die für den Aufrufer freigegebene Unterrichtshistorie der ausgewählten Person. */
export const profileCoursesQuery = (actor: string, target: string) =>
  queryOptions({
    queryKey: ["profile-courses", actor, target],
    queryFn: () =>
      peopleRpc<TaughtCourse[]>("profile_courses", { p_user_id: target }),
  });
/** Lädt die berechtigt sichtbaren Bewertungen der ausgewählten Person statt private Kursbeziehungen offenzulegen. */
export const reviewsQuery = (actor: string, target: string) =>
  queryOptions({
    queryKey: ["lecturer-reviews", actor, target],
    queryFn: () =>
      peopleRpc<CourseReview[]>("lecturer_reviews", { p_user_id: target }),
  });
/** Zerlegt Kommalisten, begrenzt Anzahl/Länge und verwirft Steuerzeichen vor dem Speichern eigener Profillabels. */
export function labelText(value: string, maximum = 20, length = 40): string[] {
  const values = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (
    values.length > maximum ||
    values.some((v) => v.length > length || /[\p{Cc}]/u.test(v))
  )
    throw new Error("invalid_labels");
  return [...new Map(values.map((v) => [v.toLocaleLowerCase(), v])).values()];
}
