/**
 * Forum threads, replies, accepted answers, subscriptions and visible moderation. Wait for
 * server confirmation and invalidate only the affected query scopes.
 */
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { JSONContent } from "@tiptap/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Flag,
  LockKeyhole,
  MessageCircle,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { profileQuery } from "../../lib/queries";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import {
  categoriesQuery,
  forumListQuery,
  forumPostsQuery,
  forumReportsQuery,
  forumThreadQuery,
  knowledgeAccessQuery,
  knowledgeKeys,
} from "./api";
import { contentIsValid, documentText, emptyDocument } from "./content";
import type { ForumPost, ForumThread, KnowledgeCategory } from "./types";
import { KnowledgeEditor } from "./editor";
import { ForumMetadataEditor } from "./forum-metadata";
import { CategoryManager } from "./categories";
import "./i18n";
import "./knowledge.css";
/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const threadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().min(1),
});
/** Create a validated thread and normalized first post through the server contract. */
function CreateThread({
  actor,
  categories,
  onDone,
  onCancel,
}: {
  actor: string;
  categories: KnowledgeCategory[];
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation("knowledge");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [content, setContent] = useState<JSONContent>(emptyDocument);
  const [contentError, setContentError] = useState(false);
  const form = useForm<z.infer<typeof threadSchema>>({
    resolver: zodResolver(threadSchema),
    defaultValues: {
      title: "",
      category: categories.find((item) => !item.archived)?.id ?? "",
    },
  });
  const create = useMutation({
    mutationFn: async (values: z.infer<typeof threadSchema>) => {
      requireOnline();
      setContentError(false);
      if (!contentIsValid(content)) {
        setContentError(true);
        throw new Error("content_invalid");
      }
      const { data, error } = await db().rpc("create_forum_thread", {
        p_category_id: values.category,
        p_title: values.title,
        p_content: content,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
      return data as string;
    },
    onSuccess: async (id) => {
      await client.invalidateQueries({ queryKey: knowledgeKeys.forum(actor) });
      onDone(id);
    },
  });
  return (
    <form
      className="panel knowledge-write"
      noValidate
      onSubmit={form.handleSubmit((values) => create.mutate(values))}
    >
      <h2>{t("newThread")}</h2>
      <p>{t("threadHint")}</p>
      <Field
        id="forum-title"
        label={t("title")}
        error={Boolean(form.formState.errors.title)}
      >
        <input
          id="forum-title"
          {...form.register("title")}
          maxLength={200}
          disabled={create.isPending}
        />
      </Field>
      <Field
        id="forum-category"
        label={t("category")}
        error={Boolean(form.formState.errors.category)}
      >
        <select
          id="forum-category"
          {...form.register("category")}
          disabled={create.isPending}
        >
          <option value="">{t("category")}</option>
          {categories
            .filter((item) => !item.archived)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {i18n.language === "de" ? item.label_de : item.label_en}
              </option>
            ))}
        </select>
      </Field>
      <KnowledgeEditor
        value={content}
        onChange={setContent}
        label={t("content")}
        disabled={create.isPending}
      />
      <div className="form-actions">
        <Button disabled={!online || create.isPending}>{t("newThread")}</Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={create.isPending}
        >
          {common("cancel")}
        </Button>
      </div>
      {contentError && <Notice kind="error">{t("contentLimit")}</Notice>}
      {create.isError && !contentError && (
        <Notice kind="error">{t("saveFailed")}</Notice>
      )}
    </form>
  );
}
/** Keep reply content local until the server confirms posting. */
function ReplyForm({
  actor,
  thread,
  ref,
  quoting,
  onReplyPending,
}: {
  actor: string;
  thread: ForumThread;
  ref: Ref<{ append: (text: string) => void }>;
  quoting: boolean;
  onReplyPending: (pending: boolean) => void;
}) {
  const { t } = useTranslation("knowledge");
  const online = useOnline();
  const client = useQueryClient();
  const [content, setContent] = useState<JSONContent>(emptyDocument);
  const [contentError, setContentError] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [quoteLimit, setQuoteLimit] = useState(false);
  const contentRef = useRef<JSONContent>(emptyDocument);
  useImperativeHandle(
    ref,
    () => ({
      append: (text) => {
        const candidate: JSONContent = {
          type: "doc",
          content: [
            ...(contentRef.current.content ?? []),
            {
              type: "blockquote",
              content: [
                { type: "paragraph", content: [{ type: "text", text }] },
              ],
            },
            { type: "paragraph" },
          ],
        };
        const nodes = (value: JSONContent): number =>
          1 + (value.content ?? []).reduce((n, child) => n + nodes(child), 0);
        if (!contentIsValid(candidate) || nodes(candidate) > 1500) {
          setQuoteLimit(true);
          return;
        }
        contentRef.current = candidate;
        setQuoteLimit(false);
        setContent(candidate);
        setGeneration((value) => value + 1);
      },
    }),
    [],
  );
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const reply = useMutation({
    onMutate: () => onReplyPending(true),
    onSettled: () => onReplyPending(false),
    mutationFn: async () => {
      requireOnline();
      setContentError(false);
      if (!contentIsValid(content)) {
        setContentError(true);
        throw new Error("content_invalid");
      }
      const signature = JSON.stringify(content);
      if (!retry.current || retry.current.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      const { data, error } = await db().rpc("add_forum_post", {
        p_thread_id: thread.id,
        p_content: content,
        p_client_id: retry.current.key,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: knowledgeKeys.forum(actor) });
      contentRef.current = emptyDocument;
      setContent(emptyDocument);
      setGeneration((value) => value + 1);
      retry.current = null;
    },
  });
  return (
    <form
      className="knowledge-reply panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!quoting && !reply.isPending) reply.mutate();
      }}
    >
      <h3>{t("reply")}</h3>
      <KnowledgeEditor
        key={generation}
        value={content}
        onChange={(value) => {
          contentRef.current = value;
          setContent(value);
        }}
        label={t("reply")}
        disabled={reply.isPending || quoting}
      />
      <div className="form-actions">
        <Button disabled={!online || reply.isPending || quoting}>
          {t(reply.isPending ? "replying" : "postReply")}
        </Button>
      </div>
      {reply.isSuccess && <Notice>{t("replySent")}</Notice>}
      {(contentError || quoteLimit) && (
        <Notice kind="error">{t("contentLimit")}</Notice>
      )}
      {reply.isError && !contentError && (
        <Notice kind="error">{t("replyFailed")}</Notice>
      )}
    </form>
  );
}
/** Render a permitted post with own-edit and applicable moderation/answer actions. */
function ForumPostView({
  actor,
  thread,
  post,
  index,
  canModerate,
  zone,
  onQuote,
  quoteDisabled,
}: {
  actor: string;
  thread: ForumThread;
  post: ForumPost;
  index: number;
  canModerate: boolean;
  zone: string;
  onQuote: (id: string) => void;
  quoteDisabled: boolean;
}) {
  const { t, i18n } = useTranslation("knowledge");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [editing, setEditing] = useState<ForumPost | null>(null);
  const [draft, setDraft] = useState<JSONContent>(post.content);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [contentError, setContentError] = useState(false);
  const invalidate = () =>
    client.invalidateQueries({ queryKey: knowledgeKeys.forum(actor) });
  const edit = useMutation({
    mutationFn: async () => {
      requireOnline();
      setContentError(false);
      if (!editing || !contentIsValid(draft)) {
        setContentError(true);
        throw new Error("content_invalid");
      }
      const { error } = await db().rpc("edit_forum_post", {
        p_post_id: editing.id,
        p_content: draft,
        p_expected_version: editing.version,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("delete_forum_post", {
        p_post_id: post.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate();
      setDeleting(false);
    },
  });
  const accept = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("accept_forum_answer", {
        p_thread_id: thread.id,
        p_post_id: thread.accepted_post_id === post.id ? null : post.id,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const report = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (reason.trim().length < 5 || reason.trim().length > 2000)
        throw new Error("invalid_reason");
      const { error } = await db().rpc("report_forum_post", {
        p_post_id: post.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate();
      setReporting(false);
      setReason("");
    },
  });
  const canEdit =
    !post.deleted_at &&
    !thread.archived &&
    !thread.locked &&
    post.author_id === actor;
  const canDelete =
    !post.deleted_at &&
    (canModerate ||
      (post.author_id === actor && !thread.locked && !thread.archived));
  return (
    <article
      className={`forum-post panel ${thread.accepted_post_id === post.id ? "forum-accepted" : ""}`}
      data-post-id={post.id}
    >
      <header>
        <div>
          <strong>{post.author_name}</strong>
          <small>
            <time dateTime={post.created_at}>
              {new Intl.DateTimeFormat(i18n.language, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: zone,
              }).format(new Date(post.created_at))}
            </time>
            {post.edited_at ? ` · ${t("postEdited")}` : ""}
          </small>
        </div>
        {thread.accepted_post_id === post.id && (
          <span className="badge">
            <CheckCircle2 size={15} />
            {t("accepted")}
          </span>
        )}
      </header>
      {post.deleted_at ? (
        <p className="muted">{t("postDeleted")}</p>
      ) : (
        <KnowledgeEditor
          key={`${post.id}:${post.version}`}
          value={post.content}
          label={t("content")}
          readOnly
        />
      )}
      <div className="forum-post-actions">
        {!post.deleted_at && !thread.locked && !thread.archived && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!online || quoteDisabled}
            onClick={() => onQuote(post.id)}
          >
            {t("quoteReply")}
          </Button>
        )}
        {index > 0 &&
          !post.deleted_at &&
          (thread.owner_id === actor || canModerate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => accept.mutate()}
              disabled={!online || accept.isPending}
            >
              <CheckCircle2 size={15} />
              {t(
                thread.accepted_post_id === post.id
                  ? "clearAccepted"
                  : "acceptAnswer",
              )}
            </Button>
          )}
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(post.content);
              setEditing(post);
              setContentError(false);
              edit.reset();
            }}
            disabled={!online}
          >
            <Pencil size={14} />
            {t("editPost")}
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDeleting(true);
              remove.reset();
            }}
            disabled={!online}
          >
            <Trash2 size={14} />
            {t("deletePost")}
          </Button>
        )}
        {!post.deleted_at && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              report.reset();
              setReporting(true);
            }}
            disabled={!online}
          >
            <Flag size={14} />
            {t("report")}
          </Button>
        )}
      </div>
      {(accept.isError || remove.isError) && (
        <Notice kind="error">{t("actionFailed")}</Notice>
      )}
      {report.isSuccess && <Notice>{t("reported")}</Notice>}
      <Dialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next && !edit.isPending) setEditing(null);
        }}
        title={t("editPost")}
        description={t("threadHint")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            edit.mutate();
          }}
        >
          <KnowledgeEditor
            key={editing?.version ?? "none"}
            value={draft}
            onChange={setDraft}
            label={t("content")}
            disabled={edit.isPending}
          />
          <div className="form-actions">
            <Button disabled={!online || edit.isPending}>
              {common("save")}
            </Button>
          </div>
          {contentError && <Notice kind="error">{t("contentLimit")}</Notice>}
          {edit.isError && !contentError && (
            <Notice kind="error">{t("saveFailed")}</Notice>
          )}
        </form>
      </Dialog>
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteConfirm")}
        description={t("deleteHint")}
      >
        <p className="knowledge-delete-preview">{documentText(post.content)}</p>
        <div className="form-actions">
          <Button
            variant="secondary"
            onClick={() => setDeleting(false)}
            disabled={remove.isPending}
          >
            {common("cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => remove.mutate()}
            disabled={!online || remove.isPending}
          >
            {t("deletePost")}
          </Button>
        </div>
        {remove.isError && <Notice kind="error">{t("actionFailed")}</Notice>}
      </Dialog>
      <Dialog
        open={reporting}
        onOpenChange={setReporting}
        title={t("reportTitle")}
        description={t("reportHint")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            report.mutate();
          }}
        >
          <Field id={`report-${post.id}`} label={t("reportReason")}>
            <textarea
              id={`report-${post.id}`}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={5}
              maxLength={2000}
              required
            />
          </Field>
          <Button disabled={!online || report.isPending}>
            {t("reportSend")}
          </Button>
          {report.isError && <Notice kind="error">{t("actionFailed")}</Notice>}
        </form>
      </Dialog>
    </article>
  );
}
/** Combine thread, paginated posts and confirmed subscription/moderation actions. */
function ForumThreadView({
  actor,
  id,
  canModerate,
  onBack,
}: {
  actor: string;
  id: string;
  canModerate: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation("knowledge");
  const online = useOnline();
  const client = useQueryClient();
  const thread = useQuery({
    ...forumThreadQuery(actor, id),
    refetchInterval: 10000,
  });
  const posts = useQuery({
    ...forumPostsQuery(actor, id),
    refetchInterval: 10000,
  });
  const profile = useQuery(profileQuery(actor));
  const [moderating, setModerating] = useState(false);
  const [replyPending, setReplyPending] = useState(false);
  const replyRef = useRef<{ append: (text: string) => void }>(null);
  const quote = useMutation({
    mutationFn: async (postId: string) => {
      requireOnline();
      const { data, error } = await db().rpc("forum_posts", {
        p_thread_id: id,
      });
      if (error || !Array.isArray(data))
        throw error ?? new Error("unavailable");
      const current = (data as ForumPost[]).find(
        (post) => post.id === postId && !post.deleted_at,
      );
      if (!current) throw new Error("unavailable");
      const text = documentText(current.content).trim();
      if (!text) throw new Error("unavailable");
      return text;
    },
    onSuccess: (text) => replyRef.current?.append(text),
  });
  const subscription = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("subscribe_forum_thread", {
        p_thread_id: id,
        p_subscribed: !thread.data?.subscribed,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: knowledgeKeys.forum(actor) }),
  });
  const moderate = useMutation({
    mutationFn: async (field: "locked" | "pinned" | "archived") => {
      requireOnline();
      const { error } = await db().rpc("moderate_forum_thread", {
        p_thread_id: id,
        p_locked: field === "locked" ? !thread.data?.locked : null,
        p_pinned: field === "pinned" ? !thread.data?.pinned : null,
        p_archived: field === "archived" ? !thread.data?.archived : null,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: knowledgeKeys.forum(actor) }),
  });
  if (thread.isPending || posts.isPending) return <Loading />;
  if (thread.isError || posts.isError)
    return (
      <ErrorState
        retry={() => {
          void thread.refetch();
          void posts.refetch();
        }}
      />
    );
  if (!thread.data) return <Notice kind="error">{t("unavailable")}</Notice>;
  const value = thread.data;
  return (
    <>
      <section className="panel forum-thread-header">
        <Button
          className="knowledge-mobile-back"
          variant="ghost"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          {t("forum")}
        </Button>
        <div className="forum-thread-flags">
          {value.pinned && (
            <span className="badge">
              <Pin size={13} />
              {t("pinned")}
            </span>
          )}
          {value.locked && (
            <span className="badge">
              <LockKeyhole size={13} />
              {t("locked")}
            </span>
          )}
          {value.archived && <span className="badge">{t("archived")}</span>}
        </div>
        <h2>{value.title}</h2>
        <p className="knowledge-byline">
          {t("author", { name: value.owner_name })} ·{" "}
          {t("replies", { count: Number(value.post_count) })}
        </p>
        <div className="forum-thread-controls">
          {(canModerate ||
            (value.owner_id === actor && !value.locked && !value.archived)) && (
            <ForumMetadataEditor actor={actor} thread={value} />
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => subscription.mutate()}
            disabled={!online || subscription.isPending}
          >
            <Bell size={15} />
            {t(value.subscribed ? "unsubscribe" : "subscribe")}
          </Button>
          {canModerate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setModerating(true)}
            >
              <Settings2 size={15} />
              {t("moderate")}
            </Button>
          )}
        </div>
        {subscription.isError && (
          <Notice kind="error">{t("actionFailed")}</Notice>
        )}
      </section>
      <div className="forum-post-list">
        {posts.data.map((post, index) => (
          <ForumPostView
            key={post.id}
            actor={actor}
            thread={value}
            post={post}
            index={index}
            canModerate={canModerate}
            zone={profile.data?.time_zone ?? "Europe/Berlin"}
            onQuote={(postId) => quote.mutate(postId)}
            quoteDisabled={quote.isPending || replyPending}
          />
        ))}
      </div>
      {quote.isError && <Notice kind="error">{t("quoteUnavailable")}</Notice>}
      {value.archived ? (
        <Notice>{t("archivedHint")}</Notice>
      ) : value.locked ? (
        <Notice>{t("closedHint")}</Notice>
      ) : (
        <ReplyForm
          actor={actor}
          thread={value}
          ref={replyRef}
          quoting={quote.isPending}
          onReplyPending={setReplyPending}
        />
      )}
      <Dialog
        open={moderating}
        onOpenChange={setModerating}
        title={t("moderate")}
        description={value.title}
      >
        <div className="knowledge-moderation-actions">
          {(["pinned", "locked", "archived"] as const).map((field) => (
            <Button
              key={field}
              variant="secondary"
              disabled={!online || moderate.isPending}
              onClick={() => moderate.mutate(field)}
            >
              {t(
                field === "pinned"
                  ? value.pinned
                    ? "unpin"
                    : "pin"
                  : field === "locked"
                    ? value.locked
                      ? "unlock"
                      : "lock"
                    : value.archived
                      ? "unarchive"
                      : "archive",
              )}
            </Button>
          ))}
        </div>
        {moderate.isError && <Notice kind="error">{t("actionFailed")}</Notice>}
      </Dialog>
    </>
  );
}
/** Display permitted moderation reports and their explicit handling. */
function Reports({
  actor,
  open,
  onOpenChange,
  onThread,
}: {
  actor: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onThread: (id: string) => void;
}) {
  const { t } = useTranslation("knowledge");
  const online = useOnline();
  const client = useQueryClient();
  const reports = useQuery({ ...forumReportsQuery(actor), enabled: open });
  const resolve = useMutation({
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      requireOnline();
      const { error } = await db().rpc("resolve_forum_report", {
        p_report_id: id,
        p_resolved: resolved,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: knowledgeKeys.forum(actor) }),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("reports")}
      description={t("reportsHint")}
    >
      {reports.isPending ? (
        <Loading />
      ) : reports.isError ? (
        <ErrorState retry={() => void reports.refetch()} />
      ) : reports.data.length ? (
        <ul className="forum-reports-list">
          {reports.data.map((report) => (
            <li key={report.id}>
              <span className="badge">
                {t(report.status === "resolved" ? "resolved" : "openReport")}
              </span>
              <p>{report.reason}</p>
              <small>{report.reporter_name}</small>
              <div className="form-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onThread(report.thread_id);
                  }}
                >
                  {t("viewThread")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!online || resolve.isPending}
                  onClick={() =>
                    resolve.mutate({
                      id: report.id,
                      resolved: report.status !== "resolved",
                    })
                  }
                >
                  {t(report.status === "resolved" ? "reopenReport" : "resolve")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("noReports")}</p>
      )}
      {resolve.isError && <Notice kind="error">{t("actionFailed")}</Notice>}
    </Dialog>
  );
}
/** Coordinate category/thread selection, search and authorized forum moderation. */
export function ForumPage() {
  const { t, i18n } = useTranslation("knowledge");
  const online = useOnline();
  const { session } = useAuth();
  const actor = session!.user.id;
  const access = useQuery(knowledgeAccessQuery(actor));
  const categories = useQuery({
    ...categoriesQuery(actor, "forum"),
    enabled: Boolean(access.data?.can_author),
  });
  const [params, setParams] = useSearchParams();
  const id = params.get("thread");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [archived, setArchived] = useState(false);
  const [writing, setWriting] = useState(false);
  const [managing, setManaging] = useState(false);
  const [reports, setReports] = useState(false);
  const threads = useQuery({
    ...forumListQuery(actor, search, category, archived),
    enabled: Boolean(access.data?.can_author),
  });
  const select = (nextId: string | null) => {
    const next = new URLSearchParams(params);
    if (nextId) next.set("thread", nextId);
    else next.delete("thread");
    setParams(next);
    setWriting(false);
  };
  if (access.isPending) return <Loading />;
  if (access.isError) return <ErrorState retry={() => void access.refetch()} />;
  if (!access.data?.can_author)
    return <Notice kind="error">{t("noAccess")}</Notice>;
  return (
    <>
      <PageHeading
        title={t("forum")}
        description={t("forumIntro")}
        action={
          <div className="knowledge-page-actions">
            {access.data.can_moderate_forum && (
              <>
                <Button variant="secondary" onClick={() => setReports(true)}>
                  <Flag size={15} />
                  {t("reports")}
                </Button>
                <Button variant="secondary" onClick={() => setManaging(true)}>
                  <Settings2 size={15} />
                  {t("manageCategories")}
                </Button>
              </>
            )}
            <Button
              onClick={() => {
                select(null);
                setWriting(true);
              }}
              disabled={!online}
            >
              <Plus size={17} />
              {t("newThread")}
            </Button>
          </div>
        }
      />
      <div
        className={`knowledge-workspace ${id || writing ? "knowledge-has-selection" : ""}`}
      >
        <aside className="knowledge-directory panel">
          <form
            className="knowledge-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(input.trim());
            }}
          >
            <Field id="forum-search" label={t("searchForum")}>
              <input
                id="forum-search"
                type="search"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                maxLength={200}
              />
            </Field>
            <Button variant="ghost" size="icon" aria-label={t("search")}>
              <Search size={18} />
            </Button>
          </form>
          <Field id="forum-filter-category" label={t("category")}>
            <select
              id="forum-filter-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">{t("all")}</option>
              {categories.data
                ?.filter((item) => !item.archived)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {i18n.language === "de" ? item.label_de : item.label_en}
                  </option>
                ))}
            </select>
          </Field>
          {access.data.can_moderate_forum && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={archived}
                onChange={(event) => setArchived(event.target.checked)}
              />
              {t("includeArchived")}
            </label>
          )}
          {threads.isPending ? (
            <Loading />
          ) : threads.isError ? (
            <ErrorState retry={() => void threads.refetch()} />
          ) : threads.data.length ? (
            <ul className="knowledge-item-list forum-thread-list">
              {threads.data.map((thread) => (
                <li key={thread.id}>
                  <button
                    className={id === thread.id ? "is-selected" : ""}
                    type="button"
                    aria-pressed={id === thread.id}
                    onClick={() => select(thread.id)}
                  >
                    <span>
                      <strong>{thread.title}</strong>
                      <small>
                        {i18n.language === "de"
                          ? thread.category_label_de
                          : thread.category_label_en}{" "}
                        · {t("replies", { count: Number(thread.post_count) })}
                      </small>
                    </span>
                    <span className="forum-list-icons">
                      {thread.pinned && (
                        <Pin size={14} aria-label={t("pinned")} />
                      )}
                      {thread.locked && (
                        <LockKeyhole size={14} aria-label={t("locked")} />
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="knowledge-empty-list">
              <MessageCircle size={28} />
              <h3>{t("noThreads")}</h3>
              <p>{t("noThreadsHint")}</p>
            </div>
          )}
        </aside>
        <div className="knowledge-main">
          {writing ? (
            categories.isError ? (
              <ErrorState retry={() => void categories.refetch()} />
            ) : categories.data?.some((item) => !item.archived) ? (
              <CreateThread
                actor={actor}
                categories={categories.data}
                onDone={select}
                onCancel={() => setWriting(false)}
              />
            ) : (
              <Notice>{t("categoryMissing")}</Notice>
            )
          ) : id ? (
            <ForumThreadView
              key={id}
              actor={actor}
              id={id}
              canModerate={access.data.can_moderate_forum}
              onBack={() => select(null)}
            />
          ) : (
            <div className="panel knowledge-welcome">
              <MessageCircle size={42} />
              <h2>{t("chooseThread")}</h2>
            </div>
          )}
        </div>
      </div>
      <CategoryManager
        actor={actor}
        kind="forum"
        open={managing}
        onOpenChange={setManaging}
      />
      {access.data.can_moderate_forum && (
        <Reports
          actor={actor}
          open={reports}
          onOpenChange={setReports}
          onThread={select}
        />
      )}
    </>
  );
}
