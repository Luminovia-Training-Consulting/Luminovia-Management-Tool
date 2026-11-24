/**
 * Shared DTOs for the original profile/job/calendar contract. Keep ISO instants, IANA zones and
 * accepted terms distinct; feature extensions own their additional types.
 */
import type { CurrencyCode } from "./currencies.ts";
/** Own profile fields and display zone; never a substitute for current role/capability queries. */
export interface Profile {
  id: string;
  luminovia_user_id: string;
  display_name: string;
  bio_de: string;
  bio_en: string;
  phone: string | null;
  time_zone: string;
  locale: string;
  active: boolean;
}

/** Shared expertise entry with DE/EN labels and optional archive/hierarchy references. */
export interface Topic {
  id: string;
  label_de: string;
  label_en: string;
  kind: string;
  parent_id?: string | null;
  aliases?: string[];
  archived_at?: string | null;
  version?: number;
  description_de?: string;
  description_en?: string;
}

/** Selected qualification with separate management verification and expiry. */
export interface Expertise {
  user_id: string;
  topic_id: string;
  verified: boolean;
  valid_until: string | null;
}

/** A concrete offer session represented by start/end instants. */
export interface JobSession {
  id: string;
  job_id: string;
  starts_at: string;
  ends_at: string;
}

/** Current offer projection with terms version, capacity basis and related sessions. */
export interface Job {
  capacity?: number;
  capacity_basis?: "single_position" | "per_position";
  company_internal?: boolean;
  id: string;
  title: string;
  description: string;
  customer_name: string;
  delivery_type: "online" | "onsite";
  location: string;
  time_zone: string;
  status: "draft" | "published" | "filled" | "archived";
  amount: number | null;
  currency: CurrencyCode;
  rate_unit: "per_day" | "per_hour" | "per_teaching_unit" | "fixed_total";
  total_amount: number | null;
  terms: string;
  terms_version: number;
  requires_contract: boolean;
  claim_deadline: string | null;
  urgent_reopened_at?: string | null;
  job_sessions: JobSession[];
  job_requirements: { topic_id: string }[];
}

/** Accepted assignment snapshot with own fee and reserved session intervals. */
export interface Claim {
  id: string;
  job_id: string;
  lecturer_id: string;
  status: string;
  amount: number;
  currency: string;
  rate_unit: string;
  total_amount: number;
  terms: string;
  terms_version: number;
  created_at: string;
  assignment_sessions: {
    id: string;
    claim_id: string;
    released_at?: string | null;
    starts_at: string;
    ends_at: string;
  }[];
}

/** Own private event with instants and intended display zone. */
export interface PersonalEvent {
  id: string;
  user_id: string;
  title: string;
  description: string;
  meeting_url: string;
  starts_at: string;
  ends_at: string;
  time_zone: string;
}
