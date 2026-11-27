/**
 * Private persisted course creation. The caller supplies complete form snapshots
 * so incomplete input can be saved without creating a template or a course.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Loading, Notice } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import {
  actOnCourseCreatorDraft,
  courseCreatorDraftsQuery,
  draftKey,
  type CourseCreatorDraft,
  type CourseCreatorDraftSaver,
  type CourseCreatorSnapshot,
} from "./course-creator-drafts-api";
import "./course-creator-drafts-i18n";

/** Render revision feedback and debounce complete immutable form snapshots. */
export function DraftSaveBar<Snapshot>({
  snapshot,
  saver,
  busy,
  onReload,
}: {
  snapshot: Snapshot;
  saver: {
    status: CourseCreatorDraftSaver["status"];
    write: (candidate: Snapshot) => Promise<unknown>;
  };
  busy: boolean;
  onReload: () => void;
}) {
  const { t } = useTranslation("courseCreator");
  const online = useOnline();
  const { status, write } = saver;
  const latest = useRef(snapshot);
  const [acknowledged, setAcknowledged] = useState(() =>
    JSON.stringify(snapshot),
  );
  const serialized = JSON.stringify(snapshot);
  const pending = acknowledged !== serialized;
  const conflict = status === "conflict";
  const visibleStatus = !online
    ? "offline"
    : pending && (status === "saved" || status === "unchanged")
      ? "unsaved"
      : status;

  useEffect(() => {
    latest.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    if (!online || !pending || busy || conflict) return;
    const timer = window.setTimeout(() => {
      const candidate = latest.current;
      void write(candidate).then(
        () => setAcknowledged(JSON.stringify(candidate)),
        () => undefined,
      );
    }, 650);
    return () => window.clearTimeout(timer);
    // Saving and saved states must not restart the timer for the same input.
  }, [busy, conflict, online, pending, serialized, write]);

  return (
    <div className="form-actions">
      <span className="muted" role="status">
        {t(visibleStatus)}
      </span>
      {status === "conflict" ? (
        <Button
          type="button"
          variant="secondary"
          disabled={!online || busy}
          onClick={onReload}
        >
          {t("reloadDraft")}
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={!online || busy || status === "saving"}
          onClick={() =>
            void write(snapshot).then(
              () => setAcknowledged(serialized),
              () => undefined,
            )
          }
        >
          {t("saveDraft")}
        </Button>
      )}
    </div>
  );
}

/** Present the common draft controls with the course creator's exact snapshot type. */
export function CourseCreatorDraftSaveBar(props: {
  snapshot: CourseCreatorSnapshot;
  saver: CourseCreatorDraftSaver;
  busy: boolean;
  onReload: () => void;
}) {
  return <DraftSaveBar {...props} />;
}

/** Recover, duplicate or discard an owned draft without exposing any other manager's work. */
export function CourseCreatorDraftLibrary({
  actor,
  onStart,
  courseOnly = false,
  onOpen,
  onContinue,
}: {
  actor: string;
  onStart?: () => void;
  courseOnly?: boolean;
  onOpen: (id: string) => void;
  onContinue: (draft: CourseCreatorDraft) => void;
}) {
  const { t, i18n } = useTranslation("courseCreator");
  const cache = useQueryClient();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<CourseCreatorDraft>();
  const [failed, setFailed] = useState(false);
  const copyRequest = useRef<{ source: string; id: string } | undefined>(
    undefined,
  );
  const index = useQuery({
    ...courseCreatorDraftsQuery(actor),
    enabled: open && online,
  });

  async function change(
    action: "duplicate" | "discard",
    draft: CourseCreatorDraft,
  ) {
    if (!online || pending) return;
    setFailed(false);
    setPending(true);
    try {
      if (action === "duplicate" && copyRequest.current?.source !== draft.id) {
        copyRequest.current = { source: draft.id, id: crypto.randomUUID() };
      }
      const receipt = await actOnCourseCreatorDraft(
        action,
        draft.id,
        draft.revision,
        action === "duplicate" ? { new_id: copyRequest.current!.id } : {},
      );
      setConfirm(undefined);
      if (action === "duplicate") {
        copyRequest.current = undefined;
        onOpen(receipt.id);
      }
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
      void cache.invalidateQueries({ queryKey: draftKey(actor) });
    }
  }

  return (
    <details
      className={
        courseOnly ? "panel academy-draft" : "operations-schedule-planner"
      }
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t(courseOnly ? "courseLibrary" : "library")}</summary>
      {open && (
        <div className="course-planner-fields">
          {onStart && (
            <div className="form-actions">
              <Button disabled={!online} type="button" onClick={onStart}>
                {t(courseOnly ? "startCourse" : "start")}
              </Button>
            </div>
          )}
          {!online ? (
            <Notice>{t("offline")}</Notice>
          ) : index.isPending ? (
            <Loading />
          ) : index.isError ? (
            <ErrorState retry={() => void index.refetch()} />
          ) : !index.data.length ? (
            <p className="muted">{t("empty")}</p>
          ) : (
            <ul className="session-list">
              {index.data.map((draft) => (
                <li key={draft.id}>
                  <div>
                    <strong>{draft.title || t("untitled")}</strong>
                    <p className="muted">
                      {dateTime(
                        draft.updated_at,
                        i18n.language,
                        Intl.DateTimeFormat().resolvedOptions().timeZone,
                      )}
                    </p>
                  </div>
                  <div className="form-actions">
                    {draft.state === "editing" ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => onOpen(draft.id)}
                        >
                          {t("resume")}
                        </Button>
                        {!draft.from_enquiry && (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => void change("duplicate", draft)}
                          >
                            {t("duplicate")}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => setConfirm(draft)}
                        >
                          {t("discard")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => onContinue(draft)}
                      >
                        {t(
                          draft.next_action === "offer"
                            ? "continueOffer"
                            : "openCourse",
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {failed && !confirm && <Notice kind="error">{t("error")}</Notice>}
        </div>
      )}
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
            variant="ghost"
            disabled={pending}
            onClick={() => setConfirm(undefined)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={pending || !online}
            onClick={() => confirm && void change("discard", confirm)}
          >
            {t("discard")}
          </Button>
        </div>
      </Dialog>
    </details>
  );
}
