import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { InviteForm } from "./invite";
import { useAuth } from "../auth/auth-context";
import { jobsQuery, permissionsQuery, topicsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { validZone, zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
const schema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  customer_name: z.string().trim().min(1).max(200),
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
  topic_ids: z.array(z.string()),
  sessions: z
    .array(
      z.object({ starts_at: z.string().min(1), ends_at: z.string().min(1) }),
    )
    .min(1)
    .max(60),
});
type Values = z.infer<typeof schema>;
function JobForm() {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const topics = useQuery(topicsQuery);
  const client = useQueryClient();
  const [invalidTime, setInvalidTime] = useState(false);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      customer_name: "",
      delivery_type: "online",
      location: "",
      time_zone: "Europe/Berlin",
      amount: 400,
      total_amount: 2000,
      currency: "EUR",
      rate_unit: "per_day",
      terms: "",
      publish: false,
      requires_contract: false,
      topic_ids: [],
      sessions: Array.from({ length: 5 }, (_, i) => {
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
  const { fields, append, remove } = useFieldArray({
    control,
    name: "sessions",
  });
  const create = useMutation({
    mutationFn: async (values: Values) => {
      requireOnline();
      setDone(false);
      setInvalidTime(false);
      const sessions = values.sessions.map((s) => {
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
      const { publish, ...rest } = values;
      const { error } = await db().rpc("create_job", {
        p_payload: {
          ...rest,
          sessions,
          status: publish ? "published" : "draft",
        },
      });
      if (error) throw error;
    },
    onSuccess: async (_data, values) => {
      await client.invalidateQueries({ queryKey: ["jobs"] });
      reset(values);
      setDone(true);
    },
  });
  if (topics.isPending) return <Loading />;
  if (topics.isError) return <ErrorState retry={() => void topics.refetch()} />;
  return (
    <form
      className="panel admin-form"
      noValidate
      onSubmit={handleSubmit((values) => create.mutate(values))}
    >
      <h2>{t("createJob")}</h2>
      <div className="form-row">
        <Field id="job-title" label={t("title")} error={Boolean(errors.title)}>
          <input id="job-title" {...register("title")} />
        </Field>
        <Field
          id="job-customer"
          label={t("customer")}
          error={Boolean(errors.customer_name)}
        >
          <input id="job-customer" {...register("customer_name")} />
        </Field>
      </div>
      <Field
        id="job-description"
        label={t("description")}
        error={Boolean(errors.description)}
      >
        <textarea id="job-description" rows={4} {...register("description")} />
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
      <div className="form-row">
        <Field
          id="job-amount"
          label={t("amount")}
          error={Boolean(errors.amount)}
        >
          <input
            id="job-amount"
            type="number"
            min="0"
            step="0.01"
            {...register("amount", { valueAsNumber: true })}
          />
        </Field>
        <Field id="job-currency" label={t("currency")}>
          <select id="job-currency" {...register("currency")}>
            <option>EUR</option>
            <option>AUD</option>
          </select>
        </Field>
        <Field id="job-unit" label={t("unit")}>
          <select id="job-unit" {...register("rate_unit")}>
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
          label={t("total")}
          error={Boolean(errors.total_amount)}
        >
          <input
            id="job-total"
            type="number"
            min="0"
            step="0.01"
            {...register("total_amount", { valueAsNumber: true })}
          />
        </Field>
      </div>
      <Field
        id="job-terms"
        label={t("terms")}
        error={Boolean(errors.terms)}
        hint={t("totalHint")}
      >
        <textarea id="job-terms" rows={4} {...register("terms")} />
      </Field>
      <fieldset>
        <legend>{t("requirements")}</legend>
        <div className="tags">
          {topics.data?.map((topic) => (
            <label key={topic.id} className="checkbox-label">
              <input
                type="checkbox"
                value={topic.id}
                {...register("topic_ids")}
              />
              {i18n.language === "de" ? topic.label_de : topic.label_en}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="checkbox-label">
        <input type="checkbox" {...register("requires_contract")} />
        {t("contractRequired")}
      </label>
      <label className="checkbox-label">
        <input type="checkbox" {...register("publish")} />
        {t("publish")}
      </label>
      <Button disabled={!online || create.isPending || (done && !isDirty)}>
        {t(create.isPending ? "saving" : "saveJob")}
      </Button>
      {Object.keys(errors).length > 0 && (
        <Notice kind="error">{t("invalidForm")}</Notice>
      )}
      {create.isError && (
        <Notice kind="error">{t(invalidTime ? "invalidTime" : "error")}</Notice>
      )}
      {done && <Notice>{t("jobSaved")}</Notice>}
    </form>
  );
}
export function AdminPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const jobs = useQuery(jobsQuery);
  const client = useQueryClient();
  const online = useOnline();
  const status = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      requireOnline();
      const { error } = await db().rpc("set_job_status", {
        p_job_id: id,
        p_status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["jobs"] }),
  });
  if (permissions.isPending) return <Loading />;
  if (permissions.isError)
    return <ErrorState retry={() => void permissions.refetch()} />;
  if (!permissions.data.includes("jobs.manage"))
    return (
      <>
        <PageHeading title={t("admin")} />
        <Notice kind="error">{t("noAccess")}</Notice>
        <Button asChild>
          <Link to="/security">{t("security")}</Link>
        </Button>
      </>
    );
  return (
    <>
      <PageHeading title={t("admin")} description={t("adminIntro")} />
      <JobForm />
      {(permissions.data.includes("users.manage") ||
        permissions.data.includes("users.invite")) && <InviteForm />}
      <section className="panel admin-job-list">
        <h2>{t("jobs")}</h2>
        {jobs.data?.map((job) => (
          <div className="admin-job-row" key={job.id}>
            <Link to={`/jobs/${job.id}`}>{job.title}</Link>
            {job.status === "filled" ? (
              <span className="badge">{t("filled")}</span>
            ) : (
              <select
                aria-label={`${t("status")}: ${job.title}`}
                value={job.status}
                disabled={!online || status.isPending}
                onChange={(e) =>
                  status.mutate({ id: job.id, status: e.target.value })
                }
              >
                {["draft", "published", "archived"].map((s) => (
                  <option key={s} value={s}>
                    {t(s)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
        {status.isError && <Notice kind="error">{t("error")}</Notice>}
      </section>
    </>
  );
}
