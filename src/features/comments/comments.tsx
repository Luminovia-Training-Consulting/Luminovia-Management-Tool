/**
 * Comment threads with own edits/withdrawal and reasoned moderation. Load current resource
 * context separately; access errors must not present retained comments as still authorized.
 */
import { useId, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { requireOnline, useOnline } from "../../lib/online";
import { dateTime } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import {
  commentContextQuery,
  commentDenied,
  commentError,
  commentKeys,
  commentRpc,
  resourceCommentsQuery,
  uniqueComments,
  type CommentResource,
  type ResourceComment,
} from "./api";
import "./i18n";
import "./comments.css";

/** Separate own editing, own withdrawal and reasoned moderation explicitly. */
type EditAction = "edit" | "withdraw" | "moderate";
/** Connect a comment row to own-edit or reasoned moderation actions. */
function CommentEntry({
  row,
  canEdit,
  canModerate,
  refresh,
}: {
  row: ResourceComment;
  canEdit: boolean;
  canModerate: boolean;
  refresh: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation("comments");
  const online = useOnline();
  const [action, setAction] = useState<EditAction | null>(null);
  const [snapshot, setSnapshot] = useState(row);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const change = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (action === "edit") {
        await commentRpc("edit_resource_comment", {
          p_comment_id: snapshot.id,
          p_body: text,
          p_version: snapshot.version,
        });
      } else if (action === "withdraw") {
        await commentRpc("withdraw_resource_comment", {
          p_comment_id: snapshot.id,
          p_version: snapshot.version,
        });
      } else if (action === "moderate") {
        await commentRpc("moderate_resource_comment", {
          p_comment_id: snapshot.id,
          p_hidden: !snapshot.hidden,
          p_reason: reason,
          p_version: snapshot.version,
        });
      } else throw new Error("comment_action_required");
    },
    onSuccess: async () => {
      await refresh();
      setAction(null);
    },
  });
  const open = (value: EditAction) => {
    // Keep the reviewed version while typing. A background refetch must not
    // silently turn a stale edit into an overwrite of somebody else's change.
    setSnapshot(row);
    setText(row.body);
    setReason("");
    change.reset();
    setAction(value);
  };
  const title =
    action === "withdraw"
      ? "withdrawTitle"
      : action === "moderate"
        ? "moderation"
        : "edit";
  return (
    <li
      className={`resource-comment ${row.hidden ? "resource-comment-hidden" : ""}`}
    >
      <div className="comment-heading">
        <strong>{row.author_name}</strong>
        <time dateTime={row.created_at}>
          {dateTime(row.created_at, i18n.language, "UTC")} · UTC
        </time>
      </div>
      {row.hidden && <span className="badge">{t("hidden")}</span>}
      <p className="preserve-text">
        {row.withdrawn ? t("withdrawn") : row.body}
      </p>
      {row.moderation_reason && (
        <p className="muted">
          {t("reason")}: {row.moderation_reason}
        </p>
      )}
      {row.version > 1 && !row.withdrawn && <small>{t("edited")}</small>}
      {!row.withdrawn && (
        <div className="comment-actions">
          {row.mine && canEdit && (
            <Button
              variant="ghost"
              disabled={!online || change.isPending}
              onClick={() => open("edit")}
            >
              {t("edit")}
            </Button>
          )}
          {row.mine && (
            <Button
              variant="ghost"
              disabled={!online || change.isPending}
              onClick={() => open("withdraw")}
            >
              {t("withdraw")}
            </Button>
          )}
          {canModerate && (
            <Button
              variant="ghost"
              disabled={!online || change.isPending}
              onClick={() => open("moderate")}
            >
              {t(row.hidden ? "restore" : "hide")}
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={action !== null}
        onOpenChange={(value) => {
          if (!value && !change.isPending) setAction(null);
        }}
        title={t(title)}
        description={t(
          action === "withdraw"
            ? "withdrawHelp"
            : action === "moderate"
              ? "moderationHelp"
              : "help",
        )}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            change.mutate();
          }}
        >
          {action === "edit" && (
            <Field id={`edit-comment-${row.id}`} label={t("body")}>
              <textarea
                id={`edit-comment-${row.id}`}
                required
                maxLength={5000}
                rows={6}
                disabled={change.isPending}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
          )}
          {action === "moderate" && (
            <Field id={`moderate-comment-${row.id}`} label={t("reason")}>
              <textarea
                id={`moderate-comment-${row.id}`}
                required
                maxLength={1000}
                rows={4}
                disabled={change.isPending}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          )}
          <div className="comment-actions">
            <Button
              disabled={
                !online ||
                change.isPending ||
                (action === "edit" && !text.trim()) ||
                (action === "moderate" && !reason.trim())
              }
            >
              {t(
                action === "withdraw"
                  ? "withdraw"
                  : action === "moderate"
                    ? snapshot.hidden
                      ? "restore"
                      : "hide"
                    : "save",
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={change.isPending}
              onClick={() => setAction(null)}
            >
              {t("cancel")}
            </Button>
          </div>
          {change.isError && (
            <Notice kind="error">{t(commentError(change.error))}</Notice>
          )}
        </form>
      </Dialog>
    </li>
  );
}

/** Load authorized pages and preserve request/version safeguards during mutations. */
function CommentThread({
  actor,
  kind,
  resourceId,
}: {
  actor: string;
  kind: CommentResource;
  resourceId: string;
}) {
  const { t } = useTranslation("comments");
  const heading = useId();
  const online = useOnline();
  const cache = useQueryClient();
  const access = useQuery(commentContextQuery(actor, kind, resourceId));
  const comments = useInfiniteQuery({
    ...resourceCommentsQuery(actor, kind, resourceId),
    enabled: access.isSuccess,
  });
  const [text, setText] = useState("");
  const retry = useRef<{ text: string; key: string } | null>(null);
  const refresh = async () => {
    await cache.invalidateQueries({
      queryKey: commentKeys.list(actor, kind, resourceId),
    });
    await cache.invalidateQueries({
      queryKey: commentKeys.context(actor, kind, resourceId),
    });
  };
  const send = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!text.trim()) throw new Error("comment_required");
      if (!retry.current || retry.current.text !== text)
        retry.current = { text, key: crypto.randomUUID() };
      return await commentRpc<string>("add_resource_comment", {
        p_kind: kind,
        p_id: resourceId,
        p_body: text,
        p_request_id: retry.current.key,
      });
    },
    onSuccess: async () => {
      setText("");
      retry.current = null;
      await refresh();
    },
  });
  if (access.isPending) return <Loading />;
  if (access.isError)
    return commentDenied(access.error) ? (
      <p className="muted">{t("denied")}</p>
    ) : (
      <ErrorState retry={() => void access.refetch()} />
    );
  if (comments.isError)
    return commentDenied(comments.error) ? (
      <p className="muted">{t("denied")}</p>
    ) : (
      <ErrorState retry={() => void comments.refetch()} />
    );
  const rows = uniqueComments(comments.data?.pages);
  return (
    <section className="panel resource-comments" aria-labelledby={heading}>
      <h2 id={heading}>
        <MessageSquare aria-hidden="true" size={22} /> {t("title")}
      </h2>
      <p className="muted">{t("help")}</p>
      {access.data.can_post ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate();
          }}
        >
          <Field id={`comment-${kind}-${resourceId}`} label={t("body")}>
            <textarea
              id={`comment-${kind}-${resourceId}`}
              rows={4}
              required
              maxLength={5000}
              disabled={send.isPending}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                send.reset();
              }}
            />
          </Field>
          <Button disabled={!online || send.isPending || !text.trim()}>
            {t(send.isPending ? "sending" : "send")}
          </Button>
          {send.isError && (
            <Notice kind="error">{t(commentError(send.error))}</Notice>
          )}
          {send.isSuccess && <Notice>{t("posted")}</Notice>}
        </form>
      ) : (
        <p>{t("archived")}</p>
      )}
      <Button
        type="button"
        variant="ghost"
        disabled={comments.isFetching}
        onClick={() => void refresh()}
      >
        {t("refresh")}
      </Button>
      {comments.isPending ? (
        <Loading />
      ) : rows.length ? (
        <ol className="comment-list">
          {rows.map((row) => (
            <CommentEntry
              key={row.id}
              row={row}
              canEdit={access.data.can_post}
              canModerate={access.data.can_moderate}
              refresh={refresh}
            />
          ))}
        </ol>
      ) : (
        <p className="comment-empty">{t("empty")}</p>
      )}
      {comments.hasNextPage && (
        <Button
          variant="secondary"
          disabled={comments.isFetchingNextPage}
          onClick={() => void comments.fetchNextPage()}
        >
          {t("older")}
        </Button>
      )}
    </section>
  );
}

/**
 * Check current resource context before showing an interactive thread. Remount on resource/actor
 * navigation so private drafts cannot cross contexts.
 */
export function ResourceComments({
  kind,
  resourceId,
}: {
  kind: CommentResource;
  resourceId: string;
}) {
  const { session } = useAuth();
  if (!session) return null;
  return (
    <CommentThread
      key={`${session.user.id}:${kind}:${resourceId}`}
      actor={session.user.id}
      kind={kind}
      resourceId={resourceId}
    />
  );
}
