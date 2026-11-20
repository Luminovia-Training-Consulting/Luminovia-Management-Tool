/**
 * Shared topic/tool/language catalogue with validated aliases and versions. Save/archive
 * preserves IDs; the server enforces hierarchy and current management capabilities.
 */
import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {db} from "../../lib/supabase";
import {requireOnline} from "../../lib/online";

/** Versioned catalogue entry with hierarchy, aliases and archive state. */
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

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
export const taxonomyFormSchema = z.object({
    label_de: z.string().trim().min(1).max(120),
    label_en: z.string().trim().min(1).max(120),
    kind: z.enum(["topic", "tool", "language"]),
    parent_id: z.string(),
    aliases: z.string().max(2500),
    description_de: z.string().max(4000),
    description_en: z.string().max(4000),
});
/** Validated catalogue draft before alias normalization. */
export type TaxonomyFormValues = z.infer<typeof taxonomyFormSchema>;

/** Validate catalogue data, normalize unique aliases and reject forbidden controls. */
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
    return {...parsed, parent_id: parsed.parent_id || null, aliases};
}

/** Read the taxonomy_catalogue server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const taxonomyQuery = (
    actor: string,
    search = "",
    kind = "",
    archived = false,
) =>
    queryOptions({
        queryKey: ["taxonomy", actor, search, kind, archived],
        queryFn: async ({signal}) => {
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

/** Submit a new or versioned existing entry to the permission-checked RPC. */
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

/** Archive/reactivate against the expected version without redirecting historical references. */
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