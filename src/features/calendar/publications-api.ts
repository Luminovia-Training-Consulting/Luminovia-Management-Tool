import {infiniteQueryOptions, type QueryClient} from "@tanstack/react-query";
import {DateTime} from "luxon";
import {z} from "zod";
import {db} from "../../lib/supabase";
import {requireOnline} from "../../lib/online";
import {validZone, zonedInstant} from "../../lib/dates";

const instant = z.string().datetime({offset: true});

export function validEventLink(value: string) {
    if (!value) return true;
    if (
        value.length > 2000 ||
        [...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127) ||
        /[\\]/.test(value) ||
        !/^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#].*)?$/.test(
            value,
        )
    )
        return false;
    const host = /^https:\/\/([^/:?#]+)/.exec(value)![1];
    if (
        host.length > 253 ||
        host
            .split(".")
            .some(
                (label) =>
                    label.length > 63 ||
                    !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
            )
    )
        return false;
    if (
        /^[0-9.]+$/.test(host) &&
        (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
            host.split(".").some((part) => Number(part) > 255))
    )
        return false;
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            Boolean(url.hostname) &&
            url.port !== "0"
        );
    } catch {
        return false;
    }
}

export const globalEventSchema = z.object({
    id: z.uuid(),
    title: z.string(),
    description: z.string(),
    link_url: z.string().refine(validEventLink),
    starts_at: instant,
    ends_at: instant,
    time_zone: z.string().refine(validZone),
    published: z.boolean(),
    archived_at: instant.nullable(),
    version: z.number().int().positive(),
    updated_at: instant,
});
export type GlobalEvent = z.infer<typeof globalEventSchema>;
export const globalEventFormSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(8000),
    link_url: z.string().trim().refine(validEventLink),
    starts_at: z.string().min(1),
    ends_at: z.string().min(1),
    time_zone: z.string().refine(validZone),
});
export type GlobalEventForm = z.infer<typeof globalEventFormSchema>;

export function globalEventPayload(
    values: GlobalEventForm,
    previous?: GlobalEvent,
) {
    const parsed = globalEventFormSchema.parse(values);
    const exact = (name: "starts_at" | "ends_at") =>
        previous &&
        previous.time_zone === parsed.time_zone &&
        DateTime.fromISO(previous[name])
            .setZone(previous.time_zone)
            .toFormat("yyyy-MM-dd'T'HH:mm") === parsed[name]
            ? previous[name]
            : zonedInstant(parsed[name], parsed.time_zone);
    const starts = exact("starts_at"),
        ends = exact("ends_at");
    if (
        !starts ||
        !ends ||
        !Number.isFinite(Date.parse(starts)) ||
        !Number.isFinite(Date.parse(ends)) ||
        Date.parse(ends) <= Date.parse(starts)
    )
        throw Error("invalid-time");
    return {...parsed, starts_at: starts, ends_at: ends};
}

const cursor = z.object({at: instant, id: z.uuid()});
const page = z
    .object({
        items: z.array(globalEventSchema).max(100),
        has_more: z.boolean(),
        next_cursor: cursor.nullable(),
    })
    .refine(
        (p) =>
            p.has_more === Boolean(p.next_cursor) &&
            (!p.has_more || p.items.length > 0),
        "Invalid calendar cursor",
    );
export const globalEventsQuery = (
    actor: string,
    from: string,
    to: string,
    manage = false,
    search = "",
) =>
    infiniteQueryOptions({
        queryKey: ["global-events", actor, from, to, manage, search],
        initialPageParam: null as z.infer<typeof cursor> | null,
        queryFn: async ({pageParam, signal}) => {
            const {data, error} = await db()
                .rpc("global_calendar_events", {
                    p_from: from,
                    p_to: to,
                    p_manage: manage,
                    p_search: search,
                    p_before_at: pageParam?.at ?? null,
                    p_before_id: pageParam?.id ?? null,
                    p_limit: 50,
                })
                .abortSignal(signal);
            if (error) throw error;
            return page.parse(data);
        },
        getNextPageParam: (p) =>
            p.has_more ? (p.next_cursor ?? undefined) : undefined,
        staleTime: 15000,
        retry: (attempt, error) =>
            !(error instanceof z.ZodError) && !permissionDenied(error) && attempt < 1,
    });

export function permissionDenied(error: unknown) {
    return Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "42501",
    );
}

export async function manageGlobalEvent(
    id: string | null,
    action: "save" | "publish" | "unpublish" | "archive" | "recover",
    version: number,
    key: string,
    payload: Record<string, unknown> = {},
) {
    requireOnline();
    const {data, error} = await db().rpc("manage_global_event", {
        p_id: id,
        p_action: action,
        p_expected_version: version,
        p_request_id: key,
        p_payload: payload,
    });
    if (error) throw error;
    return globalEventSchema.parse(data);
}

export async function refreshGlobalEvents(client: QueryClient) {
    await client.invalidateQueries({queryKey: ["global-events"]});
}