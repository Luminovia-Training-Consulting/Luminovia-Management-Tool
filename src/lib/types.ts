/**
 * Gemeinsame DTOs des ursprünglichen Profil-/Auftrags-/Kalendervertrags. ISO-Instants, IANA-Zonen und akzeptierte Konditionen werden getrennt gehalten; Featureerweiterungen ergänzen ihre Typen im zuständigen Modul.
 */
/** Eigene Profilstammdaten einschließlich Anzeigezone; kein Ersatz für aktuelle Rollen-/Capability-Abfragen. */
export interface Profile {
  id: string;
  display_name: string;
  bio_de: string;
  bio_en: string;
  phone: string | null;
  time_zone: string;
  locale: string;
  active: boolean;
}
/** Gemeinsamer Expertiseeintrag mit DE/EN-Bezeichnung und optionaler Archiv-/Hierarchiereferenz. */
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
/** Ausgewählte Qualifikation mit getrenntem Managementprüfstatus und Ablaufdatum. */
export interface Expertise {
  user_id: string;
  topic_id: string;
  verified: boolean;
  valid_until: string | null;
}
/** Ein konkreter Angebotstermin als Start-/Endinstant. */
export interface JobSession {
  id: string;
  job_id: string;
  starts_at: string;
  ends_at: string;
}
/** Aktuelle Angebotsprojektion einschließlich Konditionsversion, Kapazitätsbasis und zugehörigen Terminen. */
export interface Job {
  capacity?: number;
  capacity_basis?: "single_position" | "per_position";
  id: string;
  title: string;
  description: string;
  customer_name: string;
  delivery_type: "online" | "onsite";
  location: string;
  time_zone: string;
  status: "draft" | "published" | "filled" | "archived";
  amount: number;
  currency: "EUR" | "AUD";
  rate_unit: "per_day" | "per_hour" | "per_teaching_unit" | "fixed_total";
  total_amount: number;
  terms: string;
  terms_version: number;
  requires_contract: boolean;
  claim_deadline: string | null;
  job_sessions: JobSession[];
  job_requirements: { topic_id: string }[];
}
/** Akzeptierter Zuweisungssnapshot mit eigenem Honorar und reservierten Terminintervallen. */
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
    starts_at: string;
    ends_at: string;
  }[];
}
/** Eigener privater Kalendertermin mit Instants und beabsichtigter Anzeigezone. */
export interface PersonalEvent {
  id: string;
  user_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  time_zone: string;
}
