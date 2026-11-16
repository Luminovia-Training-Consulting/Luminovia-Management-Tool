/**
 * Gross-price/share editor, local compensation preview and client-request publication. The
 * preview explains cent rounding; PostgreSQL owns binding prices, version checks and accepted
 * snapshots.
 */
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
  splitFee,
  type ClientRequest,
  type CommissionRecord,
} from "./commission-api";
import "./platform-i18n";
import "./platform.css";
/** Explain local cent allocation without presenting it as a binding server snapshot. */
export function FeeSplitPreview({
  gross,
  percent,
  currency,
}: {
  gross: number;
  percent: number;
  currency: string;
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
  const split = splitFee(gross, percent);
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
/** Edit only price/share fields permitted by current capabilities and offer state. */
function EditPrice({
  actor,
  job,
  record,
  onDone,
}: {
  actor: string;
  job: Job;
  record: CommissionRecord | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation("platform");
  const online = useOnline();
  const client = useQueryClient();
  const [amount, setAmount] = useState(
    String(record?.gross_amount ?? Number(job.amount) * 2),
  );
  const [total, setTotal] = useState(
    String(record?.gross_total_amount ?? Number(job.total_amount) * 2),
  );
  const [percent, setPercent] = useState(
    String(record?.platform_percent ?? 50),
  );
  const valid =
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
        p_platform_percent: Number(percent),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["jobs"] }),
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
        <Field id="edit-platform-percent" label={t("platformPercent")}>
          <input
            id="edit-platform-percent"
            type="number"
            required
            min="0"
            max="100"
            step="0.01"
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
            disabled={save.isPending}
          />
        </Field>
      </div>
      <FeeSplitPreview
        gross={Number(total)}
        percent={Number(percent)}
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
/** Load the authorized price projection and offer the dialog only for editable offers. */
export function JobPricingPanel({ job }: { job: Job }) {
  const { t } = useTranslation("platform");
  const { session } = useAuth();
  const actor = session!.user.id;
  const access = useQuery(commissionAccessQuery(actor));
  const report = useQuery({
    ...commissionReportQuery(actor),
    enabled: Boolean(access.data?.can_manage_gross),
  });
  const lifecycle = useQuery({
    ...lifecycleQuery(actor, job.id),
    enabled: Boolean(access.data?.can_manage_gross),
  });
  const [editing, setEditing] = useState(false);
  if (!access.data?.can_manage_gross) return null;
  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorState retry={() => void report.refetch()} />;
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
        <FeeSplitPreview
          gross={Number(record.gross_total_amount)}
          percent={Number(record.platform_percent)}
          currency={record.currency}
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
  const [percent, setPercent] = useState("50");
  const [terms, setTerms] = useState("");
  const [contract, setContract] = useState(true);
  const publish = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { data, error } = await db().rpc("publish_client_request", {
        p_request_id: request.id,
        p_platform_percent: Number(percent),
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
      <Field id="publish-platform-percent" label={t("platformPercent")}>
        <input
          id="publish-platform-percent"
          type="number"
          min="0"
          max="100"
          step="0.01"
          required
          value={percent}
          onChange={(event) => setPercent(event.target.value)}
          disabled={publish.isPending}
        />
      </Field>
      <FeeSplitPreview
        gross={Number(request.gross_total_amount)}
        percent={Number(percent)}
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
            !percent ||
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
