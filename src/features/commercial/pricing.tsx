/**
 * Gross-price/share editor, local compensation preview and client-request publication. The
 * preview explains cent rounding; PostgreSQL owns binding prices, version checks and accepted
 * snapshots.
 */
import { lazy, Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import type { Job } from "../../lib/types";
import { db } from "../../lib/supabase";
import { lifecycleQuery } from "../jobs/lifecycle-api";
import { money } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import {
  type ClientRequest,
  type CommissionAccess,
  commissionAccessQuery,
  commissionKeys,
  type CommissionRecord,
  commissionReportQuery,
  offerPolicyQuery,
  parseCourseCommission,
  splitFee,
} from "./commission-api";
import "./platform-i18n";
import "./platform.css";

const TrainingCompensationPanel = lazy(() =>
  import("./training-commercial").then((module) => ({
    default: module.TrainingCompensationPanel,
  })),
);

const maximumGross = 9_999_999_999.99;

/** An indicative default only; selecting a lecturer resolves their current server quote. */
export function RoleFeePreview({
  gross,
  grossRate,
  currency,
  access,
  platformPercent,
}: {
  gross: number;
  grossRate?: number;
  currency: string;
  access: CommissionAccess | undefined;
  platformPercent?: number | null;
}) {
  const { t, i18n } = useTranslation("platform");
  const de = i18n.language.startsWith("de"),
    regularPercent = access?.regular_lecturer_percent ?? 50,
    seniorPercent = access?.senior_lecturer_percent ?? 50;
  if (!Number.isFinite(gross) || gross < 0) return null;
  if (
    !access?.can_manage_gross &&
    !(access?.can_manage_own_course_pricing && platformPercent != null)
  )
    return null;
  if (platformPercent != null) {
    if (!Number.isFinite(platformPercent)) return null;
    const lecturerPercent = 100 - platformPercent;
    return (
      <section>
        <h3>{t("courseCommissionPreview")}</h3>
        {grossRate !== undefined && grossRate !== gross && (
          <FeeSplitPreview
            gross={grossRate}
            grossLabel={t("grossRate")}
            percent={lecturerPercent}
            currency={currency}
          />
        )}
        <FeeSplitPreview
          gross={gross}
          percent={lecturerPercent}
          currency={currency}
        />
      </section>
    );
  }
  return (
    <section>
      <h3>
        {de ? "Dozent:in – Standardanteil" : "Lecturer — default share"} (
        {regularPercent.toLocaleString(i18n.language, {
          maximumFractionDigits: 2,
        })}
        %)
      </h3>
      <FeeSplitPreview
        gross={gross}
        percent={regularPercent}
        currency={currency}
      />
      <h3>
        {de
          ? "Senior-Dozent:in – Standardanteil"
          : "Senior lecturer — default share"}{" "}
        (
        {seniorPercent.toLocaleString(i18n.language, {
          maximumFractionDigits: 2,
        })}
        %)
      </h3>
      <FeeSplitPreview
        gross={gross}
        percent={seniorPercent}
        currency={currency}
      />
      <p className="muted">
        {de
          ? "Die Standardanteile werden beim Veröffentlichen im Angebot gespeichert. Individuelle Prozentsätze oder Tagessätze werden im Dozentenprofil gepflegt; angenommene Honorare bleiben unverändert."
          : "Default shares are captured when an offer is published. Individual percentages or daily rates are maintained on the lecturer profile; accepted compensation remains unchanged."}
      </p>
    </section>
  );
}

/** Explain local cent allocation without presenting it as a binding server snapshot. */
function FeeSplitPreview({
  gross,
  percent,
  currency,
  lecturerAmount,
  grossLabel,
}: {
  gross: number;
  percent: number;
  currency: string;
  lecturerAmount?: number;
  grossLabel?: string;
}) {
  const { t, i18n } = useTranslation("platform");
  if (
    !Number.isFinite(gross) ||
    !Number.isFinite(percent) ||
    gross < 0 ||
    gross > maximumGross ||
    percent < 0 ||
    percent > 100
  )
    return null;
  const split =
    lecturerAmount === undefined
      ? splitFee(gross, percent)
      : {
          gross,
          lecturer: lecturerAmount,
          platform: Math.round((gross - lecturerAmount) * 100) / 100,
        };
  return (
    <div className="platform-split" role="group" aria-label={t("pricePreview")}>
      <div>
        <span>{grossLabel ?? t("grossTotal")}</span>
        <strong>{money(split.gross, currency, i18n.language)}</strong>
      </div>
      <div>
        <span>{t("lecturerShare")}</span>
        <strong>{money(split.lecturer, currency, i18n.language)}</strong>
      </div>
      <div>
        <span>{t("platformShare")}</span>
        <strong>{money(split.platform, currency, i18n.language)}</strong>
      </div>
    </div>
  );
}

export function CourseCommissionField({
  id,
  value,
  onChange,
  disabled,
  required,
  netWhenBlank,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  netWhenBlank?: boolean;
}) {
  const { t } = useTranslation("platform");
  return (
    <Field
      id={id}
      label={t("courseCommission")}
      hint={t(
        required
          ? "courseCommissionRequired"
          : netWhenBlank
            ? "courseCommissionNetHint"
            : "courseCommissionHint",
      )}
      error={Number.isNaN(parseCourseCommission(value))}
    >
      <input
        id={id}
        type="number"
        min="0"
        max="100"
        step="0.01"
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </Field>
  );
}

/** Edit only price/share fields permitted by current capabilities and offer state. */
function EditPrice({
  actor,
  job,
  record,
  access,
  platformPercentOverride,
  onDone,
}: {
  actor: string;
  job: Job;
  record:
    Pick<CommissionRecord, "gross_amount" | "gross_total_amount"> | undefined;
  access: CommissionAccess;
  platformPercentOverride?: number | null;
  onDone: () => void;
}) {
  const { t } = useTranslation("platform");
  const online = useOnline();
  const client = useQueryClient();
  const [amount, setAmount] = useState(String(record?.gross_amount ?? ""));
  const [total, setTotal] = useState(String(record?.gross_total_amount ?? ""));
  const [commission, setCommission] = useState(
    String(platformPercentOverride ?? ""),
  );
  const percent = parseCourseCommission(commission);
  const valid =
    Number(amount) > 0 &&
    Number(amount) <= maximumGross &&
    Number(total) > 0 &&
    Number(total) <= maximumGross &&
    !Number.isNaN(percent) &&
    (access.can_manage_gross || percent !== null);
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!valid) throw new Error("invalid_price");
      const { error } = await db().rpc("set_job_commission", {
        p_job_id: job.id,
        p_gross_amount: Number(amount),
        p_gross_total_amount: Number(total),
        p_platform_percent: percent,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["jobs"] }),
        client.invalidateQueries({ queryKey: ["job-board"] }),
        client.invalidateQueries({
          queryKey: ["job-lifecycle", actor, job.id],
        }),
        client.invalidateQueries({
          queryKey: ["commission-offer-policy", actor, job.id],
        }),
        client.invalidateQueries({ queryKey: commissionKeys.report(actor) }),
        client.invalidateQueries({ queryKey: commissionKeys.requests(actor) }),
      ]);
      onDone();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="form-row">
        <Field id="edit-gross-rate" label={t("grossRate")}>
          <input
            id="edit-gross-rate"
            type="number"
            required
            min="0.01"
            max={maximumGross}
            step="0.01"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              if (job.rate_unit === "fixed_total") setTotal(event.target.value);
            }}
            disabled={save.isPending}
          />
        </Field>
        <Field id="edit-gross-total" label={t("grossTotal")}>
          <input
            id="edit-gross-total"
            type="number"
            required
            min="0.01"
            max={maximumGross}
            step="0.01"
            value={total}
            onChange={(event) => {
              setTotal(event.target.value);
              if (job.rate_unit === "fixed_total")
                setAmount(event.target.value);
            }}
            disabled={save.isPending}
          />
        </Field>
      </div>
      <CourseCommissionField
        id="edit-course-commission"
        value={commission}
        onChange={setCommission}
        required={!access.can_manage_gross}
        disabled={save.isPending}
      />
      <RoleFeePreview
        gross={Number(total)}
        grossRate={Number(amount)}
        access={access}
        currency={job.currency}
        platformPercent={percent}
      />
      <p className="muted commercial-small">
        {t("splitHint")} {t("feeBasis")}
      </p>
      <Button disabled={!online || !valid || save.isPending}>
        {t("savePrice")}
      </Button>
      {save.isError && <Notice kind="error">{t("priceFailed")}</Notice>}
    </form>
  );
}

/** Load the authorized price projection and offer the dialog only for editable offers. */
export function JobPricingPanel({ job }: { job: Job }) {
  const { t } = useTranslation("platform");
  const { session } = useAuth();
  const actor = session!.user.id;
  const access = useQuery(commissionAccessQuery(actor));
  const fullFinance = Boolean(access.data?.can_manage_gross);
  const scopedPricing = Boolean(access.data?.can_manage_own_course_pricing);
  const canPrice = fullFinance || scopedPricing;
  const report = useQuery({
    ...commissionReportQuery(actor),
    enabled: fullFinance,
  });
  const policy = useQuery({
    ...offerPolicyQuery(actor, job.id),
    enabled: canPrice,
    retry: (count, error) =>
      count < 1 && (!("code" in error) || error.code !== "42501"),
  });
  const lifecycle = useQuery({
    ...lifecycleQuery(actor, job.id),
    enabled: canPrice,
  });
  const [editing, setEditing] = useState(false);
  if (!access.data || !canPrice) return null;
  if ((fullFinance && report.isPending) || policy.isPending) return <Loading />;
  if (
    !fullFinance &&
    policy.error &&
    "code" in policy.error &&
    policy.error.code === "42501"
  )
    return null;
  if ((fullFinance && report.isError) || policy.isError)
    return (
      <ErrorState
        retry={() => {
          if (fullFinance) void report.refetch();
          void policy.refetch();
        }}
      />
    );
  const record = fullFinance
    ? report.data?.find((row) => row.job_id === job.id)
    : undefined;
  const scopePolicy =
    policy.data?.gross_amount != null && policy.data.gross_total_amount != null
      ? {
          gross_amount: policy.data.gross_amount,
          gross_total_amount: policy.data.gross_total_amount,
        }
      : undefined;
  const locked =
    lifecycle.isPending ||
    lifecycle.isError ||
    !lifecycle.data?.can_edit ||
    (job.status !== "draft" && job.status !== "published") ||
    Boolean(
      report.data?.some(
        (row) => row.job_id === job.id && Boolean(row.claim_id),
      ),
    );
  return (
    <section className="panel platform-pricing">
      <h2>{t("pricingTitle")}</h2>
      {record?.pricing_model === "commission" &&
      record.gross_total_amount !== null ? (
        record.claim_id || !policy.data ? (
          <FeeSplitPreview
            gross={Number(record.gross_total_amount)}
            percent={Number(record.platform_percent)}
            currency={record.currency}
            lecturerAmount={Number(record.lecturer_net_total_amount)}
          />
        ) : (
          <RoleFeePreview
            gross={Number(record.gross_total_amount)}
            currency={record.currency}
            grossRate={Number(record.gross_amount)}
            platformPercent={policy.data.platform_percent_override}
            access={{ ...access.data, ...policy.data }}
          />
        )
      ) : scopePolicy ? (
        <RoleFeePreview
          gross={scopePolicy.gross_total_amount}
          grossRate={scopePolicy.gross_amount}
          currency={job.currency}
          platformPercent={policy.data?.platform_percent_override}
          access={access.data}
        />
      ) : (
        <p className="muted">{t("legacyPricing")}</p>
      )}
      {locked ? (
        <p className="muted commercial-small">{t("acceptedImmutable")}</p>
      ) : (
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {t("configurePrice")}
        </Button>
      )}
      {fullFinance && (
        <Suspense fallback={null}>
          <TrainingCompensationPanel
            actor={actor}
            jobId={job.id}
            zone={job.time_zone}
          />
        </Suspense>
      )}
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title={t("pricingTitle")}
        description={t("splitHint")}
      >
        {editing && (
          <EditPrice
            actor={actor}
            job={job}
            record={record ?? scopePolicy}
            access={access.data}
            platformPercentOverride={policy.data?.platform_percent_override}
            onDone={() => setEditing(false)}
          />
        )}
      </Dialog>
    </section>
  );
}

/** Publish a reviewed client request as a real offer through the publication RPC. */
export function PublishClientRequest({
  actor,
  request,
  onDone,
}: {
  actor: string;
  request: ClientRequest;
  onDone: () => void;
}) {
  const { t } = useTranslation("platform");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const access = useQuery(commissionAccessQuery(actor));
  const [commission, setCommission] = useState("");
  const internal = request.gross_total_amount === null;
  const percent = internal ? null : parseCourseCommission(commission);
  const [terms, setTerms] = useState("");
  const [contract, setContract] = useState(true);
  const publish = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (Number.isNaN(percent)) throw new Error("invalid_price");
      const { data, error } = await db().rpc("publish_client_request", {
        p_request_id: request.id,
        p_platform_percent: percent,
        p_terms: terms.trim(),
        p_requires_contract: !internal && contract,
        p_claim_deadline: null,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: commissionKeys.requests(actor) }),
        client.invalidateQueries({ queryKey: commissionKeys.report(actor) }),
        client.invalidateQueries({ queryKey: commissionKeys.spend(actor) }),
        client.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
      onDone();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        publish.mutate();
      }}
    >
      {!internal && access.data?.can_manage_gross && (
        <CourseCommissionField
          id="publish-course-commission"
          value={commission}
          onChange={setCommission}
          disabled={publish.isPending}
        />
      )}
      {!internal && (
        <RoleFeePreview
          gross={Number(request.gross_total_amount)}
          grossRate={Number(request.gross_amount)}
          access={access.data}
          currency={request.currency}
          platformPercent={percent}
        />
      )}
      <Field id="publish-client-terms" label={common("terms")}>
        <textarea
          id="publish-client-terms"
          required
          maxLength={10000}
          value={terms}
          onChange={(event) => setTerms(event.target.value)}
          disabled={publish.isPending}
        />
      </Field>
      {!internal && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={contract}
            onChange={(event) => setContract(event.target.checked)}
            disabled={publish.isPending}
          />
          {common("contractRequired")}
        </label>
      )}
      <div className="form-actions">
        <Button
          disabled={
            !online ||
            publish.isPending ||
            !terms.trim() ||
            !access.data?.can_manage_gross ||
            Number.isNaN(percent)
          }
        >
          {t("publishRequest")}
        </Button>
      </div>
      {publish.isError && <Notice kind="error">{t("priceFailed")}</Notice>}
    </form>
  );
}
