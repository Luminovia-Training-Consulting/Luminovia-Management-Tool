import {type InfiniteData, infiniteQueryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {db} from "../../lib/supabase";
import {validZone} from "../../lib/dates";

export type JobPickerPurpose = "job_attachment" | "participant_course";
const pickerOptionSchema = z
    .object({
        id: z.uuid(),
        title: z.string().min(1).max(200),
        customer_name: z.string().max(200),
        course_run_id: z.uuid().nullable(),
        starts_at: z.iso.datetime({offset: true}).nullable(),
        time_zone: z.string().refine(validZone),
    })
    .strict();
export type JobPickerOption = z.infer<typeof pickerOptionSchema>;
const cursorSchema = z
    .object({
        at: z.iso.datetime({offset: true}),
        id: z.uuid(),
        fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
    })
    .strict();
type JobPickerCursor = z.infer<typeof cursorSchema>;
const pageSchema = z
    .object({
        items: z.array(pickerOptionSchema).max(100),
        has_more: z.boolean(),
        next_cursor: cursorSchema.nullable(),
        selected: pickerOptionSchema.nullable(),
    })
    .strict()
    .superRefine((page, context) => {
        if (
            page.has_more !== Boolean(page.next_cursor) ||
            (page.has_more && !page.items.length)
        )
            context.addIssue({
                code: "custom",
                path: ["next_cursor"],
                message: "Invalid picker pagination",
            });
    });
type PickerPage = z.infer<typeof pageSchema>;
type PickerQueryKey = readonly [
    "job-picker",
    string,
    JobPickerPurpose,
    string,
    string,
];
export const jobPickerQuery = (
    actor: string,
    purpose: JobPickerPurpose,
    search: string,
    selected: string,
) =>
    infiniteQueryOptions<
        PickerPage,
        Error,
        InfiniteData<PickerPage>,
        PickerQueryKey,
        JobPickerCursor | null
    >({
        queryKey: ["job-picker", actor, purpose, search, selected],
        initialPageParam: null as JobPickerCursor | null,
        // Keep the same native control/focus while validating a changed selection.
        // Never borrow another actor, purpose or search's private results.
        placeholderData: (previous, previousQuery) =>
            previousQuery?.queryKey[1] === actor &&
            previousQuery.queryKey[2] === purpose &&
            previousQuery.queryKey[3] === search
                ? previous
                : undefined,
        queryFn: async ({pageParam, signal}) => {
            const {data, error} = await db()
                .rpc("job_picker", {
                    p_purpose: purpose,
                    p_search: search,
                    p_cursor: pageParam,
                    p_limit: 40,
                    p_selected_id: selected || null,
                })
                .abortSignal(signal);
            if (error) throw error;
            const page = pageSchema.parse(data);
            if (
                page.selected?.id !== (selected || undefined) &&
                page.selected !== null
            )
                throw Error("Invalid selected picker identity");
            if (
                purpose === "participant_course" &&
                [...page.items, ...(page.selected ? [page.selected] : [])].some(
                    (item) => !item.course_run_id,
                )
            )
                throw Error("Course picker requires a real course run");
            return page;
        },
        getNextPageParam: (page) =>
            page.has_more ? (page.next_cursor ?? undefined) : undefined,
        staleTime: 15000,
    });