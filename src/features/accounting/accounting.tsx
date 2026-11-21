/** Accounting UI: scoped invoice selection, scanned external evidence and
 * server-confirmed exports; business mutations require an online response. */
import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { Download, FileCheck2, Plus } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import {
  uploadDocument,
  saveDownload,
  type PortalDocument,
} from "../files/api";
import { requireOnline, useOnline } from "../../lib/online";
import { zonedInstant } from "../../lib/dates";
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
  accountingAccessQuery,
  accountingAmount,
  accountingCents,
  accountingInvoicesQuery,
  accountingKeys,
  accountingWrite,
  createAccountingExport,
  customerClaimsQuery,
  downloadAccounting,
  type AccountingExport,
  type AccountingInvoice,
  type AccountingSource,
} from "./api";
import "./i18n";
import "./accounting.css";

/** Record an issued PDF and its supplied values without repricing agreements. */
function CustomerInvoiceForm({
  actor,
  onDone,
  onDenied,
}: {
  actor: string;
  onDone: () => void;
  onDenied: () => void;
}) {
  const { t } = useTranslation("accounting");
  const online = useOnline();
  const client = useQueryClient();
  const claims = useQuery(customerClaimsQuery(actor, true));
  const [selected, setSelected] = useState<string[]>([]);
  const [document, setDocument] = useState<PortalDocument | null>(null);
  const [form, setForm] = useState({
    number: "",
    issued: "",
    due: "",
    total: "",
    difference: "",
  });
  const [reviewed, setReviewed] = useState<string | null>(null);
  const key = useRef<{ signature: string; key: string } | null>(null),
    uploadKey = useRef<{ signature: string; key: string } | null>(null);
  const chosen =
    claims.data?.filter((c) => selected.includes(c.claim_id)) ?? [];
  const first = chosen[0];
  const accepted = chosen.reduce(
    (sum, c) => sum + accountingCents(c.accepted_charge),
    0n,
  );
  // The declaration applies only to these displayed invoice values, selected
  // immutable charge references and this exact clean PDF version. It excludes
  // locale/session tokens, preserving unchanged drafts through their refresh.
  const review =
    document?.status === "clean" &&
    selected.length > 0 &&
    chosen.length === selected.length
      ? JSON.stringify({
          number: form.number.trim(),
          issued_on: form.issued,
          due_on: form.due,
          total_amount: form.total,
          difference_reason: form.difference.trim(),
          document_id: document.id,
          document_version_id: document.current_version_id,
          claims: chosen
            .map((c) => ({
              claim_id: c.claim_id,
              job_id: c.job_id,
              organisation_id: c.organisation_id,
              currency: c.currency,
              accepted_charge: c.accepted_charge,
            }))
            .sort((a, b) => a.claim_id.localeCompare(b.claim_id)),
        })
      : null;
  const checked = review !== null && reviewed === review;
  const upload = useMutation({
    mutationFn: async (file: File) => {
      requireOnline();
      setReviewed(null);
      setDocument(null);
      if (
        file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")
      )
        throw new Error("invalid_pdf");
      const signature = JSON.stringify([
        file.name,
        file.size,
        file.lastModified,
      ]);
      if (uploadKey.current?.signature !== signature)
        uploadKey.current = { signature, key: crypto.randomUUID() };
      return uploadDocument(file, {
        scope: "personal",
        kind: "material",
        ownerId: actor,
        clientId: uploadKey.current.key,
      });
    },
    onSuccess: setDocument,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (
        !document ||
        !checked ||
        !chosen.length ||
        chosen.length !== selected.length ||
        selected.length > 50 ||
        !first ||
        document.status !== "clean" ||
        !DateTime.fromISO(form.issued).isValid ||
        !DateTime.fromISO(form.due).isValid ||
        form.due < form.issued ||
        accountingCents(form.total) <= 0n ||
        (accountingCents(form.total) !== accepted &&
          form.difference.trim().length < 5)
      )
        throw new Error("accounting_invalid");
      const payload = {
        claim_ids: selected,
        number: form.number.trim(),
        issued_on: form.issued,
        due_on: form.due,
        currency: first.currency,
        total_amount: form.total,
        document_version_id: document.current_version_id,
        difference_reason: form.difference.trim(),
      };
      const signature = JSON.stringify(payload);
      if (key.current?.signature !== signature)
        key.current = { signature, key: crypto.randomUUID() };
      return accountingWrite("register_customer_invoice", {
        p_payload: payload,
        p_request_id: key.current.key,
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: accountingKeys.all(actor) });
      onDone();
    },
    onError: (error) => {
      if (permissionDenied(error)) onDenied();
    },
  });
  const busy = save.isPending || upload.isPending || !online;
  // Reverting an edit still needs a fresh explicit review. The request-key
  // ledger remains untouched so identical response-loss retries stay stable.
  const set = (name: string, value: string) => {
    setReviewed(null);
    setForm((current) => ({ ...current, [name]: value }));
  };
  if (claims.isPending) return <Loading />;
  if (claims.isError) return <ErrorState retry={() => void claims.refetch()} />;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p>{t("registerHint")}</p>
      <p className="accounting-hint">{t("noTaxClaim")}</p>
      <fieldset className="accounting-claims">
        <legend>{t("claims")}</legend>
        {!claims.data.length ? (
          <p>{t("noClaims")}</p>
        ) : (
          claims.data.map((c) => (
            <label className="accounting-pick" key={c.claim_id}>
              <input
                type="checkbox"
                checked={selected.includes(c.claim_id)}
                disabled={
                  busy ||
                  (!selected.includes(c.claim_id) &&
                    Boolean(first) &&
                    (c.currency !== first.currency ||
                      c.organisation_id !== first.organisation_id ||
                      selected.length >= 50))
                }
                onChange={(event) => {
                  setReviewed(null);
                  setSelected((ids) =>
                    event.target.checked
                      ? [...ids, c.claim_id]
                      : ids.filter((id) => id !== c.claim_id),
                  );
                }}
              />
              <span>
                {c.title}
                <small>
                  {c.organisation_name} · {c.accepted_charge} {c.currency}
                </small>
              </span>
            </label>
          ))
        )}
      </fieldset>
      {first && (
        <p>
          {t("accepted")}:{" "}
          <strong>
            {accountingAmount(accepted)} {first.currency}
          </strong>
        </p>
      )}
      <Field id="customer-invoice-number" label={t("number")}>
        <input
          id="customer-invoice-number"
          value={form.number}
          maxLength={80}
          required
          disabled={busy}
          onChange={(e) => set("number", e.target.value)}
        />
      </Field>
      <div className="form-row">
        <Field id="customer-invoice-issued" label={t("issued")}>
          <input
            id="customer-invoice-issued"
            type="date"
            value={form.issued}
            required
            disabled={busy}
            onChange={(e) => set("issued", e.target.value)}
          />
        </Field>
        <Field id="customer-invoice-due" label={t("due")}>
          <input
            id="customer-invoice-due"
            type="date"
            value={form.due}
            required
            disabled={busy}
            onChange={(e) => set("due", e.target.value)}
          />
        </Field>
      </div>
      <Field id="customer-invoice-total" label={t("total")} hint={t("amount")}>
        <input
          id="customer-invoice-total"
          inputMode="decimal"
          pattern="(0|[1-9][0-9]{0,9})\.[0-9]{2}"
          value={form.total}
          required
          disabled={busy}
          onChange={(e) => set("total", e.target.value)}
        />
      </Field>
      <Field
        id="customer-invoice-difference"
        label={t("difference")}
        hint={t("differenceHint")}
      >
        <textarea
          id="customer-invoice-difference"
          value={form.difference}
          maxLength={1000}
          disabled={busy}
          onChange={(e) => set("difference", e.target.value)}
        />
      </Field>
      <Field id="customer-invoice-pdf" label={t("pdf")}>
        <input
          id="customer-invoice-pdf"
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
      </Field>
      {upload.isPending && <Loading />}
      {document && (
        <p>
          <FileCheck2 size={18} aria-hidden="true" /> {document.original_name}
        </p>
      )}
      <label className="accounting-pick">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy || review === null}
          required
          onChange={(e) => setReviewed(e.target.checked ? review : null)}
        />
        <span>{t("confirmDocument")}</span>
      </label>
      {(upload.isError || save.isError) && (
        <Notice kind="error">
          {t(
            save.error?.message === "accounting_invalid" ? "invalid" : "error",
          )}
        </Notice>
      )}
      <Button type="submit" disabled={busy || !checked}>
        {t("saveInvoice")}
      </Button>
    </form>
  );
}

/** Record known payments or immutable reversals; the server locks the invoice
 * and rechecks its current outstanding balance before committing. */
function CustomerPaymentForm({
  invoice,
  actor,
  onDone,
  onDenied,
}: {
  invoice: AccountingInvoice;
  actor: string;
  onDone: () => void;
  onDenied: () => void;
}) {
  const { t } = useTranslation("accounting");
  const online = useOnline();
  const client = useQueryClient();
  const [amount, setAmount] = useState("");
  const [at, setAt] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const key = useRef<{ signature: string; key: string } | null>(null);
  const write = useMutation({
    mutationFn: async (paymentId: string | null) => {
      const payload: Record<string, unknown> = { p_invoice_id: invoice.id };
      const name = paymentId
        ? "reverse_customer_invoice_payment"
        : "record_customer_invoice_payment";
      if (paymentId) {
        if (reason.trim().length < 5) throw new Error("accounting_invalid");
        payload.p_payment_id = paymentId;
        payload.p_reason = reason;
      } else {
        const instant = zonedInstant(at, "UTC");
        if (
          !instant ||
          accountingCents(amount) <= 0n ||
          accountingCents(amount) >
            accountingCents(invoice.outstanding_total) ||
          !reference.trim()
        )
          throw new Error("accounting_invalid");
        payload.p_amount = amount;
        payload.p_paid_at = instant;
        payload.p_reference = reference;
      }
      const signature = JSON.stringify({ name, payload });
      if (key.current?.signature !== signature)
        key.current = { signature, key: crypto.randomUUID() };
      return accountingWrite(name, {
        ...payload,
        p_request_id: key.current.key,
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: accountingKeys.all(actor) });
      onDone();
    },
    onError: (error) => {
      if (permissionDenied(error)) onDenied();
    },
  });
  const busy = write.isPending || !online;
  return (
    <div>
      <p>
        {invoice.number} · {invoice.outstanding_total} {invoice.currency}
      </p>
      <p className="accounting-hint">{t("paymentHint")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          write.mutate(null);
        }}
      >
        <Field id="customer-payment-amount" label={t("amount")}>
          <input
            id="customer-payment-amount"
            value={amount}
            inputMode="decimal"
            pattern="(0|[1-9][0-9]{0,9})\.[0-9]{2}"
            required
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field id="customer-payment-at" label={t("paymentAt")}>
          <input
            id="customer-payment-at"
            type="datetime-local"
            value={at}
            required
            disabled={busy}
            onChange={(e) => setAt(e.target.value)}
          />
        </Field>
        <Field id="customer-payment-ref" label={t("reference")}>
          <input
            id="customer-payment-ref"
            value={reference}
            maxLength={200}
            required
            disabled={busy}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          disabled={busy || invoice.outstanding_total === "0.00"}
        >
          {t("savePayment")}
        </Button>
      </form>
      <h3>{t("paymentHistory")}</h3>
      <ol className="accounting-history">
        {invoice.payments.map((p) => (
          <li key={p.id}>
            {p.amount} {p.currency} · {p.reference}
            {p.reverses_id && <> · {t("reversed")}</>}
            {!p.reverses_id &&
              !invoice.payments.some((other) => other.reverses_id === p.id) && (
                <Button
                  variant="secondary"
                  disabled={busy || reason.trim().length < 5}
                  onClick={() => write.mutate(p.id)}
                >
                  {t("reverseButton")}
                </Button>
              )}
          </li>
        ))}
      </ol>
      <Field id="customer-payment-reason" label={t("reverseReason")}>
        <textarea
          id="customer-payment-reason"
          value={reason}
          maxLength={1000}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {write.isError && (
        <Notice kind="error">
          {t(
            write.error?.message === "accounting_invalid" ? "invalid" : "error",
          )}
        </Notice>
      )}
    </div>
  );
}

/** Validation errors retain drafts; a current authorization refusal closes the
 * local private projection until an explicit server reload succeeds. */
function permissionDenied(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "42501",
  );
}

/** Actor-bound accounting route. Capability changes suppress stale restricted
 * sources; every export and PDF still checks current database permission. */
export function AccountingPage() {
  const { session } = useAuth();
  const actor = session!.user.id;
  const { t } = useTranslation("accounting");
  const online = useOnline();
  const client = useQueryClient();
  const access = useQuery(accountingAccessQuery(actor));
  const [source, setSource] = useState<AccountingSource>("own");
  const [selected, setSelected] = useState<string[]>([]);
  const [register, setRegister] = useState(false);
  const [payment, setPayment] = useState<AccountingInvoice | null>(null);
  const [saved, setSaved] = useState(false);
  const [snapshot, setSnapshot] = useState<AccountingExport | null>(null);
  const [denied, setDenied] = useState(false);
  const sourceAllowed =
    source === "own" ||
    (source === "lecturer_all" &&
      access.data?.can_export_all_lecturers === true) ||
    (source === "customer" && access.data?.can_export_customer === true);
  const invoices = useInfiniteQuery({
    ...accountingInvoicesQuery(actor, source),
    enabled: sourceAllowed,
  });
  const rows =
    sourceAllowed && !invoices.isError
      ? (invoices.data?.pages.flatMap((page) => page.items) ?? [])
      : [];
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const exportRecords = useMutation({
    mutationFn: async (format: "json" | "csv") => {
      const signature = JSON.stringify({ source, selected });
      if (retry.current?.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      const result = await createAccountingExport(
        source,
        selected,
        retry.current.key,
      );
      downloadAccounting(result, format);
      setSnapshot(result);
      return result;
    },
    onSuccess: () => {
      retry.current = null;
    },
    onError: (error) => {
      if (permissionDenied(error)) setDenied(true);
    },
  });
  const complete = () => {
    setSaved(true);
    setRegister(false);
    setPayment(null);
  };
  const pdf = useMutation({
    mutationFn: (invoice: AccountingInvoice) => {
      requireOnline();
      return saveDownload(
        invoice.document_id,
        `${invoice.number}.pdf`,
        invoice.document_version_id,
      );
    },
    onError: (error) => {
      if (permissionDenied(error)) setDenied(true);
    },
  });
  if (access.isPending) return <Loading />;
  if (access.isError) return <ErrorState retry={() => void access.refetch()} />;
  if (denied)
    return (
      <ErrorState
        retry={() =>
          void (async () => {
            await access.refetch();
            await client.resetQueries({
              queryKey: [...accountingKeys.all(actor), "invoices"],
            });
            setSelected([]);
            setSnapshot(null);
            setRegister(false);
            setPayment(null);
            setDenied(false);
          })()
        }
      />
    );
  return (
    <>
      <PageHeading
        eyebrow="Luminovia Portal"
        title={t("title")}
        description={t("description")}
        action={
          access.data.can_manage_customer_invoices ? (
            <Button
              onClick={() => {
                setRegister(true);
                setSaved(false);
              }}
            >
              <Plus size={18} aria-hidden="true" />
              {t("register")}
            </Button>
          ) : undefined
        }
      />
      <p className="accounting-hint">{t("original")}</p>
      <p className="accounting-hint">{t("taxUnknown")}</p>
      <div className="accounting-toolbar">
        <Field id="accounting-source" label={t("source")}>
          <select
            id="accounting-source"
            value={source}
            disabled={exportRecords.isPending}
            onChange={(e) => {
              setSource(e.target.value as AccountingSource);
              setSelected([]);
              setSnapshot(null);
              setSaved(false);
            }}
          >
            <option value="own">{t("own")}</option>
            {access.data.can_export_all_lecturers && (
              <option value="lecturer_all">{t("lecturer_all")}</option>
            )}
            {access.data.can_export_customer && (
              <option value="customer">{t("customer")}</option>
            )}
          </select>
        </Field>
        <Button
          variant="secondary"
          onClick={() => {
            retry.current = null;
            setSnapshot(null);
            void client.invalidateQueries({
              queryKey: accountingKeys.all(actor),
            });
          }}
        >
          {t("refresh")}
        </Button>
      </div>
      {!online && <Notice kind="error">{t("offline")}</Notice>}
      {saved && <Notice>{t("saved")}</Notice>}
      {(exportRecords.isError || pdf.isError) && (
        <Notice kind="error">{t("error")}</Notice>
      )}
      <p className="accounting-hint">{t("selectHint")}</p>
      <p>{t("selectedCount", { count: selected.length })}</p>
      <div className="accounting-actions">
        <Button
          disabled={
            !online ||
            !sourceAllowed ||
            !selected.length ||
            exportRecords.isPending
          }
          onClick={() => exportRecords.mutate("json")}
        >
          <Download size={18} aria-hidden="true" />
          {t("exportJson")}
        </Button>
        <Button
          variant="secondary"
          disabled={
            !online ||
            !sourceAllowed ||
            !selected.length ||
            exportRecords.isPending
          }
          onClick={() => exportRecords.mutate("csv")}
        >
          {t("exportCsv")}
        </Button>
      </div>
      {snapshot && sourceAllowed && (
        <Notice>
          <span>
            {t("exportReady", {
              id: snapshot.id,
              count: snapshot.invoices.length,
            })}
          </span>
          <p className="accounting-metadata">
            {t("hash")}: {snapshot.sha256}
          </p>
        </Notice>
      )}
      <div className="accounting-grid">
        {!sourceAllowed ? (
          <ErrorState retry={() => void access.refetch()} />
        ) : invoices.isPending ? (
          <Loading />
        ) : invoices.isError ? (
          <ErrorState retry={() => void invoices.refetch()} />
        ) : !rows.length ? (
          <p>{t("empty")}</p>
        ) : (
          rows.map((i) => (
            <article className="accounting-card" key={i.id}>
              <h2>{i.number}</h2>
              <p>{i.organisation_name ?? i.assignments[0]?.customer_name}</p>
              <label className="accounting-pick">
                <input
                  type="checkbox"
                  checked={selected.includes(i.id)}
                  disabled={
                    exportRecords.isPending ||
                    (!selected.includes(i.id) && selected.length >= 100)
                  }
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, i.id]
                        : ids.filter((id) => id !== i.id),
                    )
                  }
                />
                <span>{t("select", { number: i.number })}</span>
              </label>
              <dl>
                <dt>{t("total")}</dt>
                <dd>
                  {i.recorded_total} {i.currency}
                </dd>
                <dt>{t("paid")}</dt>
                <dd>
                  {i.paid_total} {i.currency}
                </dd>
                <dt>{t("outstanding")}</dt>
                <dd>
                  {i.outstanding_total} {i.currency}
                </dd>
                <dt>{t("issued")}</dt>
                <dd>{i.issued_on}</dd>
                <dt>{t("due")}</dt>
                <dd>{i.due_on}</dd>
                <dt>{t("status")}</dt>
                <dd>{t(i.status === "paid" ? "paidStatus" : i.status)}</dd>
              </dl>
              <div className="accounting-actions">
                <Button
                  variant="secondary"
                  disabled={!online || pdf.isPending}
                  onClick={() => pdf.mutate(i)}
                >
                  {t("document")}
                </Button>
                {i.kind === "customer_invoice" &&
                  access.data.can_manage_customer_invoices && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPayment(i);
                        setSaved(false);
                      }}
                    >
                      {t("payment")}
                    </Button>
                  )}
              </div>
              <small>{i.assignments.map((a) => a.title).join(" · ")}</small>
              {i.kind === "customer_invoice" && i.payments.length > 0 && (
                <p className="accounting-hint">
                  {i.payments
                    .map(
                      (p) =>
                        `${p.amount} ${p.currency} · ${p.reference}${p.reverses_id ? ` · ${t("reversed")}` : ""}`,
                    )
                    .join("\n")}
                </p>
              )}
            </article>
          ))
        )}
      </div>
      {invoices.hasNextPage && (
        <Button
          variant="secondary"
          disabled={invoices.isFetchingNextPage}
          onClick={() => void invoices.fetchNextPage()}
        >
          {t("more")}
        </Button>
      )}
      <section className="accounting-panel">
        <h2>{t("einvoice")}</h2>
        <p>{t("einvoiceUnavailable")}</p>
        <p className="accounting-hint">{t("canonical")}</p>
        <p className="accounting-hint">{t("credits")}</p>
        <p className="accounting-hint">{t("exportHistory")}</p>
      </section>
      <Dialog
        open={register && access.data.can_manage_customer_invoices}
        onOpenChange={setRegister}
        title={t("register")}
        description={t("registerHint")}
      >
        {access.data.can_manage_customer_invoices && (
          <CustomerInvoiceForm
            actor={actor}
            onDone={complete}
            onDenied={() => setDenied(true)}
          />
        )}
      </Dialog>
      <Dialog
        open={Boolean(payment) && access.data.can_manage_customer_invoices}
        onOpenChange={(open) => {
          if (!open) setPayment(null);
        }}
        title={t("payment")}
        description={t("paymentHint")}
      >
        {payment && access.data.can_manage_customer_invoices && (
          <CustomerPaymentForm
            invoice={payment}
            actor={actor}
            onDone={complete}
            onDenied={() => setDenied(true)}
          />
        )}
      </Dialog>
    </>
  );
}
