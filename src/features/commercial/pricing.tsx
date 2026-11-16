import { useState } from "react";
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
  commissionAccessQuery,
  commissionKeys,
  commissionReportQuery,
  offerPolicyQuery,
  splitFee,
  type ClientRequest,
  type CommissionRecord,
  type CommissionAccess,
} from "./commission-api";
import "./platform-i18n";
import "./platform.css";
export function RoleFeePreview({
  gross,
  currency,
  access,
}: {
  gross: number;
  currency: string;
  access: CommissionAccess | undefined;
}) {
  const { t } = useTranslation("platform");
  if (
    !access?.can_manage_gross ||
    !Number.isFinite(gross) ||
    gross < 0 ||
    !Number.isFinite(access.regular_lecturer_percent) ||
    !Number.isFinite(access.senior_lecturer_percent)
  )
    return null;
  return (
    <div>
      {(
        [
          ["regularLecturer", access.regular_lecturer_percent!],
          ["seniorLecturer", access.senior_lecturer_percent!],
        ] as const
      ).map(([label, share]) => (
        <section key={label}>
          <h3>
            {t(label)} · {share}%
          </h3>
          <FeeSplitPreview
            gross={gross}
            percent={100 - share}
            lecturerAmount={splitFee(gross, share).platform}
            currency={currency}
          />
        </section>
      ))}
    </div>
  );
}
export function FeeSplitPreview({
  gross,
  percent,
  currency,
  lecturerAmount,
}: {
  gross: number;
  percent: number;
  currency: string;
  lecturerAmount?: number;
}) {
  const { t, i18n } = useTranslation("platform");
  if (
    !Number.isFinite(gross) ||
    !Number.isFinite(percent) ||
    gross < 0 ||
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
        <span>{t("grossTotal")}</span>
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
function EditPrice({
  actor,
  job,
  record,
  access,
  onDone,
}: {
  actor: string;
  job: Job;
  record: CommissionRecord | undefined;
  access: CommissionAccess;
  onDone: () => void;
}) {
  const { t } = useTranslation("platform");
  const online = useOnline();
  const client = useQueryClient();
  const [amount, setAmount] = useState(String(record?.gross_amount ?? ""));
  const [total, setTotal] = useState(String(record?.gross_total_amount ?? ""));
  const percent =
    access.regular_lecturer_percent == null
      ? NaN
      : 100 - access.regular_lecturer_percent;
  const valid =
    access.policy_configured &&
    Number.isFinite(Number(amount)) &&
    Number.isFinite(Number(total)) &&
    Number.isFinite(Number(percent)) &&
    Number(amount) > 0 &&
    Number(total) > 0 &&
    Number(percent) >= 0 &&
    Number(percent) <= 100;
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!valid) throw new Error("invalid_price");
      const { error } = await db().rpc("set_job_commission", {
        p_job_id: job.id,
        p_gross_amount: Number(amount),
        p_gross_total_amount: Number(total),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["jobs"] }),
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
            min="0"
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
      <RoleFeePreview
        gross={Number(total)}
        access={access}
        currency={job.currency}
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
export function JobPricingPanel({ job }: { job: Job }) {
  const { t } = useTranslation("platform");
  const { session } = useAuth();
  const actor = session!.user.id;
  const access = useQuery(commissionAccessQuery(actor));
  const report = useQuery({
    ...commissionReportQuery(actor),
    enabled: Boolean(access.data?.can_manage_gross),
  });
  const policy = useQuery({
    ...offerPolicyQuery(actor, job.id),
    enabled: Boolean(access.data?.can_manage_gross),
  });
  const lifecycle = useQuery({
    ...lifecycleQuery(actor, job.id),
    enabled: Boolean(access.data?.can_manage_gross),
  });
  const [editing, setEditing] = useState(false);
  if (!access.data?.can_manage_gross) return null;
  if (report.isPending || policy.isPending) return <Loading />;
  if (report.isError || policy.isError)
    return (
      <ErrorState
        retry={() => {
          void report.refetch();
          void policy.refetch();
        }}
      />
    );
  const record = report.data.find((row) => row.job_id === job.id);
  const locked =
    lifecycle.isPending ||
    lifecycle.isError ||
    !lifecycle.data?.can_edit ||
    job.status === "filled" ||
    report.data.some((row) => row.job_id === job.id && Boolean(row.claim_id));
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
            access={{ ...access.data, ...policy.data }}
          />
        )
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
            record={record}
            access={access.data}
            onDone={() => setEditing(false)}
          />
        )}
      </Dialog>
    </section>
  );
}
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
  const percent =
    access.data?.regular_lecturer_percent == null
      ? NaN
      : 100 - access.data.regular_lecturer_percent;
  const [terms, setTerms] = useState("");
  const [contract, setContract] = useState(true);
  const publish = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { data, error } = await db().rpc("publish_client_request", {
        p_request_id: request.id,
        p_terms: terms.trim(),
        p_requires_contract: contract,
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
      <RoleFeePreview
        gross={Number(request.gross_total_amount)}
        access={access.data}
        currency={request.currency}
      />
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
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={contract}
          onChange={(event) => setContract(event.target.checked)}
          disabled={publish.isPending}
        />
        {common("contractRequired")}
      </label>
      <div className="form-actions">
        <Button
          disabled={
            !online ||
            publish.isPending ||
            !terms.trim() ||
            !access.data?.can_manage_gross ||
            !access.data.policy_configured ||
            !Number.isFinite(percent) ||
            Number(percent) < 0 ||
            Number(percent) > 100
          }
        >
          {t("publishRequest")}
        </Button>
      </div>
      {publish.isError && <Notice kind="error">{t("priceFailed")}</Notice>}
    </form>
  );
}
