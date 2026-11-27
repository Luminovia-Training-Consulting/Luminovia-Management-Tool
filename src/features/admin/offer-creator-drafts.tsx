/** Manage owner-scoped offer drafts; the form and final server operation remain the same workflow. */
import { useCallback, useRef, useState, type ComponentType } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Loading, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  offerDraftIndex,
  offerDraftReceipt,
  type OfferDraft,
  type OfferDraftSnapshot,
} from "./offer-creator-draft-schema";
import type { CourseRunJobDefaults } from "../operations/building-blocks-api";
import "../operations/course-creator-drafts-i18n";
import "./offer-draft-library.css";

const draftKey = (actor: string, course: string | null) => [
  "training-offer-drafts",
  actor,
  course,
];
type DraftAction = "save" | "duplicate" | "discard" | "commit";

async function changeDraft(
  course: string | null,
  id: string,
  revision: number,
  action: DraftAction,
  payload: unknown,
) {
  requireOnline();
  const { data, error } = await db().rpc(
    "training_offer_creator_draft_action",
    {
      p_course_run_id: course,
      p_draft_id: id,
      p_expected_revision: revision,
      p_action: action,
      p_payload: payload,
    },
  );
  if (error) throw error;
  return offerDraftReceipt.parse(data);
}

function draftsQuery(actor: string, course: string | null, id?: string) {
  return {
    queryKey: [...draftKey(actor, course), id ?? null],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("training_offer_creator_drafts", {
          p_course_run_id: course,
          p_draft_id: id ?? null,
        })
        .abortSignal(signal);
      if (error) throw error;
      return offerDraftIndex.parse(data);
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  };
}

type DraftStatus = "unchanged" | "saving" | "saved" | "conflict" | "error";
export type OfferDraftEditor = {
  status: DraftStatus;
  restored: OfferDraftSnapshot | null;
  write: (
    snapshot: OfferDraftSnapshot,
    confirmation?: Record<string, unknown>,
  ) => Promise<string | undefined>;
  reload: () => void;
  start: () => void;
};

/** Serialize autosaves and the final receipt so confirmation always uses the accepted revision. */
function DraftEditor({
  actor,
  course,
  id,
  previous,
  Form,
  courseRun,
  reload,
  start,
}: {
  actor: string;
  course: string | null;
  id: string;
  previous?: OfferDraft;
  Form: ComponentType<{
    draft: OfferDraftEditor;
    courseRun?: CourseRunJobDefaults;
  }>;
  courseRun?: CourseRunJobDefaults;
  reload: () => void;
  start: () => void;
}) {
  const cache = useQueryClient();
  const [status, setStatus] = useState<DraftStatus>(
    previous ? "saved" : "unchanged",
  );
  const local = useRef({
    rev: previous?.revision ?? 0,
    saved: previous?.payload ? JSON.stringify(previous.payload) : "",
    completed: false,
    conflict: false,
    tail: Promise.resolve(),
  });
  const write = useCallback<OfferDraftEditor["write"]>(
    (snapshot, confirmation) => {
      const state = local.current;
      const signature = JSON.stringify(snapshot);
      const pending = state.tail.then(async () => {
        if (state.conflict || state.completed)
          throw new Error("offer_draft_closed");
        setStatus("saving");
        try {
          if (!state.rev || signature !== state.saved) {
            const saved = await changeDraft(
              course,
              id,
              state.rev,
              "save",
              snapshot,
            );
            state.rev = saved.revision;
            state.saved = signature;
          }
          if (confirmation) {
            const receipt = await changeDraft(
              course,
              id,
              state.rev,
              "commit",
              confirmation,
            );
            if (!receipt.job_id) throw new Error("unconfirmed");
            state.completed = true;
            setStatus("saved");
            return receipt.job_id;
          }
          setStatus("saved");
        } catch (error) {
          state.conflict = z
            .object({ code: z.literal("40001") })
            .safeParse(error).success;
          setStatus(state.conflict ? "conflict" : "error");
          throw error;
        } finally {
          void cache.invalidateQueries({
            queryKey: [...draftKey(actor, course), null],
            exact: true,
          });
        }
      });
      state.tail = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    [actor, cache, course, id],
  );
  return (
    <Form
      courseRun={courseRun}
      draft={{
        status,
        restored: previous?.payload ?? null,
        write,
        reload,
        start,
      }}
    />
  );
}

/** Offer authors can restore through the same launcher after a reload or interrupted confirmation. */
export default function OfferCreatorDrafts({
  actor,
  course,
  Form,
  courseRun,
}: {
  actor: string;
  course: string | null;
  Form: ComponentType<{
    draft: OfferDraftEditor;
    courseRun?: CourseRunJobDefaults;
  }>;
  courseRun?: CourseRunJobDefaults;
}) {
  const { t } = useTranslation("courseCreator");
  const online = useOnline();
  const cache = useQueryClient();
  const [target, setTarget] = useState<{
    id: string;
    resume: boolean;
    generation: number;
  }>(() => ({
    id: crypto.randomUUID(),
    resume: false,
    generation: 0,
  }));
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<OfferDraft>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const duplicate = useRef<{ source: string; target: string } | undefined>(
    undefined,
  );
  const list = useQuery({
    ...draftsQuery(actor, course),
    enabled: open && online,
  });
  const detail = useQuery({
    ...draftsQuery(actor, course, target.id),
    enabled: target.resume && online,
  });
  const start = () =>
    setTarget({ id: crypto.randomUUID(), resume: false, generation: 0 });
  const restore = (id: string) => {
    setTarget({ id, resume: true, generation: 0 });
    setOpen(false);
  };
  async function update(draft: OfferDraft, action: "duplicate" | "discard") {
    setPending(true);
    setFailed(false);
    try {
      if (action === "duplicate" && duplicate.current?.source !== draft.id)
        duplicate.current = { source: draft.id, target: crypto.randomUUID() };
      const result = await changeDraft(
        course,
        draft.id,
        draft.revision,
        action,
        action === "duplicate" ? { new_id: duplicate.current!.target } : {},
      );
      if (action === "duplicate") {
        duplicate.current = undefined;
        restore(result.id);
      } else if (target.id === draft.id) start();
      setConfirm(undefined);
      void list.refetch();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  const restored = target.resume ? detail.data?.[0] : undefined;
  return (
    <>
      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={!online}
          onClick={() => {
            setFailed(false);
            setOpen(true);
          }}
        >
          {t("offerLibrary")}
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
        closeDisabled={pending}
        title={t("offerLibrary")}
        description={t("offerLibraryDescription")}
      >
        <div className="offer-draft-library">
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !online}
            onClick={() => {
              start();
              setOpen(false);
            }}
          >
            {t("newOfferDraft")}
          </Button>
          {list.isPending && <Loading />}
          {list.isError && <ErrorState retry={() => void list.refetch()} />}
          {list.data?.length === 0 && <p className="muted">{t("empty")}</p>}
          {!!list.data?.length && (
            <ul className="offer-draft-list">
              {list.data.map((item) => (
                <li key={item.id}>
                  <strong>{item.title || t("untitledOffer")}</strong>
                  {item.job_id ? (
                    <Button asChild variant="secondary">
                      <Link to={`/jobs/${item.job_id}`}>
                        {t("openAssignment")}
                      </Link>
                    </Button>
                  ) : (
                    <div className="offer-draft-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending || !online}
                        onClick={() => restore(item.id)}
                      >
                        {t("resume")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pending || !online}
                        aria-label={t("duplicate")}
                        onClick={() => void update(item, "duplicate")}
                      >
                        {t("offerCopy")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pending || !online}
                        aria-label={t("discard")}
                        onClick={() => setConfirm(item)}
                      >
                        {t("offerDelete")}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {failed && !confirm && <Notice kind="error">{t("error")}</Notice>}
        </div>
      </Dialog>
      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(next) => !next && !pending && setConfirm(undefined)}
        closeDisabled={pending}
        title={t("discard")}
        description={t("discardDescription")}
      >
        {failed && <Notice kind="error">{t("error")}</Notice>}
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => setConfirm(undefined)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={pending || !online}
            onClick={() => {
              if (confirm) void update(confirm, "discard");
            }}
          >
            {t("discard")}
          </Button>
        </div>
      </Dialog>
      {target.resume && detail.isPending ? (
        online ? (
          <Loading />
        ) : (
          <Notice>{t("offline")}</Notice>
        )
      ) : target.resume && (detail.isError || !restored) ? (
        <ErrorState retry={() => void detail.refetch()} />
      ) : restored?.job_id ? (
        <Button asChild variant="secondary">
          <Link to={`/jobs/${restored.job_id}`}>{t("openAssignment")}</Link>
        </Button>
      ) : (
        <DraftEditor
          key={`${target.id}:${target.generation}`}
          actor={actor}
          course={course}
          id={target.id}
          previous={restored}
          Form={Form}
          courseRun={courseRun}
          start={start}
          reload={() =>
            void (async () => {
              const fresh = await cache.fetchQuery(
                draftsQuery(actor, course, target.id),
              );
              if (fresh[0])
                setTarget((current) =>
                  current.id === target.id
                    ? {
                        ...current,
                        resume: true,
                        generation: current.generation + 1,
                      }
                    : current,
                );
            })().catch(() => setFailed(true))
          }
        />
      )}
    </>
  );
}
