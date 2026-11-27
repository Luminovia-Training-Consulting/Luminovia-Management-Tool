/** Private management inbox and course conversion UI; never submits public website input. */
import { useRequestKey } from "../../lib/request-key";
import { installationBrand } from "../../lib/installation-brand";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Inbox, Mail } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery } from "../../lib/queries";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
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
  type Enquiry,
  type EnquiryAction,
  type EnquiryContext,
  enquiryContextQuery,
  enquiryDetailQuery,
  enquiryError,
  enquiryInboxQuery,
  enquiryStatuses,
  manageEnquiry,
  nextEnquiryStatuses,
} from "./api";
import {
  actOnCourseCreatorDraft,
  draftKey,
} from "../operations/course-creator-drafts-api";
import "./i18n";
import "./enquiries.css";

type TriageAction = Exclude<EnquiryAction, "convert">;

/** Keep operation identifiers out of user-visible bilingual labels. */
function actionLabel(action: TriageAction) {
  return {
    status: "statusAction",
    assign: "assignAction",
    link_customer: "linkAction",
    create_customer: "createAction",
    note: "noteAction",
  }[action];
}

/** Search only after explicit submission and display only confirmed private server pages. */
function EnquiryList({ actor }: { actor: string }) {
  const { t, i18n } = useTranslation("enquiries");
  const online = useOnline();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState({ search: "", status: "" });
  const [cursor, setCursor] = useState<{ at: string; id: string } | null>(null);
  const inbox = useQuery(
    enquiryInboxQuery(actor, filter.search, filter.status, cursor),
  );
  return (
    <>
      <PageHeading
        eyebrow={installationBrand.name}
        title={t("title")}
        description={t("description")}
      />
      <p className="panel enquiry-connection">
        <Inbox size={22} aria-hidden="true" />
        {t("connection")}
      </p>
      <form
        className="panel enquiry-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setCursor(null);
          setFilter({ search, status });
        }}
      >
        <Field id="enquiry-search" label={t("search")}>
          <input
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field id="enquiry-filter-status" label={t("status")}>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t("all")}</option>
            {enquiryStatuses.map((value) => (
              <option value={value} key={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </Field>
        <div className="enquiry-actions">
          <Button disabled={!online || inbox.isFetching}>{t("filter")}</Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!online || inbox.isFetching}
            onClick={() => void inbox.refetch()}
          >
            {t("refresh")}
          </Button>
        </div>
      </form>
      {inbox.isError ? (
        <ErrorState retry={() => void inbox.refetch()} />
      ) : inbox.isPending ? (
        <Loading />
      ) : (
        <>
          <ul className="enquiry-list">
            {inbox.data.items.map((item) => (
              <li className="panel enquiry-card" key={item.id}>
                <div>
                  <span className="badge">{t(item.status)}</span>
                  <h2>
                    <Link to={`/enquiries/${item.id}`}>{item.topic}</Link>
                  </h2>
                  <p>{item.company_name}</p>
                  <time dateTime={item.received_at}>
                    {dateTime(item.received_at, i18n.language, "UTC")} · UTC
                  </time>
                </div>
                <div>
                  <strong>{t("responsible")}</strong>
                  <p>{item.responsible_name || t("unassigned")}</p>
                  <Link className="text-link" to={`/enquiries/${item.id}`}>
                    <ArrowRight size={18} aria-hidden="true" />
                    {t("reviewing")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {!inbox.data.items.length && <p className="panel">{t("empty")}</p>}
          <div className="enquiry-actions">
            <Button
              variant="secondary"
              disabled={!online || !cursor || inbox.isFetching}
              onClick={() => setCursor(null)}
            >
              {t("first")}
            </Button>
            <Button
              variant="secondary"
              disabled={!online || !inbox.data.has_more || inbox.isFetching}
              onClick={() => setCursor(inbox.data.next_cursor)}
            >
              {t("older")}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

/** Capture one reviewed record/version while editing; background data cannot retarget consent. */
function EnquiryForm({
  enquiry,
  context,
  action,
  onDone,
}: {
  enquiry: Enquiry;
  context: EnquiryContext;
  action: TriageAction;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation("enquiries");
  const online = useOnline();
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<string>(
    nextEnquiryStatuses(enquiry.status)[0] ?? "",
  );
  const [assignee, setAssignee] = useState(enquiry.responsible_id ?? "");
  const [organisation, setOrganisation] = useState(
    enquiry.organisation_id ?? "",
  );
  const retry = useRequestKey();
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      const payload =
        action === "status"
          ? { status, reason }
          : action === "note"
            ? { note: reason }
            : action === "assign"
              ? { user_id: assignee }
              : action === "link_customer"
                ? { organisation_id: organisation }
                : {};
      // An uncertain retry of unchanged decisions retains its identity. Changed
      // fields receive a fresh key, while the captured reviewed version stays fixed.
      const signature = JSON.stringify(payload);
      const retryId = retry.forInput(signature);
      return manageEnquiry(
        enquiry.id,
        action,
        payload,
        enquiry.version,
        retryId,
      );
    },
    onSuccess: onDone,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      {action === "create_customer" && <p>{t("createHelp")}</p>}
      {action === "status" && (
        <Field id="enquiry-status" label={t("status")}>
          <select
            value={status}
            disabled={save.isPending}
            onChange={(event) => setStatus(event.target.value)}
          >
            {nextEnquiryStatuses(enquiry.status).map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(action === "status" || action === "note") && (
        <Field
          id="enquiry-reason"
          label={t(action === "note" ? "note" : "reason")}
        >
          <textarea
            required
            rows={5}
            maxLength={4000}
            value={reason}
            disabled={save.isPending}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      )}
      {action === "assign" && (
        <Field id="enquiry-responsible" label={t("responsible")}>
          <select
            value={assignee}
            disabled={save.isPending}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">{t("unassigned")}</option>
            {context.staff.map((person) => (
              <option value={person.id} key={person.id}>
                {person.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {action === "link_customer" && (
        <Field id="enquiry-customer" label={t("customer")}>
          <select
            required
            value={organisation}
            disabled={save.isPending}
            onChange={(event) => setOrganisation(event.target.value)}
          >
            <option value="">{t("none")}</option>
            {context.organisations.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Button
        disabled={
          !online ||
          save.isPending ||
          ((action === "status" || action === "note") && !reason.trim()) ||
          (action === "link_customer" && !organisation)
        }
      >
        {t("save")}
      </Button>
      {save.isError && (
        <Notice kind="error">{t(enquiryError(save.error))}</Notice>
      )}
    </form>
  );
}

/** Show literal original data and append-only history; errors win over retained private data. */
function EnquiryDetail({
  actor,
  id,
  context,
  canPrepareOffer,
}: {
  actor: string;
  id: string;
  context: EnquiryContext;
  canPrepareOffer: boolean;
}) {
  const { t, i18n } = useTranslation("enquiries");
  const online = useOnline();
  const cache = useQueryClient();
  const detail = useQuery(enquiryDetailQuery(actor, id));
  const [editing, setEditing] = useState<{
    action: TriageAction;
    snapshot: Enquiry;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const navigate = useNavigate();
  const start = useMutation({
    mutationFn: (version: number) =>
      actOnCourseCreatorDraft("start_enquiry", crypto.randomUUID(), 0, {
        enquiry_id: id,
        version,
      }),
    onSuccess: (draft) => {
      cache.setQueryData([...draftKey(actor), draft.id], [draft]);
      void cache.invalidateQueries({
        queryKey: [...draftKey(actor), ""],
        exact: true,
      });
      void navigate(`/courses?creator=${encodeURIComponent(draft.id)}`);
    },
  });
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["enquiry-detail", actor, id] }),
      cache.invalidateQueries({ queryKey: ["enquiry-inbox", actor] }),
      cache.invalidateQueries({ queryKey: ["enquiry-context", actor] }),
      cache.invalidateQueries({ queryKey: ["operations"] }),
    ]);
  };
  if (detail.isError)
    return (
      <>
        <Link to="/enquiries">{t("back")}</Link>
        <Notice kind="error">{t(enquiryError(detail.error))}</Notice>
        <Button
          disabled={!online || detail.isFetching}
          onClick={() => void refresh()}
        >
          {t("refresh")}
        </Button>
      </>
    );
  if (detail.isPending) return <Loading />;
  const row = detail.data,
    value = row.payload;
  const actions: TriageAction[] = [
    "assign",
    "note",
    ...(nextEnquiryStatuses(row.status).length ? ["status" as const] : []),
    ...(!row.course_run_id ? ["link_customer" as const] : []),
    ...(!row.organisation_id ? ["create_customer" as const] : []),
  ];
  return (
    <>
      <Link className="text-link" to="/enquiries">
        {t("back")}
      </Link>
      <PageHeading
        title={value.topic}
        description={`${value.company_name} · ${t(row.status)}`}
        action={
          <Button
            variant="secondary"
            disabled={!online || detail.isFetching}
            onClick={() => {
              setSaved(false);
              void refresh();
            }}
          >
            {t("refresh")}
          </Button>
        }
      />
      {saved && <Notice>{t("saved")}</Notice>}
      <section className="panel enquiry-original">
        <h2>{t("original")}</h2>
        <dl>
          {(
            [
              ["company", value.company_name],
              ["contact", value.contact_name],
              ["email", value.email],
              ["phone", value.phone || "—"],
              ["dates", value.preferred_dates || "—"],
              ["duration", value.duration || "—"],
              ["delivery", t(value.delivery_type)],
              ["timeZone", value.time_zone],
              ["authoredLanguage", value.locale.toUpperCase()],
              ["privacy", value.privacy_notice_version],
            ] as const
          ).map(([label, text]) => (
            <div key={label}>
              <dt>{t(label)}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <h3>{t("message")}</h3>
        <p className="preserve-text">{value.message}</p>
        <p className="muted">{t("privacyHelp")}</p>
      </section>
      <section className="panel enquiry-management">
        <dl>
          <dt>{t("responsible")}</dt>
          <dd>
            {context.staff.find((person) => person.id === row.responsible_id)
              ?.label || t("unassigned")}
          </dd>
          <dt>{t("linkedCustomer")}</dt>
          <dd>
            {context.organisations.find(
              (customer) => customer.id === row.organisation_id,
            )?.label || "—"}
          </dd>
        </dl>
        <div className="enquiry-actions">
          {row.organisation_id &&
            !row.course_run_id &&
            row.status !== "closed" &&
            context.can_convert && (
              <Button
                type="button"
                disabled={!online || start.isPending}
                onClick={() => start.mutate(row.version)}
              >
                {t("convertAction")}
              </Button>
            )}
          {actions.map((action) => (
            <Button
              key={action}
              variant="secondary"
              disabled={!online}
              onClick={() => {
                setSaved(false);
                setEditing({ action, snapshot: row });
              }}
            >
              {t(actionLabel(action))}
            </Button>
          ))}
        </div>
        {start.isError && (
          <Notice kind="error">{t(enquiryError(start.error))}</Notice>
        )}
        {row.course_run_id && canPrepareOffer && (
          <Link
            className="text-link"
            to={`/courses?offer=${encodeURIComponent(row.course_run_id)}`}
          >
            {t("continueOffer")}
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        )}
        {row.course_run_id && (
          <Link
            className="text-link"
            to={`/courses?run=${encodeURIComponent(row.course_run_id)}`}
          >
            {t("link")}
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        )}
        <a
          className="text-link"
          href={`mailto:${encodeURIComponent(value.email)}?subject=${encodeURIComponent(value.topic)}`}
        >
          <Mail size={18} aria-hidden="true" />
          {t("contactCustomer")}
        </a>
        <p className="muted">{t("contactHelp")}</p>
      </section>
      <section className="panel">
        <h2>{t("history")}</h2>
        <ol className="enquiry-history">
          {row.history.map((event) => (
            <li key={event.id}>
              <strong>{t(`event_${event.action}`)}</strong>
              <span>
                {event.actor_name || t("integration")} ·{" "}
                {dateTime(event.created_at, i18n.language, "UTC")} · UTC
              </span>
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
        title={t(editing ? actionLabel(editing.action) : "title")}
        description={t(
          editing?.action === "create_customer" ? "createHelp" : "description",
        )}
      >
        {editing && (
          <EnquiryForm
            key={`${editing.action}:${editing.snapshot.version}`}
            enquiry={editing.snapshot}
            context={context}
            action={editing.action}
            onDone={async () => {
              await refresh();
              setEditing(null);
              setSaved(true);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

/** Load directory choices only inside the current capability-gated route boundary. */
function AuthorisedEnquiries({
  actor,
  id,
  canPrepareOffer,
}: {
  actor: string;
  id?: string;
  canPrepareOffer: boolean;
}) {
  const context = useQuery(enquiryContextQuery(actor));
  if (context.isError)
    return <ErrorState retry={() => void context.refetch()} />;
  if (context.isPending) return <Loading />;
  return id ? (
    <EnquiryDetail
      key={`${actor}:${id}`}
      actor={actor}
      id={id}
      context={context.data}
      canPrepareOffer={canPrepareOffer}
    />
  ) : (
    <EnquiryList key={actor} actor={actor} />
  );
}

/** Role flags are presentation only; every matching RPC revalidates current DB authority. */
export function EnquiriesPage() {
  const { t } = useTranslation("enquiries");
  const { session } = useAuth();
  const { id } = useParams();
  const actor = session?.user.id ?? "";
  const permissions = useQuery({
    ...permissionsQuery(actor),
    enabled: Boolean(actor),
  });
  if (!actor) return null;
  if (permissions.isError)
    return <ErrorState retry={() => void permissions.refetch()} />;
  if (permissions.isPending) return <Loading />;
  if (!permissions.data.includes("organisations.manage"))
    return <Notice kind="error">{t("denied")}</Notice>;
  return (
    <AuthorisedEnquiries
      key={actor}
      actor={actor}
      id={id}
      canPrepareOffer={
        permissions.data.includes("courses.manage") &&
        permissions.data.includes("jobs.manage")
      }
    />
  );
}
