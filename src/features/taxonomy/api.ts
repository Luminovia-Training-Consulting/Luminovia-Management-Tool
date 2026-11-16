/**
 * Gemeinsamer Themen-/Tool-/Sprachenkatalog mit validierten Aliasdaten und Versionsschutz. Speichern und Archivieren erhalten bestehende Kennungen; der Server prüft Hierarchie, MFA und aktuelle Verwaltungsrechte.
 */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

/** Versionierter Katalogeintrag mit Hierarchie, Aliasen und Archivstand. */
export interface TaxonomyTopic {
  id: string;
  label_de: string;
  label_en: string;
  kind: "topic" | "tool" | "language";
  parent_id: string | null;
  aliases: string[];
  description_de: string;
  description_en: string;
  archived_at: string | null;
  version: number;
  related_courses: { id: string; title: string }[];
}
/** Lokale Eingabegrenzen des Fachformulars; Rechte, Fremdschlüssel und verbindliche Zustandsregeln prüft der Server zusätzlich. */
export const taxonomyFormSchema = z.object({
  label_de: z.string().trim().min(1).max(120),
  label_en: z.string().trim().min(1).max(120),
  kind: z.enum(["topic", "tool", "language"]),
  parent_id: z.string(),
  aliases: z.string().max(2500),
  description_de: z.string().max(4000),
  description_en: z.string().max(4000),
});
/** Validierter Katalogentwurf vor Normalisierung der Aliasliste. */
export type TaxonomyFormValues = z.infer<typeof taxonomyFormSchema>;

/** Validiert Katalogdaten, normalisiert eindeutige Aliasse und lehnt verbotene Steuerzeichen ab. */
export function taxonomyPayload(values: TaxonomyFormValues) {
  const parsed = taxonomyFormSchema.parse(values);
  const controlText = (value: string) =>
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    );
  const aliases = [
    ...new Map(
      parsed.aliases
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => [v.toLowerCase(), v]),
    ).values(),
  ];
  if (
    aliases.length > 20 ||
    aliases.some((value) => value.length > 120 || controlText(value))
  )
    throw new Error("invalid-aliases");
  if (controlText(parsed.label_de + parsed.label_en))
    throw new Error("invalid-labels");
  return { ...parsed, parent_id: parsed.parent_id || null, aliases };
}

/** Lädt die Serverprojektion über taxonomy_catalogue und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const taxonomyQuery = (
  actor: string,
  search = "",
  kind = "",
  archived = false,
) =>
  queryOptions({
    queryKey: ["taxonomy", actor, search, kind, archived],
    queryFn: async ({ signal }) => {
      const result = await db()
        .rpc("taxonomy_catalogue", {
          p_search: search,
          p_kind: kind,
          p_include_archived: archived,
        })
        .abortSignal(signal);
      if (result.error) throw result.error;
      return (result.data ?? []) as TaxonomyTopic[];
    },
    // Keep the search input mounted while a filter request is pending, without
    // carrying another actor's or archive-visibility result into a new scope.
    placeholderData: (previous, query) =>
      query?.queryKey[1] === actor && query.queryKey[4] === archived
        ? previous
        : undefined,
    staleTime: 15000,
  });

/** Übermittelt einen neuen oder versioniert vorhandenen Katalogeintrag an die MFA-geschützte RPC. */
export async function saveTaxonomyTopic(
  topic: TaxonomyTopic | null,
  values: TaxonomyFormValues,
) {
  requireOnline();
  const result = await db().rpc("save_taxonomy_topic", {
    p_id: topic?.id ?? null,
    p_payload: taxonomyPayload(values),
    p_version: topic?.version ?? 0,
  });
  if (result.error) throw result.error;
  return result.data as string;
}
/** Archiviert beziehungsweise reaktiviert gegen die erwartete Version, ohne historische Referenzen umzuhängen. */
export async function setTaxonomyArchived(
  topic: TaxonomyTopic,
  archived: boolean,
) {
  requireOnline();
  const result = await db().rpc("set_taxonomy_topic_archived", {
    p_id: topic.id,
    p_archived: archived,
    p_version: topic.version,
  });
  if (result.error) throw result.error;
}
