/** Private management inbox and course conversion UI; never submits public website input. */
import { useRequestKey } from "../../lib/request-key";
import { installationBrand } from "../../lib/installation-brand";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
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
  enquirySessions,
  enquiryStatuses,
  manageEnquiry,
  nextEnquiryStatuses,
} from "./api";
import "./i18n";
import "./enquiries.css";

/** Keep operation identifiers out of user-visible bilingual labels. */
function actionLabel(action: EnquiryAction) {
  return {
    status: "statusAction",
    assign: "assignAction",
    link_customer: "linkAction",
    create_customer: "createAction",
    convert: "convertAction",
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
  action: EnquiryAction;
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
  const [template, setTemplate] = useState("");
  const [zone, setZone] = useState(enquiry.payload.time_zone);
  const [delivery, setDelivery] = useState(
    enquiry.payload.delivery_type === "onsite" ? "onsite" : "online",
  );
  const [venue, setVenue] = useState("");
  const [sessions, setSessions] = useState([{ starts_at: "", ends_at: "" }]);
  const [timeInvalid, setTimeInvalid] = useState(false);
  const retry = useRequestKey();
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      const times =
        action === "convert" ? enquirySessions(sessions, zone) : null;
      if (action === "convert" && !times) {
        setTimeInvalid(true);
        throw Error("invalid_schedule");
      }
      const payload =
        action === "status"
          ? { status, reason }
          : action === "note"
            ? { note: reason }
            : action === "assign"
              ? { user_id: assignee }
              : action === "link_customer"
                ? { organisation_id: organisation }
                : action === "convert"
                  ? {
                      template_id: template,
                      time_zone: zone,
                      delivery_type: delivery,
                      venue,
                      sessions: times,
                    }
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
  const updateSession = (
    index: number,
    key: "starts_at" | "ends_at",
    value: string,
  ) => {
    setSessions(
      sessions.map((session, row) =>
        row === index ? { ...session, [key]: value } : session,
      ),
    );
    setTimeInvalid(false);
  };
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
      {action === "convert" && (
        <>
          <p className="muted">{t("convertHelp")}</p>
          <Field id="enquiry-template" label={t("template")}>
            <select
              value={template}
              disabled={save.isPending}
              onChange={(event) => setTemplate(event.target.value)}
            >
              <option value="">{t("newTemplate")}</option>
              {context.templates.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="enquiry-zone" label={t("timeZone")}>
            <input
              required
              maxLength={100}
              value={zone}
              disabled={save.isPending}
              onChange={(event) => {
                setZone(event.target.value);
                setTimeInvalid(false);
              }}
            />
          </Field>
          <Field id="enquiry-delivery" label={t("delivery")}>
            <select
              value={delivery}
              disabled={save.isPending}
              onChange={(event) => setDelivery(event.target.value)}
            >
              <option value="online">{t("online")}</option>
              <option value="onsite">{t("onsite")}</option>
            </select>
          </Field>
          <Field id="enquiry-venue" label={t("venue")}>
            <input
              maxLength={500}
              value={venue}
              disabled={save.isPending}
              onChange={(event) => setVenue(event.target.value)}
            />
          </Field>
          <fieldset className="enquiry-sessions" disabled={save.isPending}>
            <legend>{t("sessions")}</legend>
            {sessions.map((session, index) => (
              <div key={index} className="enquiry-session">
                <Field
                  id={`enquiry-start-${index}`}
                  label={`${t("start")} ${index + 1}`}
                >
                  <input
                    type="datetime-local"
                    required
                    value={session.starts_at}
                    onChange={(event) =>
                      updateSession(index, "starts_at", event.target.value)
                    }
                  />
                </Field>
                <Field
                  id={`enquiry-end-${index}`}
                  label={`${t("end")} ${index + 1}`}
                >
                  <input
                    type="datetime-local"
                    required
                    value={session.ends_at}
                    onChange={(event) =>
                      updateSession(index, "ends_at", event.target.value)
                    }
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={sessions.length === 1}
                  aria-label={`${t("removeSession")} ${index + 1}`}
                  onClick={() =>
                    setSessions(sessions.filter((_, row) => row !== index))
                  }
                >
                  {t("removeSession")}
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              type="button"
              disabled={sessions.length >= 60}
              onClick={() =>
                setSessions([...sessions, { starts_at: "", ends_at: "" }])
              }
            >
              {t("addSession")}
            </Button>
          </fieldset>
          {timeInvalid && <Notice kind="error">{t("timeInvalid")}</Notice>}
        </>
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
      {save.isError && !timeInvalid && (
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
}: {
  actor: string;
  id: string;
  context: EnquiryContext;
}) {
  const { t, i18n } = useTranslation("enquiries");
  const online = useOnline();
  const cache = useQueryClient();
  const detail = useQuery(enquiryDetailQuery(actor, id));
  const [editing, setEditing] = useState<{
    action: EnquiryAction;
    snapshot: Enquiry;
  } | null>(null);
  const [saved, setSaved] = useState(false);
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
  const actions: EnquiryAction[] = [
    "assign",
    "note",
    ...(nextEnquiryStatuses(row.status).length ? ["status" as const] : []),
    ...(!row.course_run_id ? ["link_customer" as const] : []),
    ...(!row.organisation_id ? ["create_customer" as const] : []),
    ...(row.organisation_id &&
    !row.course_run_id &&
    row.status !== "closed" &&
    context.can_convert
      ? ["convert" as const]
      : []),
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
          {actions.map((action) => (
            <Button
              key={action}
              variant={action === "convert" ? "default" : "secondary"}
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
        {row.course_run_id && (
          <Link className="text-link" to="/courses">
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
          editing?.action === "convert"
            ? "convertHelp"
            : editing?.action === "create_customer"
              ? "createHelp"
              : "description",
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
function AuthorisedEnquiries({ actor, id }: { actor: string; id?: string }) {
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
  return <AuthorisedEnquiries key={actor} actor={actor} id={id} />;
}
