/** Own versioned dashboard state and permission-scoped teaching-day previews; defaults support older payloads without inventing shared progress. */
import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {db} from "../../lib/supabase";
import {requireOnline} from "../../lib/online";
import {validZone} from "../../lib/dates";

export const widgetIds = [
    "teaching_day",
    "activity",
    "contracts",
    "files",
    "followups",
] as const;
export type WidgetId = (typeof widgetIds)[number];
const widgetSchema = z.enum(widgetIds);
export const dashboardPreferencesSchema = z.object({
    widget_order: z
        .array(widgetSchema)
        .length(widgetIds.length)
        .refine((ids) => new Set(ids).size === widgetIds.length),
    hidden_widgets: z
        .array(widgetSchema)
        .max(widgetIds.length)
        .refine((ids) => new Set(ids).size === ids.length),
    version: z.number().int().nonnegative(),
});
export type DashboardPreferences = z.infer<typeof dashboardPreferencesSchema>;
export const defaultDashboardPreferences: DashboardPreferences = {
    widget_order: [...widgetIds],
    hidden_widgets: [],
    version: 0,
};
export const dashboardPreferencesKey = (actor: string) =>
    ["dashboard-preferences", actor] as const;
export const dashboardPreferencesQuery = (actor: string) =>
    queryOptions({
        queryKey: dashboardPreferencesKey(actor),
        queryFn: async ({signal}) => {
            const {data, error} = await db()
                .rpc("dashboard_preferences")
                .abortSignal(signal);
            if (error) throw error;
            return dashboardPreferencesSchema.parse(data);
        },
        staleTime: 15000,
        retry: false,
    });

export async function saveDashboardPreferences(value: DashboardPreferences) {
    requireOnline();
    const {version, ...payload} = dashboardPreferencesSchema.parse(value);
    const {data, error} = await db().rpc("save_dashboard_preferences", {
        p_payload: payload,
        p_expected_version: version,
    });
    if (error) throw error;
    return dashboardPreferencesSchema.parse(data);
}

export const preparationIds = [
    "materials_ready",
    "location_ready",
    "contact_ready",
] as const;
export type PreparationId = (typeof preparationIds)[number];
export const preparationSchema = z.object({
    materials_ready: z.boolean(),
    location_ready: z.boolean(),
    contact_ready: z.boolean(),
    version: z.number().int().nonnegative(),
});
export const teachingDaySchema = z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time_zone: z.string().refine(validZone),
    sessions: z
        .array(
            z.object({
                id: z.string().uuid(),
                claim_id: z.string().uuid(),
                job_id: z.string().uuid(),
                title: z.string(),
                customer_name: z.string(),
                starts_at: z.string().datetime({offset: true}),
                ends_at: z.string().datetime({offset: true}),
                time_zone: z.string().refine(validZone),
                delivery_type: z.enum(["online", "onsite"]),
                location: z.string(),
                documents: z
                    .array(z.object({id: z.string().uuid(), name: z.string()}))
                    .max(20),
                document_count: z.number().int().nonnegative().optional(),
                course_run_id: z.string().uuid().nullable().default(null),
                course_contact: z
                    .object({name: z.string(), email: z.string(), phone: z.string()})
                    .nullable()
                    .default(null),
                shared_preparation: z
                    .object({
                        done: z.number().int().nonnegative(),
                        total: z.number().int().nonnegative(),
                    })
                    .refine((value) => value.done <= value.total)
                    .nullable()
                    .default(null),
                course_resources: z
                    .array(
                        z.object({
                            id: z.string().uuid(),
                            version_id: z.string().uuid(),
                            name: z.string(),
                            sha256: z.string().regex(/^[a-f0-9]{64}$/),
                            category: z.enum(["material", "report"]),
                        }),
                    )
                    .max(10)
                    .default([]),
                course_resource_count: z.number().int().nonnegative().default(0),
                preparation: preparationSchema,
            }),
        )
        .max(100),
});
export type TeachingDay = z.infer<typeof teachingDaySchema>;
export const teachingDayKey = (actor: string) =>
    ["teaching-day", actor] as const;
export const teachingDayQuery = (actor: string) =>
    queryOptions({
        queryKey: teachingDayKey(actor),
        queryFn: async ({signal}) => {
            const {data, error} = await db()
                .rpc("teaching_day")
                .abortSignal(signal);
            if (error) throw error;
            return teachingDaySchema.parse(data);
        },
        staleTime: 15000,
        retry: false,
    });

export async function saveTeachingPreparation(
    claim: string,
    item: PreparationId,
    done: boolean,
    version: number,
) {
    requireOnline();
    const {data, error} = await db().rpc("save_teaching_preparation", {
        p_claim_id: claim,
        p_item: item,
        p_done: done,
        p_expected_version: version,
    });
    if (error) throw error;
    return preparationSchema.parse(data);
}

export function teachingLink(location: string) {
    if (
        location.includes("\\") ||
        [...location].some(
            (character) =>
                character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
        )
    )
        return null;
    try {
        const link = new URL(location);
        return link.protocol === "https:" && !link.username && !link.password
            ? link.href
            : null;
    } catch {
        return null;
    }
}