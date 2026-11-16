/**
 * DTOs und actorbezogene Lesequeries für Organisationen, Kontakte, CBW-Quellen, Vorlagen und Kursläufe. Die relationalen Referenzen bewahren die Trennung von wiederverwendbarem Inhalt und konkret geplantem Unterricht.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
/** Organisationsstammdaten des freigegebenen Verzeichnisses. */
export interface Organisation {
  id: string;
  name: string;
  country: string | null;
  time_zone: string;
  industry: string;
  city: string;
  tags: string[];
  archived_at: string | null;
}
/** Geschäftskontakt im gesondert berechtigten Organisationskontext. */
export interface Contact {
  id: string;
  organisation_id: string;
  name: string;
  position: string;
  email: string;
  phone: string;
  notes: string;
  archived_at: string | null;
}
/** Wiederverwendbare Kursinhalte ohne konkrete Termine oder persönliche Vertragskopien. */
export interface Template {
  id: string;
  title: string;
  description: string;
  syllabus: string;
  prerequisites: string;
  archived_at: string | null;
  building_block_id: string | null;
  building_block_source_id: string | null;
  course_template_topics: { topic_id: string }[];
}
/** Konkrete Originalfassung eines CBW-Bausteins mit Hash- und Herkunftsinformation. */
export interface BuildingBlockSource {
  id: string;
  building_block_id: string;
  file_name: string;
  sha256: string;
  page_count: number;
  content_pages: number[];
  created_on: string;
  revision_on: string;
  is_primary: boolean;
}
/** Kanonischer CBW-Inhaltsbaustein mit seinen getrennt erhaltenen Originalfassungen. */
export interface BuildingBlock {
  id: string;
  provider: string;
  code: string;
  title: string;
  description: string;
  syllabus: string;
  prerequisites: string;
  duration_days: number;
  duration_hours: number;
  theory_percent: number | null;
  practice_percent: number | null;
  notes: string;
  default_template_id: string;
  building_block_sources: BuildingBlockSource[];
}
/** Lädt die berechtigten building_blocks-Datensätze über den nativen Client und propagiert Lese-/Rechtefehler. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const buildingBlocksQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "building-blocks", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("building_blocks")
        .select("*,building_block_sources(*)")
        .order("code");
      if (error) throw error;
      return data as BuildingBlock[];
    },
  });
/** Konkrete Durchführung mit Kunde, Zone und tatsächlichen Sessions, getrennt von der Inhaltsvorlage. */
export interface CourseRun {
  id: string;
  template_id: string;
  organisation_id: string | null;
  time_zone: string;
  delivery_type: "online" | "onsite";
  venue: string;
  published: boolean;
  archived_at: string | null;
  course_sessions: { id: string; starts_at: string; ends_at: string }[];
}
/** Lädt die berechtigten organisations-Datensätze über den nativen Client und propagiert Lese-/Rechtefehler. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const orgQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "organisations", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("organisations")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Organisation[];
    },
  });
/** Lädt die berechtigten organisation_contacts-Datensätze über den nativen Client und propagiert Lese-/Rechtefehler. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const contactsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "contacts", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("organisation_contacts")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Contact[];
    },
  });
/** Lädt die berechtigten organisation_private_details-Datensätze über den nativen Client und propagiert Lese-/Rechtefehler. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const notesQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "notes", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("organisation_private_details")
        .select("*");
      if (error) throw error;
      return data as { organisation_id: string; private_notes: string }[];
    },
  });
/** Lädt die berechtigten course_templates-Datensätze über den nativen Client und propagiert Lese-/Rechtefehler. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const templatesQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "templates", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("course_templates")
        .select("*,course_template_topics(topic_id)")
        .order("title");
      if (error) throw error;
      return data as Template[];
    },
  });
/** Lädt die berechtigten course_runs-Datensätze über den nativen Client und propagiert Lese-/Rechtefehler. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const runsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "runs", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("course_runs")
        .select("*,course_sessions(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CourseRun[];
    },
  });
