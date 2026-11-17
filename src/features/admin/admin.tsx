/**
 * Offer editor for standalone jobs and jobs derived from a course run. Retain the reviewed
 * source while editing; the server checks actual sessions and prices on save.
 */
import { OfferBoard } from "../jobs/board";
import { useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { RoleFeePreview } from "../commercial/pricing";
import {
  commissionAccessQuery,
  clientOrganisationsQuery,
  commissionKeys,
} from "../commercial/commission-api";
import "../commercial/platform-i18n";
import { BuildingBlockReference } from "../operations/building-blocks";
import {
  courseRunJobDefaultsQuery,
  type CourseRunJobDefaults,
} from "../operations/building-blocks-api";
import "./course-i18n";
import "../jobs/lifecycle-i18n";
import "../jobs/briefing-i18n";
import "../taxonomy/i18n";
import { selectableTopics } from "../taxonomy/selection";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery, topicsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { dateTime, money, validZone, zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  customer_name: z.string().trim().min(1).max(200),
  organisation: z.union([z.string().uuid(), z.literal("")]),
  delivery_type: z.enum(["online", "onsite"]),
  location: z.string().max(500),
  time_zone: z.string().refine(validZone),
  amount: z.number().nonnegative().max(1000000),
  total_amount: z.number().nonnegative().max(1000000),
  currency: z.enum(["EUR", "AUD"]),
  rate_unit: z.enum([
    "per_day",
    "per_teaching_unit",
    "per_hour",
    "fixed_total",
  ]),
  terms: z.string().min(1).max(10000),
  publish: z.boolean(),
  requires_contract: z.boolean(),
  claim_deadline: z.string(),
  capacity: z.number().int().min(1).max(20),
  topic_ids: z.array(z.string()),
  sessions: z
    .array(
      z.object({ starts_at: z.string().min(1), ends_at: z.string().min(1) }),
    )
    .min(1)
    .max(60),
});
/** Derive form values from the validation schema so runtime input checks and TypeScript agree. */
type Values = z.infer<typeof schema>;
/** Create the complete offer and bind a course-derived request to its reviewed source revision. */
function JobForm({
  courseRun: initialSource,
}: {
  courseRun?: CourseRunJobDefaults;
}) {
  // Keep the reviewed source stable while editing money. A background refetch
  // must not silently replace the schedule or bypass the server revision check.
  const [courseRun] = useState(initialSource);
  const { t, i18n } = useTranslation();
  const courseText = useTranslation("courseOffer").t;
  const lifeText = useTranslation("jobLifecycle").t;
  const briefingText = useTranslation("jobBriefing").t;
  const { t: priceText } = useTranslation("platform");
  const { session } = useAuth();
  const actor = session!.user.id;
  const pricing = useQuery(commissionAccessQuery(actor));
  const gross = Boolean(pricing.data?.can_manage_gross);
  const organisations = useQuery({
    ...clientOrganisationsQuery(actor),
    enabled: gross && !courseRun,
  });
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const online = useOnline();
  const topics = useQuery(topicsQuery);
  const client = useQueryClient();
  const [invalidTime, setInvalidTime] = useState(false);
  const [done, setDone] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    getValues,
    formState: { errors, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: courseRun?.title ?? "",
      description: courseRun?.description ?? "",
      customer_name: courseRun?.customer_name ?? "",
      organisation: courseRun?.organisation_id ?? "",
      delivery_type: courseRun?.delivery_type ?? "online",
      location: courseRun?.location ?? "",
      time_zone: courseRun?.time_zone ?? "Europe/Berlin",
      amount: 400,
      total_amount: 400 * (courseRun?.sessions.length ?? 5),
      currency: "EUR",
      rate_unit: "per_day",
      terms: "",
      publish: false,
      requires_contract: false,
      claim_deadline: "",
      capacity: 1,
      topic_ids: courseRun?.topic_ids ?? [],
      sessions: courseRun
        ? courseRun.sessions.map((session) => ({
            starts_at: DateTime.fromISO(session.starts_at)
              .setZone(courseRun.time_zone)
              .toFormat("yyyy-MM-dd'T'HH:mm"),
            ends_at: DateTime.fromISO(session.ends_at)
              .setZone(courseRun.time_zone)
              .toFormat("yyyy-MM-dd'T'HH:mm"),
          }))
        : Array.from({ length: 5 }, (_, i) => {
            const d = DateTime.now()
              .setZone("Europe/Berlin")
              .plus({ days: i + 7 });
            return {
              starts_at: d
                .set({ hour: 9, minute: 0 })
                .toFormat("yyyy-MM-dd'T'HH:mm"),
              ends_at: d
                .set({ hour: 15, minute: 0 })
                .toFormat("yyyy-MM-dd'T'HH:mm"),
            };
          }),
    },
  });
  const watchedTotal = useWatch({ control, name: "total_amount" });
  const watchedCurrency = useWatch({ control, name: "currency" });
  const watchedCapacity = useWatch({ control, name: "capacity" });
  const selectedTopicIds = useWatch({ control, name: "topic_ids" });
  const valuesTimeZone = useWatch({ control, name: "time_zone" });
  const selectedOrganisation = useWatch({ control, name: "organisation" });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "sessions",
  });
  const create = useMutation({
    mutationFn: async (values: Values) => {
      requireOnline();
      setDone(false);
      setCreatedId(null);
      setInvalidTime(false);
      const sessions = courseRun
        ? courseRun.sessions.map(({ starts_at, ends_at }) => ({
            starts_at,
            ends_at,
          }))
        : values.sessions.map((s) => {
            const starts = zonedInstant(s.starts_at, values.time_zone);
            const ends = zonedInstant(s.ends_at, values.time_zone);
            if (
              !starts ||
              !ends ||
              ends <= starts ||
              new Date(starts) <= new Date()
            ) {
              setInvalidTime(true);
              throw new Error("invalid_time");
            }
            return { starts_at: starts, ends_at: ends };
          });
      const {
        publish,
        claim_deadline,
        capacity,
        organisation,
        amount,
        total_amount,
        ...rest
      } = values;
      const deadline = claim_deadline
        ? zonedInstant(claim_deadline, values.time_zone)
        : null;
      if (
        claim_deadline &&
        (!deadline ||
          Date.parse(deadline) <= Date.now() ||
          sessions.some(
            (session) => Date.parse(deadline) > Date.parse(session.starts_at),
          ))
      ) {
        setInvalidTime(true);
        throw new Error("invalid_time");
      }
      const base = {
        ...rest,
        sessions,
        claim_deadline: deadline,
        status: publish ? "published" : "draft",
      };
      if (courseRun) {
        const payload = {
          source_revision: courseRun.source_revision,
          currency: values.currency,
          rate_unit: values.rate_unit,
          terms: values.terms,
          requires_contract: values.requires_contract,
          claim_deadline: deadline,
          status: base.status,
          ...(gross
            ? { gross_amount: amount, gross_total_amount: total_amount }
            : { amount, total_amount }),
        };
        const signature = JSON.stringify([courseRun.course_run_id, payload]);
        if (!retry.current || retry.current.signature !== signature)
          retry.current = { signature, key: crypto.randomUUID() };
        const { data, error } = await db().rpc("create_course_run_job", {
          p_course_run_id: courseRun.course_run_id,
          p_payload: payload,
          p_client_id: retry.current.key,
        });
        if (error || !data) throw error ?? new Error("unconfirmed");
        return data as string;
      }
      const payload = gross
        ? { ...base, gross_amount: amount, gross_total_amount: total_amount }
        : { ...base, amount, total_amount };
      const signature = JSON.stringify([organisation, capacity, payload]);
      if (!retry.current || retry.current.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      const { data, error } = await db().rpc("create_capacity_job", {
        p_payload: payload,
        p_capacity: capacity,
        p_request_id: retry.current.key,
        p_organisation_id: gross ? organisation || null : null,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
      return data as string;
    },
    onSuccess: async (jobId, values) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["jobs"] }),
        client.invalidateQueries({ queryKey: ["job-board"] }),
        client.invalidateQueries({ queryKey: ["job-lifecycle"] }),
        client.invalidateQueries({ queryKey: ["operations"] }),
        client.invalidateQueries({ queryKey: commissionKeys.spend(actor) }),
        client.invalidateQueries({ queryKey: commissionKeys.report(actor) }),
        client.invalidateQueries({ queryKey: commissionKeys.requests(actor) }),
        client.invalidateQueries({
          queryKey: commissionKeys.organisations(actor),
        }),
      ]);
      reset(values);
      setDone(true);
      setCreatedId(jobId);
    },
  });
  if (
    topics.isPending ||
    pricing.isPending ||
    (gross && !courseRun && organisations.isPending)
  )
    return <Loading />;
  if (
    topics.isError ||
    pricing.isError ||
    (gross && !courseRun && organisations.isError)
  )
    return (
      <ErrorState
        retry={() => {
          void topics.refetch();
          void pricing.refetch();
          if (gross) void organisations.refetch();
        }}
      />
    );
  return (
    <form
      className="panel admin-form"
      noValidate
      onSubmit={handleSubmit((values) => create.mutate(values))}
    >
      <h2>{courseRun ? courseText("fromCourse") : t("createJob")}</h2>
      {courseRun && (
        <>
          <p>{courseText("sourceHelp")}</p>
          <h3>{courseRun.title}</h3>
          <p className="preserve-text">{courseRun.description}</p>
          <p>
            {courseRun.customer_name} · {t(courseRun.delivery_type)} ·{" "}
            {courseRun.location} · {courseRun.time_zone}
          </p>
          <ol className="session-list">
            {courseRun.sessions.map((row) => (
              <li key={row.source_course_session_id}>
                <div>
                  <strong>
                    {dateTime(
                      row.starts_at,
                      i18n.language,
                      courseRun.time_zone,
                    )}
                  </strong>
                  <span>
                    {dateTime(row.ends_at, i18n.language, courseRun.time_zone)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <Button asChild variant="secondary">
            <Link to={`/courses?run=${courseRun.course_run_id}`}>
              {courseText("plan")}
            </Link>
          </Button>
          <BuildingBlockReference templateId={courseRun.template_id} />
        </>
      )}
      {!courseRun && (
        <>
          {gross && (
            <Field id="job-organisation" label={priceText("existingCustomer")}>
              <select
                id="job-organisation"
                {...register("organisation", {
                  onChange: (event) => {
                    const selected = organisations.data?.find(
                      (org) => org.id === event.target.value,
                    );
                    if (selected)
                      setValue("customer_name", selected.name, {
                        shouldDirty: true,
                      });
                  },
                })}
              >
                <option value="">{priceText("newCustomer")}</option>
                {organisations.data?.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="form-row">
            <Field
              id="job-title"
              label={t("title")}
              error={Boolean(errors.title)}
            >
              <input id="job-title" {...register("title")} />
            </Field>
            <Field
              id="job-customer"
              label={t("customer")}
              error={Boolean(errors.customer_name)}
            >
              <input
                id="job-customer"
                {...register("customer_name")}
                readOnly={Boolean(selectedOrganisation)}
              />
            </Field>
          </div>
          <Field
            id="job-description"
            label={t("description")}
            error={Boolean(errors.description)}
          >
            <textarea
              id="job-description"
              rows={4}
              {...register("description")}
            />
          </Field>
          <div className="form-row">
            <Field id="job-delivery" label={t("delivery")}>
              <select id="job-delivery" {...register("delivery_type")}>
                <option value="online">{t("online")}</option>
                <option value="onsite">{t("onsite")}</option>
              </select>
            </Field>
            <Field
              id="job-location"
              label={i18n.language === "de" ? "Ort / Link" : "Location / link"}
            >
              <input id="job-location" {...register("location")} />
            </Field>
            <Field
              id="job-zone"
              label={t("timezone")}
              error={Boolean(errors.time_zone)}
            >
              <input id="job-zone" {...register("time_zone")} />
            </Field>
          </div>
          <fieldset>
            <legend>{t("sessions")}</legend>
            {fields.map((field, index) => (
              <div className="session-form-row" key={field.id}>
                <Field
                  id={`session-start-${index}`}
                  label={`${t("start")} ${index + 1}`}
                  error={Boolean(errors.sessions?.[index]?.starts_at)}
                >
                  <input
                    id={`session-start-${index}`}
                    type="datetime-local"
                    {...register(`sessions.${index}.starts_at`)}
                  />
                </Field>
                <Field
                  id={`session-end-${index}`}
                  label={`${t("end")} ${index + 1}`}
                  error={Boolean(errors.sessions?.[index]?.ends_at)}
                >
                  <input
                    id={`session-end-${index}`}
                    type="datetime-local"
                    {...register(`sessions.${index}.ends_at`)}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={fields.length < 2}
                  aria-label={`${t("remove")} ${index + 1}`}
                  onClick={() => remove(index)}
                >
                  <Trash2 size={18} />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              disabled={fields.length >= 60}
              onClick={() => append({ starts_at: "", ends_at: "" })}
            >
              <Plus size={17} />
              {t("newSession")}
            </Button>
          </fieldset>
        </>
      )}
      {!courseRun && (
        <Field
          id="job-capacity"
          label={lifeText("positions")}
          hint={lifeText("perPositionHint")}
          error={Boolean(errors.capacity)}
        >
          <input
            id="job-capacity"
            type="number"
            min="1"
            max="20"
            step="1"
            {...register("capacity", { valueAsNumber: true })}
          />
        </Field>
      )}
      <p className="muted">{lifeText("perPositionHint")}</p>
      <div className="form-row">
        <Field
          id="job-amount"
          label={gross ? priceText("grossRate") : t("amount")}
          error={Boolean(errors.amount)}
        >
          <input
            id="job-amount"
            type="number"
            min="0"
            step="0.01"
            {...register("amount", {
              valueAsNumber: true,
              onChange: (event) => {
                if (getValues("rate_unit") === "fixed_total")
                  setValue("total_amount", Number(event.target.value));
              },
            })}
          />
        </Field>
        <Field id="job-currency" label={t("currency")}>
          <select id="job-currency" {...register("currency")}>
            <option>EUR</option>
            <option>AUD</option>
          </select>
        </Field>
        <Field id="job-unit" label={t("unit")}>
          <select
            id="job-unit"
            {...register("rate_unit", {
              onChange: (event) => {
                if (event.target.value === "fixed_total")
                  setValue("amount", getValues("total_amount"));
              },
            })}
          >
            {["per_day", "per_teaching_unit", "per_hour", "fixed_total"].map(
              (unit) => (
                <option key={unit} value={unit}>
                  {t(unit)}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field
          id="job-total"
          label={gross ? priceText("grossTotal") : t("total")}
          error={Boolean(errors.total_amount)}
        >
          <input
            id="job-total"
            type="number"
            min="0"
            step="0.01"
            {...register("total_amount", {
              valueAsNumber: true,
              onChange: (event) => {
                if (getValues("rate_unit") === "fixed_total")
                  setValue("amount", Number(event.target.value));
              },
            })}
          />
        </Field>
      </div>
      {Number.isFinite(Number(watchedCapacity)) &&
        Number(watchedCapacity) >= 1 &&
        Number.isFinite(Number(watchedTotal)) && (
          <p className="job-life-budget">
            <strong>
              {lifeText(gross ? "maxGrossBudget" : "maxNetBudget")}:{" "}
              {money(
                (Math.round(Number(watchedTotal) * 100) *
                  Number(watchedCapacity)) /
                  100,
                watchedCurrency,
                i18n.language,
              )}
            </strong>
          </p>
        )}
      {gross && (
        <>
          <RoleFeePreview
            gross={Number(watchedTotal)}
            access={pricing.data}
            currency={watchedCurrency}
          />
          <p className="muted commercial-small">
            {priceText("splitHint")} {priceText("feeBasis")}
          </p>
        </>
      )}
      <Field
        id="job-terms"
        label={t("terms")}
        error={Boolean(errors.terms)}
        hint={t("totalHint")}
      >
        <textarea id="job-terms" rows={4} {...register("terms")} />
      </Field>
      {!courseRun && (
        <fieldset>
          <legend>{t("requirements")}</legend>
          <div className="tags">
            {selectableTopics(topics.data ?? [], selectedTopicIds).map(
              (topic) => (
                <label key={topic.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    value={topic.id}
                    {...register("topic_ids")}
                  />
                  {i18n.language === "de" ? topic.label_de : topic.label_en}
                  {topic.archived_at &&
                    ` (${i18n.getFixedT(i18n.language, "taxonomy")("archived")})`}
                </label>
              ),
            )}
          </div>
        </fieldset>
      )}
      <Field
        id="job-claim-deadline"
        label={`${lifeText("deadline")} · ${valuesTimeZone}`}
        hint={lifeText("deadlineZone")}
        error={Boolean(errors.claim_deadline)}
      >
        <input
          id="job-claim-deadline"
          type="datetime-local"
          {...register("claim_deadline")}
        />
      </Field>
      <label className="checkbox-label">
        <input type="checkbox" {...register("requires_contract")} />
        {t("contractRequired")}
      </label>
      <label className="checkbox-label">
        <input type="checkbox" {...register("publish")} />
        {t("publish")}
      </label>
      <Button
        disabled={
          !online ||
          create.isPending ||
          (done && (!isDirty || Boolean(courseRun)))
        }
      >
        {t(create.isPending ? "saving" : "saveJob")}
      </Button>
      {Object.keys(errors).length > 0 && (
        <Notice kind="error">{t("invalidForm")}</Notice>
      )}
      {create.isError && (
        <Notice kind="error">
          {courseRun && create.error.message === "course_run_source_changed"
            ? courseText("sourceChanged")
            : courseRun && create.error.message === "course_run_offer_exists"
              ? courseText("exists")
              : courseRun &&
                  create.error.message === "course_run_customer_required"
                ? courseText("customerRequired")
                : t(invalidTime ? "invalidTime" : "error")}
        </Notice>
      )}
      {done && <Notice>{t("jobSaved")}</Notice>}
      {createdId && (
        <Button asChild variant="secondary">
          <Link to={`/jobs/${createdId}`}>{courseText("openJob")}</Link>
        </Button>
      )}
      {createdId && (
        <Button asChild variant="secondary">
          <Link to={`/jobs/${createdId}#job-briefing`}>
            {briefingText("configureLink")}
          </Link>
        </Button>
      )}
    </form>
  );
}
/** Choose a standalone draft or server-loaded course source from the route and current capabilities. */
export function AdminPage() {
  const { t, i18n } = useTranslation();
  const courseText = useTranslation("courseOffer").t;
  const { session } = useAuth();
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const [params] = useSearchParams();
  const runId = params.get("courseRun") ?? "";
  const course = useQuery({
    ...courseRunJobDefaultsQuery(session!.user.id, runId),
    enabled: Boolean(
      runId &&
      permissions.data?.includes("jobs.manage") &&
      permissions.data.includes("courses.manage"),
    ),
  });
  if (permissions.isPending) return <Loading />;
  if (permissions.isError)
    return <ErrorState retry={() => void permissions.refetch()} />;
  if (!permissions.data.includes("jobs.manage"))
    return (
      <>
        <PageHeading title={t("admin")} />
        <Notice kind="error">{t("noAccess")}</Notice>
      </>
    );
  const de = i18n.language.startsWith("de");
  const creating = Boolean(runId || params.get("create") === "job");
  return (
    <>
      <PageHeading
        title={
          de ? "Kurse & Aufträge verwalten" : "Manage courses & assignments"
        }
        description={
          de
            ? "Kursdurchführungen planen, Kunden zuordnen und vollständige Lehrblöcke vergeben."
            : "Plan course runs, link customers and allocate complete teaching blocks."
        }
      />
      {creating ? (
        <>
          <Button asChild variant="ghost">
            <Link to="/admin">
              {de
                ? "Zur Verwaltungsübersicht"
                : "Back to administration overview"}
            </Link>
          </Button>
          {runId ? (
            !permissions.data.includes("courses.manage") ? (
              <Notice kind="error">{t("noAccess")}</Notice>
            ) : course.isPending ? (
              <Loading />
            ) : course.isError ? (
              <ErrorState retry={() => void course.refetch()} />
            ) : !course.data.organisation_id ? (
              <Notice kind="error">{courseText("customerRequired")}</Notice>
            ) : (
              <JobForm key={runId} courseRun={course.data} />
            )
          ) : (
            <JobForm key="standalone" />
          )}
        </>
      ) : params.get("view") === "jobs" ? (
        <>
          <div className="form-actions">
            <Button asChild variant="ghost">
              <Link to="/admin">
                {de
                  ? "Zur Verwaltungsübersicht"
                  : "Back to administration overview"}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/admin?create=job">
                {de ? "Auftrag anlegen" : "Create assignment"}
              </Link>
            </Button>
          </div>
          <OfferBoard />
        </>
      ) : (
        <div className="operations-grid">
          <section className="panel">
            <h2>{de ? "Kursdurchführungen" : "Course runs"}</h2>
            <p>
              {de
                ? "Kursinhalt, Unternehmen und Termine gemeinsam planen. Aus einer Durchführung wird ein Auftrag mit den gleichen Terminen."
                : "Plan course content, company and dates together. Create an assignment using the same course dates."}
            </p>
            <Button asChild>
              <Link to="/courses">{de ? "Kurse öffnen" : "Open courses"}</Link>
            </Button>
          </section>
          <section className="panel">
            <h2>
              {de
                ? "Aufträge & Dozentenzuweisung"
                : "Assignments & lecturer allocation"}
            </h2>
            <p>
              {de
                ? "Bestehende Aufträge öffnen, veröffentlichen und Dozent:innen für den gesamten Unterrichtsblock zuweisen."
                : "Open and publish assignments and allocate lecturers for complete teaching blocks."}
            </p>
            <div className="form-actions">
              <Button asChild>
                <Link to="/admin?view=jobs">
                  {de ? "Aufträge verwalten" : "Manage assignments"}
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/admin?create=job">
                  {de
                    ? "Eigenständigen Auftrag anlegen"
                    : "Create standalone assignment"}
                </Link>
              </Button>
            </div>
          </section>
          {permissions.data.includes("users.manage") && (
            <section className="panel">
              <h2>{de ? "Dozent:innen & Konten" : "Lecturers & accounts"}</h2>
              <p>
                {de
                  ? "Personen einladen und Profile, Rollen sowie individuelle Honorare an der Person verwalten."
                  : "Invite people and manage profiles, roles and individual compensation on their records."}
              </p>
              <Button asChild variant="secondary">
                <Link to="/admin/accounts">
                  {de ? "Konten verwalten" : "Manage accounts"}
                </Link>
              </Button>
            </section>
          )}
          {permissions.data.includes("organisations.manage") && (
            <section className="panel">
              <h2>
                {de
                  ? "Kunden & Unternehmenszugänge"
                  : "Customers & company access"}
              </h2>
              <p>
                {de
                  ? "Unternehmen anlegen, dem Kurs zuordnen und freigegebene Kundenkonten mit dem Unternehmen verknüpfen. Die Unternehmenszuordnung bestimmt den Kundenzugriff."
                  : "Create companies, link them to courses and grant customer accounts access to their company. Company membership determines customer access."}
              </p>
              <Button asChild variant="secondary">
                <Link to="/clients">
                  {de ? "Kunden verwalten" : "Manage customers"}
                </Link>
              </Button>
            </section>
          )}
        </div>
      )}
    </>
  );
}
