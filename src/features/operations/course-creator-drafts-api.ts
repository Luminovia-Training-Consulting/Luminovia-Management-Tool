/** Revisioned network contract and serial autosaving for the internal course creator. */
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";

import {
  courseCreatorIndexSchema,
  courseCreatorReceiptSchema,
  type CourseCreatorSnapshot,
} from "./course-creator-drafts-schema";
export {
  type CourseCreatorSnapshot,
  type CourseCreatorDraft,
} from "./course-creator-drafts-schema";

type Action =
  "save" | "duplicate" | "discard" | "create_course" | "start_enquiry";
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
      return courseCreatorIndexSchema.parse(data);
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  };
}

class UnconfirmedDraftWrite extends Error {}

export async function actOnCourseCreatorDraft(
  action: Action,
  id: string,
  revision: number,
  payload: unknown,
) {
  requireOnline();
  const { data, error, status } = await db().rpc(
    "course_creator_draft_action",
    {
      p_action: action,
      p_draft_id: id,
      p_expected_revision: revision,
      p_payload: payload,
    },
  );
  if (error) {
    if (
      action === "save" &&
      error.code !== "40001" &&
      (status === 0 || status >= 500)
    )
      throw new UnconfirmedDraftWrite("Course draft save was not confirmed", {
        cause: error,
      });
    throw error;
  }
  return courseCreatorReceiptSchema.parse(data);
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
    pendingSave: "",
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
        const save = async (serialized: string) => {
          state.pendingSave = serialized;
          try {
            const receipt = await actOnCourseCreatorDraft(
              "save",
              id,
              state.revision,
              JSON.parse(serialized),
            );
            state.revision = receipt.revision;
            state.saved = serialized;
            state.pendingSave = "";
          } catch (error) {
            if (!(
              error instanceof UnconfirmedDraftWrite ||
              error instanceof z.ZodError
            ))
              state.pendingSave = "";
            throw error;
          }
        };
        try {
          // The server can acknowledge the previous revision only for an
          // exact replay. Recover it before sending the user's newer edits.
          if (state.pendingSave) await save(state.pendingSave);
          if (state.saved !== snapshotKey || !state.revision)
            await save(snapshotKey);
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
