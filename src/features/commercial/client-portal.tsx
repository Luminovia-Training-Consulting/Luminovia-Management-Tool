import { useRequestKey } from "../../lib/request-key";
import { CompanyJobDeletions } from "../deletions/deletions";
import { CompanyParticipantsPanel } from "../operations/company-participants";
import { CompanyLecturerBlocks } from "../operations/company-lecturer-blocks";
import { CompanyIntegrationPicker } from "../operations/company-integrations";
import {
  AdditionalCompanyDecisions,
  CompanyDecisions,
} from "./company-decisions";
/**
 * Organization-scoped course requests and client spending views. Membership limits available
 * organizations; publication and lecturer allocation remain separate server operations.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import "../learning/i18n";
import { CoursePhaseFilter } from "../learning/course-phase-filter";
import {
  scheduledCoursePhase,
  type CoursePhaseSelection,
} from "../learning/course-phase";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import {
  Building2,
  CalendarDays,
  Plus,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { sessionCacheBoundary } from "../auth/session-cache-boundary";
import { profileQuery, topicsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { JobDateRange } from "../jobs/session-range";
import { resolveJobSessions } from "../jobs/session-schedule";
import { dateTime, money, validZone } from "../../lib/dates";
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
  type ClientOrganisation,
  clientOrganisationsQuery,
  type ClientRequest,
  clientRequestsQuery,
  clientSpendQuery,
  companyMonthlySpendingQuery,
  commissionAccessQuery,
  commissionKeys,
} from "./commission-api";
import { CompanySpendingChart } from "./company-spending-chart";
import { PublishClientRequest } from "./pricing";
import { RequestBriefFields, RequestBriefPanel } from "./request-brief";
import {
  cleanRequestBrief,
  initialRequestBrief,
  validRequestBrief,
} from "./request-brief-api";
import "./platform-i18n";
import "./platform.css";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
  organisation: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  delivery_type: z.enum(["online", "onsite"]),
  location: z.string().max(500),
  time_zone: z.string().refine(validZone),
  gross_amount: z.number().positive().max(1000000),
  gross_total_amount: z.number().positive().max(1000000),
  currency: z.enum(["EUR", "AUD"]),
  rate_unit: z.enum([
    "per_day",
    "per_teaching_unit",
    "per_hour",
    "fixed_total",
  ]),
  topic_ids: z.array(z.string().uuid()),
  sessions: z
    .array(
      z.object({ starts_at: z.string().min(1), ends_at: z.string().min(1) }),
    )
    .min(1)
    .max(60),
});

/** Create an organization-bound course request from local schedule/price drafts. */
function RequestForm({
  actor,
  organisations,
  zone,
  onDone,
}: {
  actor: string;
  organisations: ClientOrganisation[];
  zone: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("platform");
  const { t: common, i18n } = useTranslation();
  const online = useOnline();
  const client = useQueryClient();
  const topics = useQuery(topicsQuery);
  const [invalidSessions, setInvalidSessions] = useState(false);
  const [brief, setBrief] = useState(initialRequestBrief);
  const { t: briefText } = useTranslation("requestBrief");
  const retry = useRequestKey();
  const [initial] = useState(() => {
    const day = DateTime.now().setZone(zone).plus({ days: 7 });
    return {
      starts_at: day.set({ hour: 9, minute: 0 }).toFormat("yyyy-MM-dd'T'HH:mm"),
      ends_at: day.set({ hour: 15, minute: 0 }).toFormat("yyyy-MM-dd'T'HH:mm"),
    };
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      organisation: organisations[0]?.id ?? "",
      title: "",
      description: "",
      delivery_type: "online",
      location: "",
      time_zone: zone,
      gross_amount: 800,
      gross_total_amount: 800,
      currency: "EUR",
      rate_unit: "fixed_total",
      topic_ids: [],
      sessions: [initial],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "sessions",
  });
  const save = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      requireOnline();
      setInvalidSessions(false);
      const sessions = resolveJobSessions(values.sessions, values.time_zone);
      if (!sessions) {
        setInvalidSessions(true);
        throw new Error("invalid_sessions");
      }
      const { organisation, ...rest } = values;
      const payload = { ...rest, sessions };
      const cleanedBrief = cleanRequestBrief(brief);
      if (!validRequestBrief(cleanedBrief, sessions))
        throw new Error("invalid_brief");
      const signature = JSON.stringify([organisation, payload, cleanedBrief]);
      const retryId = retry.forInput(signature);
      const { data, error } = await db().rpc(
        "create_client_request_with_brief",
        {
          p_organisation_id: organisation,
          p_payload: payload,
          p_brief: cleanedBrief,
          p_client_id: retryId,
        },
      );
      if (error || !data) throw error ?? new Error("unconfirmed");
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: commissionKeys.requests(actor) }),
        client.invalidateQueries({ queryKey: commissionKeys.spend(actor) }),
      ]);
      onDone();
    },
  });
  return (
    <form
      className="platform-request-form"
      noValidate
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
    >
      <Field
        id="request-org"
        label={t("organisations")}
        error={Boolean(form.formState.errors.organisation)}
      >
        <select
          id="request-org"
          {...form.register("organisation")}
          disabled={save.isPending}
        >
          {organisations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="request-title"
        label={common("title")}
        error={Boolean(form.formState.errors.title)}
      >
        <input
          id="request-title"
          maxLength={200}
          {...form.register("title")}
          disabled={save.isPending}
        />
      </Field>
      <Field
        id="request-description"
        label={common("description")}
        error={Boolean(form.formState.errors.description)}
      >
        <textarea
          id="request-description"
          rows={3}
          maxLength={10000}
          {...form.register("description")}
          disabled={save.isPending}
        />
      </Field>
      <div className="form-row">
        <Field id="request-delivery" label={common("delivery")}>
          <select
            id="request-delivery"
            {...form.register("delivery_type")}
            disabled={save.isPending}
          >
            <option value="online">{common("online")}</option>
            <option value="onsite">{common("onsite")}</option>
          </select>
        </Field>
        <Field
          id="request-location"
          label={t("location")}
          error={Boolean(form.formState.errors.location)}
        >
          <input
            id="request-location"
            {...form.register("location")}
            disabled={save.isPending}
          />
        </Field>
        <Field
          id="request-zone"
          label={common("timezone")}
          error={Boolean(form.formState.errors.time_zone)}
        >
          <input
            id="request-zone"
            {...form.register("time_zone")}
            disabled={save.isPending}
          />
        </Field>
      </div>
      <fieldset className="platform-sessions">
        <legend>{common("sessions")}</legend>
        <JobDateRange
          prefix="request"
          sessions={form.getValues("sessions")}
          onApply={replace}
          disabled={save.isPending}
        />
        {fields.map((field, index) => (
          <div className="session-form-row" key={field.id}>
            <Field
              id={`request-start-${index}`}
              label={`${common("start")} ${index + 1}`}
              error={Boolean(
                form.formState.errors.sessions?.[index]?.starts_at,
              )}
            >
              <input
                id={`request-start-${index}`}
                type="datetime-local"
                {...form.register(`sessions.${index}.starts_at`)}
                disabled={save.isPending}
              />
            </Field>
            <Field
              id={`request-end-${index}`}
              label={`${common("end")} ${index + 1}`}
              error={Boolean(form.formState.errors.sessions?.[index]?.ends_at)}
            >
              <input
                id={`request-end-${index}`}
                type="datetime-local"
                {...form.register(`sessions.${index}.ends_at`)}
                disabled={save.isPending}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${common("remove")} ${index + 1}`}
              disabled={fields.length === 1 || save.isPending}
              onClick={() => remove(index)}
            >
              <Trash2 size={17} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={fields.length >= 60 || save.isPending}
          onClick={() => append({ starts_at: "", ends_at: "" })}
        >
          <Plus size={16} />
          {t("addSession")}
        </Button>
      </fieldset>
      <div className="form-row">
        <Field
          id="request-rate"
          label={t("grossRate")}
          error={Boolean(form.formState.errors.gross_amount)}
        >
          <input
            id="request-rate"
            type="number"
            min="0"
            step="0.01"
            {...form.register("gross_amount", {
              valueAsNumber: true,
              onChange: (event) => {
                if (form.getValues("rate_unit") === "fixed_total")
                  form.setValue(
                    "gross_total_amount",
                    Number(event.target.value),
                  );
              },
            })}
            disabled={save.isPending}
          />
        </Field>
        <Field
          id="request-total"
          label={t("grossTotal")}
          error={Boolean(form.formState.errors.gross_total_amount)}
        >
          <input
            id="request-total"
            type="number"
            min="0.01"
            step="0.01"
            {...form.register("gross_total_amount", {
              valueAsNumber: true,
              onChange: (event) => {
                if (form.getValues("rate_unit") === "fixed_total")
                  form.setValue("gross_amount", Number(event.target.value));
              },
            })}
            disabled={save.isPending}
          />
        </Field>
        <Field id="request-currency" label={common("currency")}>
          <select
            id="request-currency"
            {...form.register("currency")}
            disabled={save.isPending}
          >
            <option>EUR</option>
            <option>AUD</option>
          </select>
        </Field>
        <Field id="request-unit" label={common("unit")}>
          <select
            id="request-unit"
            {...form.register("rate_unit", {
              onChange: (event) => {
                if (event.target.value === "fixed_total")
                  form.setValue(
                    "gross_amount",
                    form.getValues("gross_total_amount"),
                  );
              },
            })}
            disabled={save.isPending}
          >
            {["per_day", "per_teaching_unit", "per_hour", "fixed_total"].map(
              (unit) => (
                <option key={unit} value={unit}>
                  {common(unit)}
                </option>
              ),
            )}
          </select>
        </Field>
      </div>
      {topics.isError ? (
        <ErrorState retry={() => void topics.refetch()} />
      ) : (
        <fieldset className="platform-topics">
          <legend>{common("topic")}</legend>
          {topics.data?.map((topic) => (
            <label key={topic.id} className="checkbox-label">
              <input
                type="checkbox"
                value={topic.id}
                {...form.register("topic_ids")}
                disabled={save.isPending}
              />
              {i18n.language === "de" ? topic.label_de : topic.label_en}
            </label>
          ))}
        </fieldset>
      )}
      <RequestBriefFields
        value={brief}
        onChange={setBrief}
        disabled={save.isPending}
      />
      <p className="muted commercial-small">{t("requestHint")}</p>
      <div className="form-actions">
        <Button
          disabled={
            !online || save.isPending || topics.isPending || topics.isError
          }
        >
          {t("requestSave")}
        </Button>
      </div>
      {Object.keys(form.formState.errors).length > 0 && (
        <Notice kind="error">{common("invalidForm")}</Notice>
      )}
      {save.isError && (
        <Notice kind="error">
          {save.error instanceof Error && save.error.message === "invalid_brief"
            ? briefText("invalid")
            : t(invalidSessions ? "invalidSessions" : "requestFailed")}
        </Notice>
      )}
    </form>
  );
}

/** Show confirmed request state and applicable next actions for this organization. */
function RequestCard({
  actor,
  request,
  manager,
}: {
  actor: string;
  request: ClientRequest;
  manager: boolean;
}) {
  const { t, i18n } = useTranslation("platform");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const cancel = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("cancel_client_request", {
        p_request_id: request.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: commissionKeys.requests(actor) }),
        client.invalidateQueries({ queryKey: commissionKeys.spend(actor) }),
      ]);
      setCancelling(false);
    },
  });
  const submitted = request.status === "submitted" && !request.job_id;
  const statusKey = {
    submitted: "requestSubmitted",
    published: "requestPublished",
    assigned: "requestAssigned",
    cancelled: "requestCancelled",
  }[request.status];
  return (
    <article className="panel platform-request-card">
      <div className="commercial-card-heading">
        <div>
          <span className="eyebrow">{request.organisation_name}</span>
          <h2>{request.title}</h2>
        </div>
        <span className="badge">{t(statusKey)}</span>
      </div>
      <p className="preserve-text">{request.description}</p>
      <dl className="commercial-facts">
        <dt>{t("grossTotal")}</dt>
        <dd>
          <strong>
            {money(
              Number(request.gross_total_amount),
              request.currency,
              i18n.language,
            )}
          </strong>
        </dd>
        <dt>{common("unit")}</dt>
        <dd>
          {money(Number(request.gross_amount), request.currency, i18n.language)}{" "}
          · {common(request.rate_unit)}
        </dd>
        <dt>{common("delivery")}</dt>
        <dd>
          {common(request.delivery_type)} · {request.location}
        </dd>
      </dl>
      <ol className="platform-session-list">
        {request.sessions.map((session, index) => (
          <li key={`${session.starts_at}-${index}`}>
            <CalendarDays size={16} />
            <span>
              {dateTime(session.starts_at, i18n.language, request.time_zone)} –{" "}
              {dateTime(session.ends_at, i18n.language, request.time_zone)}
              <small>{request.time_zone}</small>
            </span>
          </li>
        ))}
      </ol>
      <div className="platform-teacher">
        <UserRound size={18} />
        <span>
          {request.assigned_lecturers?.length || request.assigned_lecturer_name
            ? `${t("assignedTeacher")}: ${request.assigned_lecturers?.length ? request.assigned_lecturers.map((person) => person.display_name).join(", ") : request.assigned_lecturer_name}`
            : t("unassigned")}
        </span>
      </div>
      {!manager && request.job_id && (
        <CompanyDecisions
          actor={actor}
          job={request.job_id}
          zone={request.time_zone}
        />
      )}
      <RequestBriefPanel actor={actor} request={request} />
      {submitted && (
        <div className="form-actions">
          {manager && (
            <Button disabled={!online} onClick={() => setPublishing(true)}>
              {t("publishRequest")}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={!online}
            onClick={() => setCancelling(true)}
          >
            {t("cancelRequest")}
          </Button>
        </div>
      )}
      <Dialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("cancelTitle")}
        description={t("cancelHint")}
      >
        <p>{request.title}</p>
        <div className="form-actions">
          <Button
            variant="secondary"
            onClick={() => setCancelling(false)}
            disabled={cancel.isPending}
          >
            {common("cancel")}
          </Button>
          <Button
            disabled={!online || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t("cancelRequest")}
          </Button>
        </div>
        {cancel.isError && <Notice kind="error">{t("requestFailed")}</Notice>}
      </Dialog>
      <Dialog
        open={publishing}
        onOpenChange={setPublishing}
        title={t("publishRequest")}
        description={t("publishHint")}
      >
        {publishing && (
          <PublishClientRequest
            actor={actor}
            request={request}
            onDone={() => setPublishing(false)}
          />
        )}
      </Dialog>
    </article>
  );
}

/** Combine permitted client organizations, requests and the actor's spending projection. */
export function ClientPortalPage() {
  const { t, i18n } = useTranslation("platform");
  const { t: common } = useTranslation();
  const { session } = useAuth();
  const actor = session!.user.id;
  const online = useOnline();
  const access = useQuery(commissionAccessQuery(actor));
  const eligible = Boolean(
    access.data?.can_request || access.data?.can_manage_gross,
  );
  const orgs = useQuery({
    ...clientOrganisationsQuery(actor),
    enabled: eligible,
  });
  const [organisation, setOrganisation] = useState("");
  const requests = useQuery({
    ...clientRequestsQuery(actor, organisation || null),
    enabled: eligible,
    refetchInterval: 30000,
  });
  const spend = useQuery({ ...clientSpendQuery(actor), enabled: eligible });
  const monthly = useQuery({
    ...companyMonthlySpendingQuery(actor, organisation || null),
    enabled: Boolean(
      access.data?.can_request && !access.data?.can_manage_gross,
    ),
  });
  const profile = useQuery(profileQuery(actor));
  const [writing, setWriting] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState<CoursePhaseSelection>("all");
  if (access.isPending) return <Loading />;
  if (access.isError) return <ErrorState retry={() => void access.refetch()} />;
  if (!eligible)
    return (
      <>
        <PageHeading title={t("clientPortal")} />
        <Notice kind="error">{t("noMembership")}</Notice>
      </>
    );
  const filtered =
    requests.data?.filter(
      (row) =>
        (!status || row.status === status) &&
        (phase === "all" ||
          scheduledCoursePhase(row.sessions, requests.dataUpdatedAt) ===
            phase) &&
        `${row.title} ${row.organisation_name} ${row.assigned_lecturer_name ?? ""} ${row.assigned_lecturers?.map((person) => person.display_name).join(" ") ?? ""}`
          .toLocaleLowerCase(i18n.language)
          .includes(search.toLocaleLowerCase(i18n.language)),
    ) ?? [];
  const statusOptions = [
    ["submitted", "requestSubmitted"],
    ["published", "requestPublished"],
    ["assigned", "requestAssigned"],
    ["cancelled", "requestCancelled"],
  ];
  return (
    <>
      <PageHeading
        title={t("clientPortal")}
        description={t("clientIntro")}
        action={
          <Button
            disabled={!online || !orgs.data?.length}
            onClick={() => setWriting(true)}
          >
            <Plus size={17} />
            {t("newRequest")}
          </Button>
        }
      />
      <div className="page-actions">
        <Button asChild variant="secondary">
          <Link to="/learning">{t("learning:hub")}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link
            to={
              access.data?.can_request
                ? "/analytics?scope=company"
                : "/analytics"
            }
          >
            {common("analytics")}
          </Link>
        </Button>
      </div>
      {orgs.isError ||
      requests.isError ||
      spend.isError ||
      (monthly.isEnabled && monthly.isError) ? (
        <ErrorState
          retry={() => {
            void orgs.refetch();
            void requests.refetch();
            void spend.refetch();
            if (monthly.isError) void monthly.refetch();
          }}
        />
      ) : orgs.isPending ||
        requests.isPending ||
        spend.isPending ||
        (monthly.isEnabled && monthly.isPending) ? (
        <Loading />
      ) : (
        <>
          <div className="platform-spend-grid">
            {spend.data
              .filter(
                (row) => !organisation || row.organisation_id === organisation,
              )
              .map((row) => (
                <section
                  className="panel platform-spend-card"
                  key={`${row.organisation_id}-${row.currency}`}
                >
                  <span className="eyebrow">
                    {row.organisation_name} · {row.currency}
                  </span>
                  <dl>
                    <dt>{t("requestVolume")}</dt>
                    <dd>
                      {money(
                        Number(row.gross_total_amount),
                        row.currency,
                        i18n.language,
                      )}
                    </dd>
                    <dt>{t("confirmedSpend")}</dt>
                    <dd>
                      {money(
                        Number(row.gross_assigned_amount),
                        row.currency,
                        i18n.language,
                      )}
                    </dd>
                  </dl>
                  <p className="muted commercial-small">
                    {t("teachers")}:{" "}
                    {row.teachers
                      .map((person) => person.display_name)
                      .join(", ") || "—"}
                  </p>
                </section>
              ))}
          </div>
          {!access.data.can_manage_gross && monthly.data && (
            <CompanySpendingChart
              rows={monthly.data}
              exportScope={{
                actor,
                organisation: organisation || null,
                boundary: sessionCacheBoundary(session?.access_token),
              }}
            />
          )}
          <div className="section-stack company-operation-sections">
            <CompanyLecturerBlocks actor={actor} organisations={orgs.data} />
            {access.data.can_request && !access.data.can_manage_gross && (
              <CompanyIntegrationPicker
                actor={actor}
                organisations={orgs.data}
                zone={profile.data?.time_zone ?? "Europe/Berlin"}
              />
            )}
            {access.data.can_request &&
              !access.data.can_manage_gross &&
              orgs.data.map((org) => (
                <CompanyParticipantsPanel
                  key={org.id}
                  actor={actor}
                  organisationId={org.id}
                />
              ))}
          </div>
          <section className="panel platform-filters">
            <Search size={18} />
            <Field id="client-search" label={t("searchRequests")}>
              <input
                id="client-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Field id="client-organisation" label={t("organisations")}>
              <select
                id="client-organisation"
                value={organisation}
                onChange={(event) => setOrganisation(event.target.value)}
              >
                <option value="">{t("allOrganisations")}</option>
                {orgs.data.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </Field>
            <CoursePhaseFilter
              id="client-request-phase"
              value={phase}
              onChange={setPhase}
              requested
            />
            <Field id="client-status" label={t("requestStatus")}>
              <select
                id="client-status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{t("allStatuses")}</option>
                {statusOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </Field>
          </section>
          {filtered.length ? (
            <div className="commercial-contract-grid">
              {filtered.map((request) => (
                <RequestCard
                  key={request.id}
                  actor={actor}
                  request={request}
                  manager={access.data.can_manage_gross}
                />
              ))}
            </div>
          ) : (
            <div className="panel commercial-empty">
              <Building2 size={34} />
              <p>{orgs.data.length ? t("noRequests") : t("noMembership")}</p>
            </div>
          )}
        </>
      )}
      {!access.data.can_manage_gross && (
        <AdditionalCompanyDecisions
          actor={actor}
          excludedJobs={(requests.data ?? []).flatMap((request) =>
            request.job_id ? [request.job_id] : [],
          )}
          zone={profile.data?.time_zone ?? "Europe/Berlin"}
        />
      )}
      <CompanyJobDeletions />
      <Dialog
        open={writing}
        onOpenChange={setWriting}
        title={t("newRequest")}
        description={t("requestHint")}
      >
        {writing && orgs.data && (
          <RequestForm
            actor={actor}
            organisations={orgs.data}
            zone={profile.data?.time_zone ?? "Europe/Berlin"}
            onDone={() => setWriting(false)}
          />
        )}
      </Dialog>
    </>
  );
}
