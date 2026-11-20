/** Current-actor discovery/detail/dashboard contracts preserve restricted compensation as null. */
import {infiniteQueryOptions, queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {db} from "../../lib/supabase";
import {validZone} from "../../lib/dates";
import {requireOnline} from "../../lib/online";
import type {Job} from "../../lib/types";

const bound = z.number().min(0).max(1_000_000_000).nullable().default(null);
const jobFilterFieldsSchema = z
    .object({
        q: z.string().max(160).default(""),
        customer: z.string().max(120).default(""),
        topic_ids: z.array(z.uuid()).max(20).default([]),
        delivery: z.enum(["", "online", "onsite"]).default(""),
        status: z
            .enum(["", "draft", "published", "filled", "archived"])
            .default(""),
        from: z.string().default(""),
        to: z.string().default(""),
        zone: z.string().refine(validZone).default("Europe/Berlin"),
        currency: z.enum(["", "EUR", "AUD"]).default(""),
        unit: z
            .enum(["", "per_day", "per_hour", "per_teaching_unit", "fixed_total"])
            .default(""),
        min_total: bound,
        max_total: bound,
        min_rate: bound,
        max_rate: bound,
        min_hours: bound,
        max_hours: bound,
        available_only: z.boolean().default(false),
        include_history: z.boolean().default(false),
        sort: z
            .enum([
                "newest",
                "oldest",
                "soonest",
                "total_asc",
                "total_desc",
                "rate_asc",
                "rate_desc",
                "duration_asc",
                "title",
                "customer_asc",
                "topic_de_asc",
                "topic_en_asc",
            ])
            .default("soonest"),
    })
    .strict();
export const jobFiltersSchema = jobFilterFieldsSchema.superRefine((f, ctx) => {
    const bad = (path: string, message: string) =>
        ctx.addIssue({code: "custom", path: [path], message});
    if (
        !f.currency &&
        (f.min_total !== null ||
            f.max_total !== null ||
            f.min_rate !== null ||
            f.max_rate !== null ||
            /^(total|rate)_/.test(f.sort))
    )
        bad("currency", "currencyRequired");
    if (
        !f.unit &&
        (f.min_rate !== null || f.max_rate !== null || f.sort.startsWith("rate_"))
    )
        bad("unit", "unitRequired");
    for (const [min, max] of [
        ["min_total", "max_total"],
        ["min_rate", "max_rate"],
        ["min_hours", "max_hours"],
    ] as const)
        if (f[min] !== null && f[max] !== null && f[min]! > f[max]!)
            bad(min, "rangeInvalid");
    for (const name of ["from", "to"] as const) {
        const d = f[name];
        if (
            d &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(d) ||
                !Number.isFinite(Date.parse(d)) ||
                new Date(d).toISOString().slice(0, 10) !== d)
        )
            bad(name, "rangeInvalid");
    }
    if (f.from && f.to && f.from > f.to) bad("from", "rangeInvalid");
    if (new Set(f.topic_ids).size !== f.topic_ids.length)
        bad("topic_ids", "rangeInvalid");
});
export type JobFilters = z.infer<typeof jobFiltersSchema>;
export const defaultJobFilters = jobFiltersSchema.parse({});

function filterInputFromParams(params: URLSearchParams) {
    const input: Record<string, unknown> = {};
    for (const key of Object.keys(defaultJobFilters)) {
        if (key === "topic_ids")
            input[key] = params.getAll("topic").filter(Boolean);
        else if (key === "available_only")
            input[key] = params.get("available") === "1";
        else if (key === "include_history")
            input[key] = params.get("history") === "1";
        else if (key.startsWith("min_") || key.startsWith("max_")) {
            const value =
                params.get(key) ?? (key === "min_total" ? params.get("min") : null);
            if (value !== null && value !== "") input[key] = Number(value);
        } else if (params.has(key)) input[key] = params.get(key);
    }
    return input;
}

export function filtersFromParams(params: URLSearchParams) {
    return jobFiltersSchema.safeParse(filterInputFromParams(params));
}

export function filterDraftFromParams(params: URLSearchParams) {
    const parsed = jobFilterFieldsSchema.safeParse(filterInputFromParams(params));
    return parsed.success ? parsed.data : defaultJobFilters;
}

export function filterParams(filters: JobFilters) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
        if (key === "topic_ids")
            for (const id of value as string[]) params.append("topic", id);
        else if (key === "available_only") {
            if (value) params.set("available", "1");
        } else if (key === "include_history") {
            if (value) params.set("history", "1");
        } else if (
            value !== null &&
            value !== "" &&
            value !== defaultJobFilters[key as keyof JobFilters]
        )
            params.set(key, String(value));
    }
    return params;
}

const instant = z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)));
const jobSchema = z.object({
    id: z.uuid(),
    title: z.string(),
    description: z.string(),
    customer_name: z.string(),
    delivery_type: z.enum(["online", "onsite"]),
    location: z.string(),
    time_zone: z.string().refine(validZone),
    status: z.enum(["draft", "published", "filled", "archived"]),
    // Management may discover an offer without its private lecturer quote.
    // Accept numeric or restricted-null values explicitly; coercion invents zero fees.
    amount: z.number().finite().nonnegative().nullable(),
    total_amount: z.number().finite().nonnegative().nullable(),
    currency: z.enum(["EUR", "AUD"]),
    rate_unit: z.enum([
        "per_day",
        "per_hour",
        "per_teaching_unit",
        "fixed_total",
    ]),
    terms: z.string(),
    terms_version: z.number().int().positive(),
    requires_contract: z.boolean(),
    claim_deadline: instant.nullable(),
    capacity: z.number().int().min(1).max(20),
    capacity_basis: z.enum(["single_position", "per_position"]),
    created_at: instant,
    job_sessions: z.array(
        z.object({
            id: z.uuid(),
            job_id: z.uuid(),
            starts_at: instant,
            ends_at: instant,
        }),
    ),
    job_requirements: z.array(z.object({topic_id: z.uuid()})),
    confirmed_count: z.number().int().nonnegative(),
    open_positions: z.number().int().nonnegative(),
});
const cursorSchema = z
    .object({
        id: z.uuid(),
        number: z.string().regex(/^-?\d+(?:\.\d+)?$/),
        text: z.string().max(400),
        fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
    })
    .strict();
export type JobCursor = z.infer<typeof cursorSchema>;
export const discoveryPageSchema = z
    .object({
        items: z.array(jobSchema).max(100),
        has_more: z.boolean(),
        next_cursor: cursorSchema.nullable(),
        as_of: instant,
        filters: jobFiltersSchema,
    })
    .superRefine((page, ctx) => {
        if (
            page.has_more !== Boolean(page.next_cursor) ||
            (page.has_more && !page.items.length)
        )
            ctx.addIssue({
                code: "custom",
                path: ["next_cursor"],
                message: "Inconsistent discovery pagination",
            });
    });
/** Start fresh infinite pages when an observed role changes; SQL checks unobserved cursor changes. */
export const jobDiscoveryQuery = (
    actor: string,
    filters: JobFilters,
    quoteContext = "",
) =>
    infiniteQueryOptions({
        // Known role transitions reset infinite pages; SQL also binds opaque cursors
        // to fresh role/policy context for changes the browser has not observed.
        queryKey: ["jobs", "discovery", actor, filters, quoteContext],
        initialPageParam: null as JobCursor | null,
        queryFn: async ({pageParam, signal}) => {
            const {data, error} = await db()
                .rpc("job_discovery", {
                    p_filters: filters,
                    p_cursor: pageParam,
                    p_limit: 50,
                })
                .abortSignal(signal);
            if (error) throw error;
            return discoveryPageSchema.parse(data);
        },
        getNextPageParam: (page) =>
            page.has_more ? (page.next_cursor ?? undefined) : undefined,
        staleTime: 15000,
    });
/** Validate the complete exact detail DTO, including a possibly restricted quote. */
export const jobDetailQuery = (actor: string, id: string) =>
    queryOptions({
        queryKey: ["jobs", "detail", actor, id],
        queryFn: async ({signal}) => {
            const {data, error} = await db()
                .rpc("job_detail", {p_job_id: id})
                .abortSignal(signal);
            if (error) throw error;
            return jobSchema.parse(data);
        },
        enabled: Boolean(id),
    });
const savedViewSchema = z.object({
    id: z.uuid(),
    name: z.string().min(1).max(80),
    version: z.number().int().positive(),
    filters: jobFiltersSchema,
    created_at: instant,
    updated_at: instant,
});
export type SavedJobView = z.infer<typeof savedViewSchema>;
export const savedJobViewsQuery = (actor: string) =>
    queryOptions({
        queryKey: ["saved-job-views", actor],
        queryFn: async ({signal}) => {
            const {data, error} = await db()
                .rpc("saved_job_views")
                .abortSignal(signal);
            if (error) throw error;
            return z.array(savedViewSchema).max(20).parse(data);
        },
    });

export async function saveJobView(
    id: string,
    name: string,
    filters: JobFilters,
    version: number,
) {
    requireOnline();
    const {data, error} = await db().rpc("save_job_view", {
        p_id: id,
        p_name: name,
        p_filters: jobFiltersSchema.parse(filters),
        p_expected_version: version,
    });
    if (error) throw error;
    return savedViewSchema.parse(data);
}

export async function removeJobView(view: SavedJobView) {
    requireOnline();
    const {error} = await db().rpc("remove_job_view", {
        p_id: view.id,
        p_expected_version: view.version,
    });
    if (error) throw error;
}

export interface JobDashboard {
    open_count: number;
    assignment_count: number;
    next_session_count: number;
    matching: boolean;
    suggestions: Job[];
    next_assignments: {
        id: string;
        starts_at: string;
        ends_at: string;
        job: { id: string; title: string };
    }[];
    management: { drafts: number; expired: number; upcoming: number } | null;
    as_of: string;
}

const count = z.number().int().nonnegative();
/** Share strict quote/null validation with marketplace items so suggestions never coerce restricted amounts. */
export const jobDashboardQuery = (actor: string) =>
    queryOptions({
        queryKey: ["jobs", "dashboard", actor],
        queryFn: async ({signal}) => {
            const {data, error} = await db()
                .rpc("job_dashboard")
                .abortSignal(signal);
            if (error) throw error;
            return z
                .object({
                    open_count: count,
                    assignment_count: count,
                    next_session_count: count,
                    matching: z.boolean(),
                    suggestions: z.array(jobSchema).max(2),
                    next_assignments: z
                        .array(
                            z.object({
                                id: z.uuid(),
                                starts_at: instant,
                                ends_at: instant,
                                job: z.object({id: z.uuid(), title: z.string()}),
                            }),
                        )
                        .max(5),
                    management: z
                        .object({drafts: count, expired: count, upcoming: count})
                        .nullable(),
                    as_of: instant,
                })
                .parse(data);
        },
    });
/** Customer/topic descriptions for filtering only the actor's own confirmed calendar assignments. */
export const assignmentCalendarMetadataSchema = z
    .array(
        z.object({
            id: z.uuid(),
            title: z.string(),
            organisation_id: z.uuid().nullable(),
            organisation_name: z.string(),
            topics: z.array(
                z.object({id: z.uuid(), label_de: z.string(), label_en: z.string()}),
            ),
        }),
    )
    .max(1000);
export type AssignmentCalendarMetadata = z.infer<
    typeof assignmentCalendarMetadataSchema
>[number];
export const assignmentCalendarMetadataQuery = (
    actor: string,
    ids: string[],
) => {
    const identities = [...new Set(ids)].sort();
    return queryOptions({
        queryKey: ["jobs", "assignment-calendar-metadata", actor, identities],
        queryFn: async ({signal}) => {
            const {data, error} = await db()
                .rpc("assignment_calendar_metadata", {p_job_ids: identities})
                .abortSignal(signal);
            if (error) throw error;
            return assignmentCalendarMetadataSchema.parse(data);
        },
        enabled: identities.length > 0,
        retry: false,
    });
};