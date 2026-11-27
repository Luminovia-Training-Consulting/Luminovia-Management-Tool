/** Revisioned network contract and serial autosaving for the internal course creator. */
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { validZone } from "../../lib/dates";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";

const text = z.string();
const snapshotSchema = z.object({
  run: z.object({
    template_id: text,
    organisation_id: text,
    time_zone: text.refine(validZone),
    delivery_type: z.enum(["online", "onsite"]),
    venue: text,
    archived: z.boolean(),
    sessions: z
      .array(
        z.object({
          starts_at: text,
          ends_at: text,
          source_session_id: text.optional(),
        }),
      )
      .min(1)
      .max(60),
  }),
  content: z.object({
    title: text,
    description: text,
    syllabus: text,
    prerequisites: text,
    topic_ids: z.array(text),
    archived: z.boolean(),
  }),
});
export type CourseCreatorSnapshot = z.infer<typeof snapshotSchema>;

const receiptSchema = z.object({
  id: z.uuid(),
  title: text,
  revision: z.number().int().positive(),
  updated_at: z.iso.datetime({ offset: true }),
  state: z.enum(["editing", "created", "discarded"]),
  course_run_id: z.uuid().nullable(),
  next_action: z.enum(["course", "offer"]).nullable(),
  payload: snapshotSchema.nullable(),
});
const indexSchema = z.array(receiptSchema);
export type CourseCreatorDraft = z.infer<typeof receiptSchema>;
type Action = "save" | "duplicate" | "discard" | "create_course";
type SaveStatus =
  "unchanged" | "unsaved" | "saving" | "saved" | "conflict" | "error";

export const courseCreatorDraftId = z.uuid();

export const draftKey = (actor: string) => ["course-creator-drafts", actor];

/** List titles or load the exact revision from the server under the current actor. */
export function courseCreatorDraftsQuery(actor: string, id?: string) {
  return {
    queryKey: [...draftKey(actor), id ?? ""],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("course_creator_drafts", {
          p_draft_id: id ?? null,
        })
        .abortSignal(signal);
      if (error) throw error;
      return indexSchema.parse(data);
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  };
}

export async function actOnCourseCreatorDraft(
  action: Action,
  id: string,
  revision: number,
  payload: unknown,
) {
  requireOnline();
  const { data, error } = await db().rpc("course_creator_draft_action", {
    p_action: action,
    p_draft_id: id,
    p_expected_revision: revision,
    p_payload: payload,
  });
  if (error) throw error;
  return receiptSchema.parse(data);
}

/** Queue autosaves and final confirmation so only one revision is written at a time. */
export function useCourseCreatorDraftSaver(
  actor: string,
  id?: string,
  revision = 0,
) {
  const cache = useQueryClient();
  const internal = useRef({
    revision,
    tail: Promise.resolve(),
    saved: "",
    closed: false,
    conflict: false,
  });
  const [status, setStatus] = useState<SaveStatus>(
    revision > 0 ? "saved" : "unchanged",
  );

  const write = useCallback(
    (snapshot: CourseCreatorSnapshot, confirmation?: unknown) => {
      const state = internal.current;
      const snapshotKey = JSON.stringify(snapshot);
      if (!id) return Promise.resolve(undefined);
      const request = state.tail.then(async () => {
        if (state.closed || state.conflict)
          throw new Error("course_draft_closed");
        setStatus("saving");
        try {
          if (state.saved !== snapshotKey || !state.revision) {
            const receipt = await actOnCourseCreatorDraft(
              "save",
              id,
              state.revision,
              snapshot,
            );
            state.revision = receipt.revision;
            state.saved = snapshotKey;
          }
          if (confirmation === undefined) {
            setStatus("saved");
            return undefined;
          }
          const receipt = await actOnCourseCreatorDraft(
            "create_course",
            id,
            state.revision,
            confirmation,
          );
          state.closed = true;
          setStatus("saved");
          return receipt;
        } catch (error) {
          state.conflict = z
            .object({ code: z.literal("40001") })
            .safeParse(error).success;
          setStatus(state.conflict ? "conflict" : "error");
          throw error;
        } finally {
          // List and by-id reads are kept distinct. Refetching an open editor
          // after our own save would remount it and overwrite unsaved typing.
          void cache.invalidateQueries({
            queryKey: [...draftKey(actor), ""],
            exact: true,
          });
        }
      });
      state.tail = request.then(
        () => undefined,
        () => undefined,
      );
      return request;
    },
    [actor, cache, id],
  );
  return { status, write };
}

export type CourseCreatorDraftSaver = ReturnType<
  typeof useCourseCreatorDraftSaver
>;
