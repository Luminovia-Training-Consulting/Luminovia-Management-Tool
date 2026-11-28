/** Ticket ownership and current support capability govern replies, internal notes and dedicated scanned attachments; support never grants unrelated private-resource access. Components render pending, denied and committed outcomes separately and preserve reviewed form state. */
import { useRequestKey } from "../../lib/request-key";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LifeBuoy, MessageSquare, Upload } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { requireOnline, useOnline } from "../../lib/online";
import { dateTime } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { acceptedFiles, saveDownload, uploadDocument } from "../files/api";
import {
  createTicket,
  newTicketSchema,
  type SupportAction,
  supportCategories,
  type SupportContext,
  supportContextQuery,
  supportError,
  supportNextStatuses,
  supportStatuses,
  type SupportTicket,
  supportTicketQuery,
  supportTicketsQuery,
  updateTicket,
} from "./api";
import "./i18n";
import "./support.css";

/** Offer only course/claim/customer choices returned for this actor; identifiers are not an authorisation mechanism. */
function RelatedFields({
  context,
  values,
  onChange,
  disabled,
}: {
  context: SupportContext;
  values: { course_run_id: string; claim_id: string; organisation_id: string };
  onChange: (key: keyof typeof values, value: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("support");
  return (
    <fieldset className="support-related" disabled={disabled}>
      <legend>{t("related")}</legend>
      <p className="muted">{t("relatedHint")}</p>
      {(
        [
          ["course_run_id", "course", context.courses],
          ["claim_id", "claim", context.claims],
          ["organisation_id", "organisation", context.organisations],
        ] as const
      ).map(([key, label, options]) => (
        <Field key={key} id={`support-${key}`} label={t(label)}>
          <select
            value={values[key]}
            onChange={(event) => onChange(key, event.target.value)}
          >
            <option value="">—</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      ))}
    </fieldset>
  );
}

/** Create a private ticket from reviewed input and retain the same retry identity across uncertain transport results. */
function NewTicket({
  context,
  onCreated,
}: {
  context: SupportContext;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation("support");
  const online = useOnline();
  const [values, setValues] = useState({
    title: "",
    description: "",
    category: "general" as (typeof supportCategories)[number],
    course_run_id: "",
    claim_id: "",
    organisation_id: "",
  });
  const retry = useRequestKey();
  const [invalid, setInvalid] = useState(false);
  const create = useMutation({
    mutationFn: async () => {
      requireOnline();
      const parsed = newTicketSchema.safeParse(values);
      if (!parsed.success) {
        setInvalid(true);
        throw Error("invalid");
      }
      const signature = JSON.stringify(parsed.data);
      const retryId = retry.forInput(signature);
      return createTicket(parsed.data, retryId);
    },
    onSuccess: onCreated,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <Field
        id="support-title"
        label={t("titleLabel")}
        error={invalid && !values.title.trim()}
      >
        <input
          required
          maxLength={200}
          value={values.title}
          disabled={create.isPending}
          onChange={(event) =>
            setValues({ ...values, title: event.target.value })
          }
        />
      </Field>
      <Field id="support-category" label={t("category")}>
        <select
          value={values.category}
          disabled={create.isPending}
          onChange={(event) =>
            setValues({
              ...values,
              category: event.target.value as typeof values.category,
            })
          }
        >
          {supportCategories.map((category) => (
            <option key={category} value={category}>
              {t(category)}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="support-description"
        label={t("descriptionLabel")}
        error={invalid && !values.description.trim()}
      >
        <textarea
          required
          rows={6}
          maxLength={12000}
          value={values.description}
          disabled={create.isPending}
          onChange={(event) =>
            setValues({ ...values, description: event.target.value })
          }
        />
      </Field>
      {Boolean(
        context.courses.length ||
        context.claims.length ||
        context.organisations.length,
      ) && (
        <details className="support-related-disclosure">
          <summary>{t("related")}</summary>
          <RelatedFields
            context={context}
            values={values}
            disabled={create.isPending}
            onChange={(key, value) => setValues({ ...values, [key]: value })}
          />
        </details>
      )}
      <Button
        disabled={
          !online ||
          create.isPending ||
          !values.title.trim() ||
          !values.description.trim()
        }
      >
        {t(create.isPending ? "creating" : "create")}
      </Button>
      {create.isError && (
        <Notice kind="error">{t(supportError(create.error))}</Notice>
      )}
    </form>
  );
}

/** Page and search the current ownership/capability projection without fetching unrelated ticket bodies. */
function TicketList({
  actor,
  context,
}: {
  actor: string;
  context: SupportContext;
}) {
  const { t, i18n } = useTranslation("support");
  const online = useOnline();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState({ search: "", status: "" });
  const [pages, setPages] = useState<{ at: string; id: string }[]>([]);
  const cursor = pages.at(-1) ?? null;
  const searchField = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const tickets = useQuery(
    supportTicketsQuery(actor, filter.search, filter.status, cursor),
  );
  const filtered = Boolean(filter.search || filter.status);
  function resetFilters() {
    setSearch("");
    setStatus("");
    setFilter({ search: "", status: "" });
    setPages([]);
    searchField.current?.focus();
  }

  return (
    <>
      <PageHeading
        title={t("title")}
        description={t("description")}
        action={
          <Button onClick={() => setCreating(true)} disabled={!online}>
            {t("new")}
          </Button>
        }
      />
      <form
        className="panel support-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const term = search.trim();
          if (!cursor && filter.search === term && filter.status === status)
            void tickets.refetch();
          setPages([]);
          setFilter({ search: term, status });
        }}
      >
        <Field id="support-search" label={t("search")}>
          <input
            ref={searchField}
            type="search"
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field id="support-filter-status" label={t("status")}>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t("all")}</option>
            {supportStatuses.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </Field>
        <div className="support-actions">
          <Button disabled={!online || tickets.isFetching}>
            {t("filter")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!online || tickets.isFetching}
            onClick={() => {
              if (cursor) setPages([]);
              else void tickets.refetch();
            }}
          >
            {t("refresh")}
          </Button>
        </div>
      </form>
      {tickets.isError ? (
        <ErrorState retry={() => void tickets.refetch()} />
      ) : tickets.isPending ? (
        <Loading />
      ) : (
        <>
          <ul className="support-ticket-list">
            {tickets.data.items.map((ticket) => (
              <li key={ticket.id} className="panel support-ticket-card">
                <div>
                  <span className="badge">{t(ticket.category)}</span>{" "}
                  <span className="badge">{t(ticket.status)}</span>
                  <h2>
                    <Link to={`/support/${ticket.id}`}>{ticket.title}</Link>
                  </h2>
                  <p className="muted">
                    {t("requester")}: {ticket.requester_name}
                    {ticket.mine && ` · ${t("mine")}`}
                  </p>
                  <time dateTime={ticket.updated_at}>
                    {dateTime(ticket.updated_at, i18n.language, "UTC")} · UTC
                  </time>
                </div>
                <dl>
                  <dt>{t("priority")}</dt>
                  <dd>{t(ticket.priority)}</dd>
                  <dt>{t("assigned")}</dt>
                  <dd>{ticket.assigned_name || t("unassigned")}</dd>
                </dl>
              </li>
            ))}
          </ul>
          {!tickets.data.items.length && (
            <div className="panel support-empty">
              <p role="status">
                {t(cursor ? "emptyPage" : filtered ? "empty" : "emptyInbox")}
              </p>
              {filtered && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={resetFilters}
                >
                  {t("clearFilters")}
                </Button>
              )}
            </div>
          )}
          {(cursor || tickets.data.has_more) && (
            <div className="support-actions">
              <Button
                variant="secondary"
                disabled={!cursor || tickets.isFetching || !online}
                onClick={() => setPages((previous) => previous.slice(0, -1))}
              >
                {t("newer")}
              </Button>
              <Button
                variant="secondary"
                disabled={
                  !tickets.data.next_cursor ||
                  !tickets.data.has_more ||
                  tickets.isFetching ||
                  !online
                }
                onClick={() => {
                  const next = tickets.data.next_cursor;
                  if (next) setPages([...pages, next]);
                }}
              >
                {t("older")}
              </Button>
            </div>
          )}
        </>
      )}
      {context.can_manage && (
        <section className="panel support-report" aria-label={t("report")}>
          <h2>{t("report")}</h2>
          <p className="muted">{t("reportHint")}</p>
          {context.report.length ? (
            <div className="support-report-grid">
              {context.report.map((item) => (
                <article key={item.category}>
                  <h3>{t(item.category)}</h3>
                  <dl>
                    <dt>{t("outstanding")}</dt>
                    <dd>{item.outstanding}</dd>
                    <dt>{t("total")}</dt>
                    <dd>{item.total}</dd>
                    <dt>{t("resolution")}</dt>
                    <dd>
                      {item.resolution_hours === null
                        ? "—"
                        : new Intl.NumberFormat(i18n.language, {
                            maximumFractionDigits: 2,
                          }).format(item.resolution_hours)}
                    </dd>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <p>{t("noReport")}</p>
          )}
        </section>
      )}
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title={t("new")}
        description={t("privacy")}
      >
        <NewTicket
          context={context}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/support/${id}`);
          }}
        />
      </Dialog>
    </>
  );
}

/** Bind replies, decisions and internal notes to the reviewed ticket version and current support authority. */
function TicketActionForm({
  ticket,
  context,
  action,
  onDone,
}: {
  ticket: SupportTicket;
  context: SupportContext;
  action: SupportAction;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation("support");
  const online = useOnline();
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<string>(
    supportNextStatuses(ticket.status)[0] ?? "",
  );
  const [assignee, setAssignee] = useState(ticket.assigned_to ?? "");
  const [priority, setPriority] = useState<string>(ticket.priority);
  const [links, setLinks] = useState({
    course_run_id: ticket.course_run_id ?? "",
    claim_id: ticket.claim_id ?? "",
    organisation_id: ticket.organisation_id ?? "",
  });
  const retry = useRequestKey();
  const update = useMutation({
    mutationFn: async () => {
      requireOnline();
      const payload =
        action === "reply" || action === "internal_note"
          ? { body }
          : action === "status" || action === "reopen"
            ? { status, reason }
            : action === "assign"
              ? { user_id: assignee }
              : action === "priority"
                ? { priority }
                : links;
      const signature = JSON.stringify(payload);
      const retryId = retry.forInput(signature);
      return updateTicket(ticket.id, action, payload, ticket.version, retryId);
    },
    onSuccess: onDone,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate();
      }}
    >
      {(action === "reply" || action === "internal_note") && (
        <>
          <Field id="support-message" label={t("body")}>
            <textarea
              required
              rows={6}
              maxLength={12000}
              disabled={update.isPending}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
        </>
      )}
      {action === "status" && (
        <Field id="support-status" label={t("status")}>
          <select
            disabled={update.isPending}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {supportNextStatuses(ticket.status).map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(action === "status" || action === "reopen") && (
        <Field
          id="support-reason"
          label={t("reason")}
          hint={action === "reopen" ? t("reopenHint") : undefined}
        >
          <textarea
            required
            rows={4}
            maxLength={2000}
            disabled={update.isPending}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      )}
      {action === "assign" && (
        <Field id="support-assignee" label={t("assigned")}>
          <select
            disabled={update.isPending}
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">{t("unassigned")}</option>
            {context.staff.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {action === "priority" && (
        <Field id="support-priority" label={t("priority")}>
          <select
            disabled={update.isPending}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            {["low", "normal", "high", "urgent"].map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {action === "links" && (
        <RelatedFields
          context={context}
          values={links}
          disabled={update.isPending}
          onChange={(key, value) => setLinks({ ...links, [key]: value })}
        />
      )}
      <Button
        disabled={
          !online ||
          update.isPending ||
          ((action === "reply" || action === "internal_note") &&
            !body.trim()) ||
          ((action === "status" || action === "reopen") && !reason.trim())
        }
      >
        {t(
          action === "internal_note"
            ? "note"
            : action === "reply"
              ? "send"
              : "save",
        )}
      </Button>
      {update.isError && (
        <Notice kind="error">{t(supportError(update.error))}</Notice>
      )}
    </form>
  );
}

/** Use the existing quarantine/scan gateway before dedicating a clean version to this ticket; attachment ACLs remain server-side. */
function SupportUpload({
  ticket,
  onDone,
}: {
  ticket: SupportTicket;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation("support");
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const chooseFile = useRef<HTMLButtonElement>(null);
  const [internal, setInternal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const retry = useRef<{
    signature: string;
    uploadKey: string;
    attachKey: string;
    documentId?: string;
  } | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      requireOnline();
      const signature = JSON.stringify([
        file.name,
        file.size,
        file.lastModified,
        internal,
        ticket.id,
        ticket.version,
      ]);
      if (retry.current?.signature !== signature)
        retry.current = {
          signature,
          uploadKey: crypto.randomUUID(),
          attachKey: crypto.randomUUID(),
        };
      const request = retry.current!;
      if (!request.documentId)
        request.documentId = (
          await uploadDocument(
            file,
            {
              scope: "personal",
              kind: "material",
              clientId: request.uploadKey,
            },
            setProgress,
          )
        ).id;
      await updateTicket(
        ticket.id,
        "attach",
        { document_id: request.documentId, internal },
        ticket.version,
        request.attachKey,
      );
    },
    onSuccess: async () => {
      retry.current = null;
      setFile(null);
      setProgress(0);
      await onDone();
    },
  });
  return (
    <div className="support-upload">
      <p className="muted">{t("attachmentHint")}</p>
      {ticket.can_manage && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={internal}
            disabled={upload.isPending}
            onChange={(event) => setInternal(event.target.checked)}
          />
          {t("internalOnly")}
        </label>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={acceptedFiles}
        aria-label={t("chooseAttachment")}
        disabled={!online || upload.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            retry.current = null;
            upload.reset();
            setProgress(0);
            setFile(file);
          }
        }}
      />
      <Button
        variant="secondary"
        type="button"
        disabled={!online || upload.isPending}
        ref={chooseFile}
        onClick={() => input.current?.click()}
      >
        <Upload size={18} aria-hidden="true" />
        {t("chooseAttachment")}
      </Button>
      {file && (
        <div className="support-selection">
          <p>
            <strong>{file.name}</strong>
          </p>
          <p>{t(internal ? "internalAttachment" : "sharedAttachment")}</p>
          <div className="support-actions">
            <Button
              disabled={!online || upload.isPending}
              onClick={() => upload.mutate(file)}
            >
              {t("attachment")}
            </Button>
            <Button
              variant="ghost"
              disabled={upload.isPending}
              onClick={() => {
                setFile(null);
                retry.current = null;
                upload.reset();
                setProgress(0);
                chooseFile.current?.focus();
              }}
            >
              {t("removeAttachment")}
            </Button>
          </div>
        </div>
      )}
      {upload.isPending && (
        <p role="status">
          {t("uploadPending")} {Math.round(progress)}%
        </p>
      )}
      {upload.isError && (
        <Notice kind="error">
          {t(
            supportError(upload.error) === "error"
              ? "fileFailed"
              : supportError(upload.error),
          )}
        </Notice>
      )}
    </div>
  );
}

/** Render only current permitted messages, notes and files; hide retained staff-only content after a capability-denied refresh. */
function TicketDetail({
  actor,
  id,
  context,
}: {
  actor: string;
  id: string;
  context: SupportContext;
}) {
  const { t, i18n } = useTranslation("support");
  const online = useOnline();
  const cache = useQueryClient();
  const ticket = useQuery(supportTicketQuery(actor, id));
  const [editing, setEditing] = useState<{
    action: SupportAction;
    ticket: SupportTicket;
  } | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["support-ticket", actor, id] }),
      cache.invalidateQueries({ queryKey: ["support-tickets", actor] }),
      cache.invalidateQueries({ queryKey: ["support-context", actor] }),
      cache.invalidateQueries({ queryKey: ["notifications", actor] }),
    ]);
  };
  if (ticket.isError)
    return (
      <>
        <Link to="/support">{t("back")}</Link>
        <Notice kind="error">{t(supportError(ticket.error))}</Notice>
        <Button
          disabled={!online || ticket.isFetching}
          onClick={() => void refresh()}
        >
          {t("refresh")}
        </Button>
      </>
    );
  if (ticket.isPending) return <Loading />;
  const row = ticket.data;
  // A newly observed capability loss must immediately redact any retained
  // staff projection while the detailed query revalidates its own permission.
  if (row.can_manage && !context.can_manage)
    return <Notice kind="error">{t("denied")}</Notice>;
  const title = (action: SupportAction) =>
    action === "status"
      ? "changeStatus"
      : action === "internal_note"
        ? "internal"
        : action === "assign"
          ? "assigned"
          : action === "reply"
            ? "send"
            : action === "links"
              ? "related"
              : action;
  return (
    <div className="support-ticket-detail">
      <Link className="text-link support-back" to="/support">
        {t("back")}
      </Link>
      <PageHeading
        title={row.title}
        description={`${t(row.category)} · ${t(row.status)}`}
        action={
          <Button
            variant="secondary"
            disabled={!online || ticket.isFetching}
            onClick={() => void refresh()}
          >
            {t("refresh")}
          </Button>
        }
      />
      <section className="panel support-overview">
        <LifeBuoy size={28} aria-hidden="true" />
        <div>
          <p className="preserve-text">{row.description}</p>
          <dl>
            <dt>{t("requester")}</dt>
            <dd>{row.requester_name}</dd>
            <dt>{t("assigned")}</dt>
            <dd>{row.assigned_name || t("unassigned")}</dd>
            <dt>{t("priority")}</dt>
            <dd>{t(row.priority)}</dd>
          </dl>
          {(row.can_manage || row.can_reopen) && (
            <div className="support-actions">
              {row.can_manage &&
                (["status", "assign", "priority", "links"] as const)
                  .filter(
                    (action) =>
                      action !== "status" ||
                      supportNextStatuses(row.status).length,
                  )
                  .map((action) => (
                    <Button
                      key={action}
                      variant="secondary"
                      disabled={!online}
                      onClick={() => setEditing({ action, ticket: row })}
                    >
                      {t(title(action))}
                    </Button>
                  ))}
              {row.can_reopen && (
                <Button
                  variant="secondary"
                  disabled={!online}
                  onClick={() => setEditing({ action: "reopen", ticket: row })}
                >
                  {t("reopen")}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>{t("conversation")}</h2>
          {!["resolved", "closed"].includes(row.status) && (
            <div className="support-actions">
              <Button
                disabled={!online}
                onClick={() => setEditing({ action: "reply", ticket: row })}
              >
                <MessageSquare size={18} aria-hidden="true" />
                {t("send")}
              </Button>
              {row.can_manage && (
                <Button
                  variant="secondary"
                  disabled={!online}
                  onClick={() =>
                    setEditing({ action: "internal_note", ticket: row })
                  }
                >
                  {t("note")}
                </Button>
              )}
            </div>
          )}
        </div>
        {row.messages.length ? (
          <ol className="support-thread">
            {row.messages.map((message) => (
              <li
                key={message.id}
                className={message.internal ? "support-internal" : ""}
              >
                <div>
                  <strong>{message.author_name}</strong>{" "}
                  <time dateTime={message.created_at}>
                    {dateTime(message.created_at, i18n.language, "UTC")} · UTC
                  </time>
                </div>
                {message.internal && (
                  <span className="badge">{t("internal")}</span>
                )}
                <p className="preserve-text">{message.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">{t("noReplies")}</p>
        )}
      </section>
      <section className="panel">
        <h2>{t("attachments")}</h2>
        <ul className="support-files">
          {row.attachments.map((file) => (
            <li key={file.id}>
              <span>
                {file.name}{" "}
                {file.internal && (
                  <span className="badge">{t("internal")}</span>
                )}
              </span>
              <Button
                variant="ghost"
                disabled={!online || downloading !== null}
                aria-label={`${t("download")}: ${file.name}`}
                onClick={async () => {
                  setDownloadFailed(false);
                  setDownloading(file.id);
                  try {
                    await saveDownload(
                      file.document_id,
                      file.name,
                      file.version_id,
                    );
                  } catch {
                    setDownloadFailed(true);
                  } finally {
                    setDownloading(null);
                  }
                }}
              >
                {t("download")}
              </Button>
            </li>
          ))}
        </ul>
        {downloadFailed && <Notice kind="error">{t("fileFailed")}</Notice>}
        {!["resolved", "closed"].includes(row.status) && (
          <SupportUpload
            key={`${actor}:${id}:${row.version}`}
            ticket={row}
            onDone={refresh}
          />
        )}
      </section>
      <section className="panel">
        <h2>{t("history")}</h2>
        <ol className="support-history">
          {row.events.map((event) => (
            <li key={event.id}>
              <strong>
                {t(
                  event.action === "status"
                    ? "statusChanged"
                    : event.action === "priority"
                      ? "priorityChanged"
                      : event.action === "reopen"
                        ? "reopened"
                        : event.action,
                )}
              </strong>
              <span>
                {event.actor_name} ·{" "}
                {dateTime(event.created_at, i18n.language, "UTC")} · UTC
              </span>
              {event.new_status && (
                <p>
                  {t(event.previous_status ?? "open")} → {t(event.new_status)}
                </p>
              )}
              {event.reason && <p className="preserve-text">{event.reason}</p>}
            </li>
          ))}
        </ol>
      </section>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={t(editing ? title(editing.action) : "title")}
        description={t(
          editing?.action === "internal_note" ? "internalHint" : "privacy",
        )}
      >
        {editing && (
          <TicketActionForm
            key={`${editing.action}:${editing.ticket.version}`}
            ticket={editing.ticket}
            context={context}
            action={editing.action}
            onDone={async () => {
              await refresh();
              setEditing(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

/** Switch own list/detail routes with actor-scoped queries and keep offline mutations disabled. */
export function SupportDeskPage() {
  const { session } = useAuth();
  const { id } = useParams();
  const actor = session?.user.id ?? "";
  const context = useQuery({
    ...supportContextQuery(actor),
    enabled: Boolean(actor),
  });
  if (!actor) return null;
  if (context.isError)
    return <ErrorState retry={() => void context.refetch()} />;
  if (context.isPending) return <Loading />;
  return id ? (
    <TicketDetail
      key={`${actor}:${id}`}
      actor={actor}
      id={id}
      context={context.data}
    />
  ) : (
    <TicketList key={actor} actor={actor} context={context.data} />
  );
}
