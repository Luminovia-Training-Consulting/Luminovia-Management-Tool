/**
 * Visibility-filtered people, course, review and enrollment projections. Own details and shared
 * profiles remain separate; target person IDs are not proof of permission.
 */
import { queryOptions } from "@tanstack/react-query";
import { callRpc } from "../../lib/rpc";

/** Intentionally shared expertise projection with verification status. */
export interface PublicTopic {
  id: string;
  label_de: string;
  label_en: string;
  kind: string;
  verified: boolean;
}

/** Permitted people-directory summary without private contract/contact data. */
export interface PersonSummary {
  id: string;
  luminovia_user_id: string;
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

/** Extended authorized profile view for the selected person. */
export interface PersonDetails extends Omit<
  PersonSummary,
  "rating_average" | "review_count"
> {
  teaching_experience: string;
  can_moderate: boolean;
}

/** Own additional experience, language, country and label fields. */
export interface ProfileDetails {
  country: string;
  languages: string[];
  teaching_experience: string;
  labels: string[];
}

/** Permitted teaching history with an explicit course-opening capability. */
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

/** Authorized course review with edit/withdrawal state. */
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

/** Server-confirmed reviewable course/lecturer relationship and any existing own review. */
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

/** Administrative projection of an explicit course enrollment. */
export interface Enrolment {
  user_id: string;
  display_name: string;
  status: "enrolled" | "completed" | "removed";
  updated_at: string;
}

/** Read the permitted directory by search, label and topic with actor-scoped caching. */
export const peopleDirectoryQuery = (
  actor: string,
  search: string,
  label: string,
  topic: string,
) =>
  queryOptions({
    queryKey: ["people-directory", actor, search, label, topic],
    queryFn: () =>
      callRpc<PersonSummary[]>("people_directory", {
        p_search: search,
        p_label: label,
        p_topic_id: topic || null,
      }),
  });
/** Read the authorized target profile; actor partitions caches while the server checks target visibility. */
export const personQuery = (actor: string, target: string) =>
  queryOptions({
    queryKey: ["person", actor, target],
    queryFn: () =>
      callRpc<PersonDetails>("person_profile", { p_user_id: target }),
  });
/** Read only the selected person's teaching history permitted for the caller. */
export const profileCoursesQuery = (actor: string, target: string) =>
  queryOptions({
    queryKey: ["profile-courses", actor, target],
    queryFn: () =>
      callRpc<TaughtCourse[]>("profile_courses", { p_user_id: target }),
  });
/** Read visible reviews without exposing private course relationships. */
export const reviewsQuery = (actor: string, target: string) =>
  queryOptions({
    queryKey: ["lecturer-reviews", actor, target],
    queryFn: () =>
      callRpc<CourseReview[]>("lecturer_reviews", { p_user_id: target }),
  });

/** Split comma lists, bound count/length and reject controls before saving own profile labels. */
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
