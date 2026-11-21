/**
 * Fees, claim-derived invoices, review and individual payment records. Amounts/references follow
 * confirmed server rows; payment reversals require their own auditable action.
 */
import {useRef, useState} from "react";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {z} from "zod";
import {DateTime} from "luxon";
import {type QueryClient, useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {useSearchParams} from "react-router-dom";
import {AlertCircle, BadgeCheck, Banknote, CheckCircle2, Clock3, Download, FileText, Plus, Receipt, Wallet,} from "lucide-react";
import {useAuth} from "../auth/auth-context";
import {type PortalDocument, saveDownload} from "../files/api";
import {profileQuery} from "../../lib/queries";
import {db} from "../../lib/supabase";
import {dateTime, money, zonedInstant} from "../../lib/dates";
import {requireOnline, useOnline} from "../../lib/online";
import {Button} from "../../components/ui/button";
import {Dialog} from "../../components/ui/dialog";
import {ErrorState, Field, Loading, Notice, PageHeading,} from "../../components/common";
import {commercialAccessQuery, commercialKeys, downloadCsv, earningsQuery, groupedEarnings, invoiceDueState, invoicesDueFirst, invoicesQuery, paymentsQuery,} from "./api";
import type {EarningRecord, InvoicePayment, InvoiceRecord} from "./types";
import {CommercialPdfUpload} from "./pdf-upload";
import {InvoiceReviewQueue, MyInvoiceReviewRequests} from "./invoice-review";
import {FinanceTrendChart} from "./finance-trend";
import {InvoiceLabels} from "./invoice-labels";
import {RevenuePanel} from "./revenue";
import {CompanyFinanceReviews} from "./company-finance-reviews";
import "./i18n";
import "./platform-i18n";
import "./commercial.css";

/** Refresh live invoice projections after a confirmed financial mutation. */
async function refreshInvoiceViews(client: QueryClient, actor: string) {
    await Promise.all([
        client.invalidateQueries({queryKey: commercialKeys.finance(actor)}),
        client.invalidateQueries({queryKey: ["accounting", actor, "invoices"]}),
    ]);
}

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const invoiceSchema = z.object({
    number: z.string().trim().min(1).max(80),
    issued: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Link a clean invoice PDF version to selected accepted assignments checked by the server. */
function SubmitInvoice({
                           actor,
                           zone,
                           initialClaimId,
                           onDone,
                       }: {
    actor: string;
    zone: string;
    initialClaimId?: string;
    onDone: () => void;
}) {
    const {t, i18n} = useTranslation("commercial");
    const online = useOnline();
    const client = useQueryClient();
    const earnings = useQuery(earningsQuery(actor, false));
    const [selected, setSelected] = useState<string[]>(() =>
        initialClaimId ? [initialClaimId] : [],
    );
    const [document, setDocument] = useState<PortalDocument | null>(null);
    const [invalidDate, setInvalidDate] = useState(false);
    const [submissionError, setSubmissionError] = useState<string | null>(null);
    const [today] = useState(() => DateTime.now().setZone(zone).toISODate()!);
    const retry = useRef<{ signature: string; key: string } | null>(null);
    const form = useForm<z.infer<typeof invoiceSchema>>({
        resolver: zodResolver(invoiceSchema),
        defaultValues: {
            number: "",
            issued: today,
            due: DateTime.fromISO(today).plus({days: 30}).toISODate()!,
        },
    });
    const ownCandidates =
        earnings.data?.filter(
            (row) => !row.invoice_id && row.lecturer_id === actor,
        ) ?? [];
    const eligible = ownCandidates.filter(
        (row) =>
            !row.invoice_review_required &&
            row.invoice_eligible_at !== null &&
            DateTime.fromISO(row.invoice_eligible_at).toMillis() <= DateTime.now().toMillis(),
    );
    const reviewRequired = ownCandidates.filter((row) => row.invoice_review_required);
    const notReady = ownCandidates.filter(
        (row) => !row.invoice_review_required && !eligible.includes(row),
    );
    const rows = eligible.filter((row) => selected.includes(row.claim_id));
    const currency = rows[0]?.currency;
    const total =
        rows.reduce(
            (sum, row) => sum + Math.round(Number(row.total_amount) * 100),
            0,
        ) / 100;
    const submit = useMutation({
        mutationFn: async (values: z.infer<typeof invoiceSchema>) => {
            requireOnline();
            setInvalidDate(false);
            if (
                !DateTime.fromISO(values.issued).isValid ||
                !DateTime.fromISO(values.due).isValid ||
                values.due < values.issued
            ) {
                setInvalidDate(true);
                throw new Error("invalid_date");
            }
            if (
                !document ||
                document.owner_id !== actor ||
                rows.length !== selected.length ||
                !rows.length ||
                rows.length > 50 ||
                rows.some((row) => row.currency !== currency)
            )
                throw new Error("invalid_selection");
            const payload = {
                p_number: values.number,
                p_claim_ids: selected,
                p_document_version_id: document.current_version_id,
                p_issued_on: values.issued,
                p_due_on: values.due,
            };
            const signature = JSON.stringify(payload);
            if (!retry.current || retry.current.signature !== signature)
                retry.current = {signature, key: crypto.randomUUID()};
            const {data, error} = await db().rpc("submit_invoice", {
                ...payload,
                p_client_id: retry.current.key,
            });
            if (error || !data) throw error ?? new Error("unconfirmed");
        },
        onSuccess: async () => {
            await refreshInvoiceViews(client, actor);
            onDone();
        },
        onError: (error) => {
            const message = error instanceof Error ? error.message : "";
            setSubmissionError(
                message.includes("invoice_review_required")
                    ? "invoiceReviewRequired"
                    : message.includes("invoice_not_ready")
                        ? "invoiceNotReady"
                        : "failed",
            );
        },
    });
    if (earnings.isPending) return <Loading/>;
    if (earnings.isError)
        return <ErrorState retry={() => void earnings.refetch()}/>;
    return (
        <form
            noValidate
            onSubmit={form.handleSubmit((values) => {
                setSubmissionError(null);
                submit.mutate(values);
            })}
        >
            <Field
                id="invoice-number"
                label={t("invoiceNumber")}
                error={Boolean(form.formState.errors.number)}
            >
                <input
                    id="invoice-number"
                    {...form.register("number")}
                    maxLength={80}
                    disabled={submit.isPending}
                />
            </Field>
            <div className="form-row">
                <Field
                    id="invoice-issued"
                    label={t("issued")}
                    error={Boolean(form.formState.errors.issued)}
                >
                    <input
                        id="invoice-issued"
                        type="date"
                        {...form.register("issued")}
                        disabled={submit.isPending}
                    />
                </Field>
                <Field
                    id="invoice-due"
                    label={t("due")}
                    error={Boolean(form.formState.errors.due)}
                >
                    <input
                        id="invoice-due"
                        type="date"
                        {...form.register("due")}
                        disabled={submit.isPending}
                    />
                </Field>
            </div>
            <fieldset className="commercial-claim-picker">
                <legend>{t("chooseClaims")}</legend>
                <p className="muted commercial-small">
                    {t("oneCurrency")} {t("maxClaims")}
                </p>
                {reviewRequired.map((row) => (
                    <p className="commercial-small muted" key={`review-${row.claim_id}`}>
                        {row.title}: {t("invoiceReviewRequired")}
                    </p>
                ))}
                {eligible.length ? (
                    eligible.map((row) => (
                        <label className="commercial-claim" key={row.claim_id}>
                            <input
                                type="checkbox"
                                checked={selected.includes(row.claim_id)}
                                disabled={
                                    submit.isPending ||
                                    (!selected.includes(row.claim_id) &&
                                        ((Boolean(currency) && row.currency !== currency) ||
                                            selected.length >= 50))
                                }
                                onChange={(event) =>
                                    setSelected((current) =>
                                        event.target.checked
                                            ? [...current, row.claim_id]
                                            : current.filter((id) => id !== row.claim_id),
                                    )
                                }
                            />
                            <span>
                {row.title}
                                <small>
                  {row.customer_name} ·{" "}
                                    {dateTime(row.starts_at, i18n.language, zone)}
                </small>
              </span>
                            <strong>
                                {money(Number(row.total_amount), row.currency, i18n.language)}
                            </strong>
                        </label>
                    ))
                ) : (
                    <p>{t("noEligibleClaims")}</p>
                )}
                {notReady.map((row) => (
                    <p className="commercial-small muted" key={`not-ready-${row.claim_id}`}>
                        {row.title}: {t("invoiceNotReady")} {row.invoice_eligible_at &&
                        dateTime(row.invoice_eligible_at, i18n.language, zone)}
                    </p>
                ))}
            </fieldset>
            {currency && (
                <p className="commercial-selected-total">
                    {t("selectedTotal")}
                    <strong>{money(total, currency, i18n.language)}</strong>
                </p>
            )}
            <p className="commercial-small muted">{t("invoiceBasis")}</p>
            <CommercialPdfUpload
                kind="invoice"
                ownerId={actor}
                label={t("invoicePdf")}
                onDocument={setDocument}
                disabled={submit.isPending}
            />
            <div className="form-actions">
                <Button
                    disabled={!online || submit.isPending || !document || !rows.length}
                >
                    {t("invoiceSave")}
                </Button>
            </div>
            {submit.isError && (
                <Notice kind="error">
                    {t(
                        invalidDate
                            ? "invoiceDateInvalid"
                            : (submissionError ?? "failed"),
                    )}
                </Notice>
            )}
        </form>
    );
}

/** Record a reasoned payment reversal as a separate server action. */
function VoidPayment({
                         actor,
                         payment,
                         onDone,
                     }: {
    actor: string;
    payment: InvoicePayment;
    onDone: () => void;
}) {
    const {t} = useTranslation("commercial");
    const online = useOnline();
    const client = useQueryClient();
    const [reason, setReason] = useState("");
    const save = useMutation({
        mutationFn: async () => {
            requireOnline();
            const {error} = await db().rpc("void_invoice_payment", {
                p_payment_id: payment.id,
                p_reason: reason.trim(),
            });
            if (error) throw error;
        },
        onSuccess: async () => {
            await refreshInvoiceViews(client, actor);
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
            <Field id="payment-void-reason" label={t("voidReason")}>
        <textarea
            id="payment-void-reason"
            required
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={save.isPending}
        />
            </Field>
            <div className="form-actions">
                <Button disabled={!online || save.isPending || !reason.trim()}>
                    {t("voidPayment")}
                </Button>
            </div>
            {save.isError && <Notice kind="error">{t("failed")}</Notice>}
        </form>
    );
}

/** Load this invoice's authorized payment history and display reversals transparently. */
function PaymentHistory({
                            actor,
                            invoice,
                            manager,
                            zone,
                        }: {
    actor: string;
    invoice: InvoiceRecord;
    manager: boolean;
    zone: string;
}) {
    const {t, i18n} = useTranslation("commercial");
    const payments = useQuery(paymentsQuery(actor, invoice.id));
    const [voiding, setVoiding] = useState<InvoicePayment | null>(null);
    return (
        <>
            <h3>{t("paymentHistory")}</h3>
            {payments.isPending ? (
                <Loading/>
            ) : payments.isError ? (
                <ErrorState retry={() => void payments.refetch()}/>
            ) : payments.data.length ? (
                <ul className="commercial-payments">
                    {payments.data.map((payment) => (
                        <li
                            key={payment.id}
                            className={payment.voided_at ? "commercial-voided" : ""}
                        >
                            <div>
                                <strong>
                                    {money(
                                        Number(payment.amount),
                                        payment.currency,
                                        i18n.language,
                                    )}
                                </strong>
                                <span>{dateTime(payment.paid_at, i18n.language, zone)}</span>
                                {payment.reference && <p>{payment.reference}</p>}
                                <small>
                                    {t("paymentBy", {name: payment.recorded_by_name})}
                                </small>
                                {payment.voided_at && (
                                    <p>
                                        {t("voided")} · {payment.void_reason}
                                    </p>
                                )}
                            </div>
                            {manager && !payment.voided_at && (
                                <Button variant="ghost" onClick={() => setVoiding(payment)}>
                                    {t("voidPayment")}
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="muted">{t("noPayments")}</p>
            )}
            <Dialog
                open={Boolean(voiding)}
                onOpenChange={(open) => {
                    if (!open) setVoiding(null);
                }}
                title={t("voidPayment")}
                description={t("voidHint")}
            >
                {voiding && (
                    <VoidPayment
                        actor={actor}
                        payment={voiding}
                        onDone={() => setVoiding(null)}
                    />
                )}
            </Dialog>
        </>
    );
}

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const paymentSchema = z.object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    paidAt: z.string().min(1),
    reference: z.string().trim().max(200),
});

/** Validate a payment draft; the server checks the remaining balance and invoice state. */
function RecordPayment({
                           actor,
                           invoice,
                           zone,
                           onDone,
                       }: {
    actor: string;
    invoice: InvoiceRecord;
    zone: string;
    onDone: () => void;
}) {
    const {t, i18n} = useTranslation("commercial");
    const online = useOnline();
    const client = useQueryClient();
    const retry = useRef<{ signature: string; key: string } | null>(null);
    const [invalid, setInvalid] = useState(false);
    const [today] = useState(() =>
        DateTime.now().setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm"),
    );
    const outstanding =
        (Math.round(Number(invoice.total_amount) * 100) -
            Math.round(Number(invoice.paid_amount) * 100)) /
        100;
    const form = useForm<z.infer<typeof paymentSchema>>({
        resolver: zodResolver(paymentSchema),
        defaultValues: {
            amount: outstanding.toFixed(2),
            paidAt: today,
            reference: "",
        },
    });
    const save = useMutation({
        mutationFn: async (values: z.infer<typeof paymentSchema>) => {
            requireOnline();
            setInvalid(false);
            const paidAt = zonedInstant(values.paidAt, zone);
            const amount = Number(values.amount);
            if (
                !paidAt ||
                amount <= 0 ||
                Math.round(amount * 100) > Math.round(outstanding * 100)
            ) {
                setInvalid(true);
                throw new Error("invalid_payment");
            }
            const payload = {
                p_invoice_id: invoice.id,
                p_amount: amount,
                p_paid_at: paidAt,
                p_reference: values.reference,
            };
            const signature = JSON.stringify(payload);
            if (!retry.current || retry.current.signature !== signature)
                retry.current = {signature, key: crypto.randomUUID()};
            const {data, error} = await db().rpc("record_invoice_payment", {
                ...payload,
                p_client_id: retry.current.key,
            });
            if (error || !data) throw error ?? new Error("unconfirmed");
        },
        onSuccess: async () => {
            await refreshInvoiceViews(client, actor);
            onDone();
        },
    });
    return (
        <form
            noValidate
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
            <p>
                {t("outstanding")}:{" "}
                <strong>{money(outstanding, invoice.currency, i18n.language)}</strong>
            </p>
            <Field
                id="payment-amount"
                label={`${t("paymentAmount")} (${invoice.currency})`}
                error={Boolean(form.formState.errors.amount)}
            >
                <input
                    id="payment-amount"
                    inputMode="decimal"
                    {...form.register("amount")}
                    disabled={save.isPending}
                />
            </Field>
            <Field
                id="payment-date"
                label={`${t("paymentAt")} (${zone})`}
                error={Boolean(form.formState.errors.paidAt)}
            >
                <input
                    id="payment-date"
                    type="datetime-local"
                    {...form.register("paidAt")}
                    disabled={save.isPending}
                />
            </Field>
            <Field
                id="payment-reference"
                label={t("reference")}
                error={Boolean(form.formState.errors.reference)}
            >
                <input
                    id="payment-reference"
                    {...form.register("reference")}
                    maxLength={200}
                    disabled={save.isPending}
                />
            </Field>
            <div className="form-actions">
                <Button disabled={!online || save.isPending}>{t("paymentSave")}</Button>
            </div>
            {save.isError && (
                <Notice kind="error">{t(invalid ? "paymentInvalid" : "failed")}</Notice>
            )}
        </form>
    );
}

/** Submit explicit invoice approval/rejection through its business contract. */
function ReviewInvoice({
                           actor,
                           invoice,
                           onDone,
                       }: {
    actor: string;
    invoice: InvoiceRecord;
    onDone: () => void;
}) {
    const {t} = useTranslation("commercial");
    const online = useOnline();
    const client = useQueryClient();
    const [note, setNote] = useState(invoice.note ?? "");
    const [status, setStatus] = useState<"approved" | "rejected" | "cancelled">(
        "approved",
    );
    const review = useMutation({
        mutationFn: async () => {
            requireOnline();
            const {error} = await db().rpc("review_invoice", {
                p_invoice_id: invoice.id,
                p_status: status,
                p_note: note.trim(),
            });
            if (error) throw error;
        },
        onSuccess: async () => {
            await refreshInvoiceViews(client, actor);
            onDone();
        },
    });
    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                review.mutate();
            }}
        >
            <Field id="invoice-review-status" label={t("status")}>
                <select
                    id="invoice-review-status"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as typeof status)}
                    disabled={review.isPending}
                >
                    <option value="approved">{t("approve")}</option>
                    <option value="rejected">{t("reject")}</option>
                    <option value="cancelled">{t("cancelInvoice")}</option>
                </select>
            </Field>
            <Field id="invoice-review-note" label={t("reviewNote")}>
        <textarea
            id="invoice-review-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            disabled={review.isPending}
        />
            </Field>
            <div className="form-actions">
                <Button disabled={!online || review.isPending}>
                    {t(
                        status === "approved"
                            ? "approve"
                            : status === "rejected"
                                ? "reject"
                                : "cancelInvoice",
                    )}
                </Button>
            </div>
            {review.isError && <Notice kind="error">{t("failed")}</Notice>}
        </form>
    );
}

/** Combine the confirmed invoice, exact PDF version, review state and applicable payment actions. */
function InvoiceCard({
                         actor,
                         invoice,
                         manager,
                         zone,
                     }: {
    actor: string;
    invoice: InvoiceRecord;
    manager: boolean;
    zone: string;
}) {
    const {t, i18n} = useTranslation("commercial");
    const online = useOnline();
    const [reviewing, setReviewing] = useState(false);
    const [paying, setPaying] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const today = DateTime.now().setZone(zone).toISODate()!;
    const dueState = invoiceDueState(invoice, today);
    const dueStateText = {
        early: "invoiceEarly",
        half_term: "invoiceHalfTerm",
        due_soon: "invoiceDueSoon",
        overdue: "invoiceOverdue",
        paid: "invoicePaidStatus",
        inactive: "",
    }[dueState];
    const DueIcon =
        dueState === "overdue"
            ? AlertCircle
            : dueState === "paid"
                ? BadgeCheck
                : dueState === "early"
                    ? CheckCircle2
                    : Clock3;
    const outstanding = Math.max(
        0,
        Number(invoice.total_amount) - Number(invoice.paid_amount),
    );
    const date = (value: string) =>
        DateTime.fromISO(value)
            .setLocale(i18n.language)
            .toLocaleString(DateTime.DATE_MED);
    return (
        <article className="panel commercial-invoice-card">
            <div className="commercial-card-heading">
        <span className="commercial-document-icon" aria-hidden="true">
          <Receipt size={23}/>
        </span>
                <div>
                    <span className="eyebrow">{t("invoiceNumber")}</span>
                    <h3>{invoice.number}</h3>
                    {manager && <p>{invoice.user_name}</p>}
                </div>
                <span className={`badge commercial-status-${invoice.status}`}>
          {t(invoice.status)}
        </span>
            </div>
            <dl className="commercial-facts">
                <dt>{t("issued")}</dt>
                <dd>{date(invoice.issued_on)}</dd>
                <dt>{t("due")}</dt>
                <dd>{date(invoice.due_on)}</dd>
                <dt>{t("total")}</dt>
                <dd>
                    <strong>
                        {money(
                            Number(invoice.total_amount),
                            invoice.currency,
                            i18n.language,
                        )}
                    </strong>
                </dd>
                <dt>{t("received")}</dt>
                <dd>
                    {money(Number(invoice.paid_amount), invoice.currency, i18n.language)}
                </dd>
            </dl>
            {dueState !== "inactive" && (
                <p className={`invoice-due-status invoice-due-${dueState}`} role="status">
                    <DueIcon size={16} aria-hidden="true"/>
                    <strong>{t(dueStateText)}</strong>
                    {outstanding > 0 && (
                        <span>
              {t("invoiceOutstanding")}: {money(outstanding, invoice.currency, i18n.language)}
            </span>
                    )}
                </p>
            )}
            {invoice.note && <p className="commercial-note">{invoice.note}</p>}
            <InvoiceLabels
                actor={actor}
                invoice={invoice}
                canEdit={manager || invoice.user_id === actor}
            />
            <div className="form-actions">
                <Button
                    variant="secondary"
                    disabled={!online || busy}
                    onClick={async () => {
                        setBusy(true);
                        setFailed(false);
                        try {
                            await saveDownload(
                                invoice.document_id,
                                `${invoice.number}.pdf`,
                                invoice.document_version_id,
                            );
                        } catch {
                            setFailed(true);
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    <Download size={16}/>
                    {t("download")}
                </Button>
                {manager && invoice.status !== "paid" && (
                    <Button
                        variant="secondary"
                        disabled={!online}
                        onClick={() => setReviewing(true)}
                    >
                        {t("review")}
                    </Button>
                )}
                {manager && invoice.status === "approved" && (
                    <Button disabled={!online} onClick={() => setPaying(true)}>
                        <Banknote size={16}/>
                        {t("payment")}
                    </Button>
                )}
                <Button
                    variant="ghost"
                    onClick={() => setShowHistory((current) => !current)}
                    aria-expanded={showHistory}
                >
                    {t("paymentHistory")}
                </Button>
            </div>
            {failed && <Notice kind="error">{t("failed")}</Notice>}
            {showHistory && (
                <PaymentHistory
                    actor={actor}
                    invoice={invoice}
                    manager={manager}
                    zone={zone}
                />
            )}
            <Dialog
                open={reviewing}
                onOpenChange={setReviewing}
                title={t("review")}
                description={t("reviewHint")}
            >
                {reviewing && (
                    <ReviewInvoice
                        actor={actor}
                        invoice={invoice}
                        onDone={() => setReviewing(false)}
                    />
                )}
            </Dialog>
            <Dialog
                open={paying}
                onOpenChange={setPaying}
                title={t("payment")}
                description={t("paymentHint")}
            >
                {paying && (
                    <RecordPayment
                        actor={actor}
                        invoice={invoice}
                        zone={zone}
                        onDone={() => setPaying(false)}
                    />
                )}
            </Dialog>
        </article>
    );
}

/** Render authorized fee records with original currency and confirmed billing state. */
function EarningsTable({
                           rows,
                           manager,
                           zone,
                       }: {
    rows: EarningRecord[];
    manager: boolean;
    zone: string;
}) {
    const {t, i18n} = useTranslation("commercial");
    return (
        <div
            className="commercial-table-scroll"
            role="region"
            aria-label={t("earnings")}
            tabIndex={0}
        >
            <table className="commercial-table">
                <thead>
                <tr>
                    <th>{t("assignment")}</th>
                    {manager && <th>{t("lecturer")}</th>}
                    <th>{t("dates")}</th>
                    <th>{t("total")}</th>
                    <th>{t("status")}</th>
                </tr>
                </thead>
                <tbody>
                {rows.map((row) => (
                    <tr key={row.claim_id}>
                        <td>
                            <strong>{row.title}</strong>
                            <small>{row.customer_name}</small>
                        </td>
                        {manager && <td>{row.lecturer_name}</td>}
                        <td>
                            {dateTime(row.starts_at, i18n.language, zone)}
                            <small>{dateTime(row.ends_at, i18n.language, zone)}</small>
                        </td>
                        <td>
                            {money(Number(row.total_amount), row.currency, i18n.language)}
                        </td>
                        <td>
                <span className={`badge commercial-status-${row.stage}`}>
                  {row.stage === "review"
                      ? t("invoiceReviewStage")
                      : t(row.stage)}
                </span>
                        </td>
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
}

/** Combine permissions, fees, invoices, export and payment actions for the current actor. */
export function FinancePage() {
    const {t, i18n} = useTranslation("commercial");
    const platformText = useTranslation("platform").t;
    const {session} = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedClaimId = searchParams.get("claim") ?? undefined;
    const actor = session!.user.id;
    const online = useOnline();
    const access = useQuery(commercialAccessQuery(actor));
    const profile = useQuery(profileQuery(actor));
    const manager = access.data?.can_manage_finance ?? false;
    const [all, setAll] = useState(false);
    const effectiveAll = manager && all;
    const earnings = useQuery({
        ...earningsQuery(actor, effectiveAll),
        enabled: !access.isPending,
    });
    const invoices = useQuery({
        ...invoicesQuery(actor, effectiveAll),
        enabled: !access.isPending,
    });
    const [openedInvoiceForm, setSubmitting] = useState(false);
    const submitting = Boolean(access.data?.can_submit_invoice && (openedInvoiceForm || requestedClaimId));
    const [invoiceSearch, setInvoiceSearch] = useState("");
    const [invoiceStatus, setInvoiceStatus] = useState("");
    const [invoiceCurrency, setInvoiceCurrency] = useState("");
    const [invoiceLabel, setInvoiceLabel] = useState("");
    const zone = profile.data?.time_zone ?? "Europe/Berlin";
    const today = DateTime.now().setZone(zone).toISODate()!;
    const invoiceLabels = [
        ...new Set((invoices.data ?? []).flatMap((row) => row.labels ?? [])),
    ].sort((a, b) => a.localeCompare(b, i18n.language));
    const visibleInvoices = invoicesDueFirst(invoices.data ?? [], today).filter(
        (row) =>
            (!invoiceStatus || row.status === invoiceStatus) &&
            (!invoiceLabel || (row.labels ?? []).includes(invoiceLabel)) &&
            (!invoiceCurrency || row.currency === invoiceCurrency) &&
            `${row.number} ${row.user_name} ${row.note ?? ""}`
                .toLocaleLowerCase(i18n.language)
                .includes(invoiceSearch.toLocaleLowerCase(i18n.language)),
    );
    const summaries = groupedEarnings(earnings.data ?? []);
    const trendSource =
        manager || access.data?.can_submit_invoice ? "earnings" : "invoices";
    return (
        <>
            <PageHeading
                title={t("finance")}
                description={t("financeIntro")}
                action={
                    access.data?.can_submit_invoice && (
                        <Button disabled={!online} onClick={() => setSubmitting(true)}>
                            <Plus size={17}/>
                            {t("createInvoice")}
                        </Button>
                    )
                }
            />
            <RevenuePanel/>
            {!earnings.isPending && !invoices.isPending && (
                <FinanceTrendChart
                    earnings={earnings.data ?? []}
                    invoices={invoices.data ?? []}
                    source={trendSource}
                    zone={zone}
                />
            )}
            {access.data?.can_submit_invoice && (
                <MyInvoiceReviewRequests actor={actor} zone={zone}/>
            )}
            {manager && <InvoiceReviewQueue actor={actor}/>}
            {manager && <CompanyFinanceReviews actor={actor} zone={zone}/>}
            {manager && (
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={all}
                        onChange={(event) => setAll(event.target.checked)}
                    />
                    {t("allPeople")}
                </label>
            )}
            <p className="muted commercial-small">
                {t("originalCurrency")} {t("invoiceBasis")}
            </p>
            {access.isPending || earnings.isPending || invoices.isPending ? (
                <Loading/>
            ) : access.isError || earnings.isError || invoices.isError ? (
                <ErrorState
                    retry={() => {
                        void access.refetch();
                        void earnings.refetch();
                        void invoices.refetch();
                    }}
                />
            ) : (
                <>
                    {summaries.length ? (
                        <div className="commercial-currency-grid">
                            {summaries.map((group) => (
                                <section
                                    className="panel commercial-currency"
                                    key={group.currency}
                                >
                                    <div className="commercial-section-heading">
                                        <h2>{group.currency}</h2>
                                        <Wallet size={21}/>
                                    </div>
                                    <dl>
                                        {(
                                            ["expected", "review", "completed", "invoiced", "paid"] as const
                                        ).map((stage) => (
                                            <div key={stage}>
                                                <dt>
                                                    {stage === "review" ? t("invoiceReviewStage") : t(stage)}
                                                </dt>
                                                <dd>
                                                    {money(group[stage], group.currency, i18n.language)}
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                </section>
                            ))}
                        </div>
                    ) : (
                        <div className="panel commercial-empty">
                            <Wallet size={34}/>
                            <p>{t("noEarnings")}</p>
                        </div>
                    )}
                    <section className="panel commercial-section">
                        <div className="commercial-section-heading">
                            <h2>{t("earnings")}</h2>
                            <Button
                                variant="ghost"
                                disabled={!earnings.data.length}
                                onClick={() =>
                                    downloadCsv("luminovia-earnings.csv", [
                                        [
                                            t("assignment"),
                                            t("lecturer"),
                                            t("client"),
                                            t("dates"),
                                            t("total"),
                                            "ISO 4217",
                                            t("status"),
                                        ],
                                        ...earnings.data.map((row) => [
                                            row.title,
                                            row.lecturer_name,
                                            row.customer_name,
                                            row.starts_at,
                                            row.total_amount,
                                            row.currency,
                                            row.stage === "review"
                                                ? t("invoiceReviewStage")
                                                : t(row.stage),
                                        ]),
                                    ])
                                }
                            >
                                <Download size={16}/>
                                {t("exportEarnings")}
                            </Button>
                        </div>
                        {earnings.data.length ? (
                            <EarningsTable
                                rows={earnings.data}
                                manager={effectiveAll}
                                zone={zone}
                            />
                        ) : (
                            <p className="muted">{t("noEarnings")}</p>
                        )}
                    </section>
                    <section className="commercial-section">
                        <div className="commercial-section-heading">
                            <h2>
                                <FileText size={22}/>
                                {t("invoices")}
                            </h2>
                            <Button
                                variant="ghost"
                                disabled={!visibleInvoices.length}
                                onClick={() =>
                                    downloadCsv("luminovia-invoices.csv", [
                                        [
                                            t("invoiceNumber"),
                                            t("lecturer"),
                                            t("issued"),
                                            t("due"),
                                            t("total"),
                                            t("received"),
                                            "ISO 4217",
                                            t("status"),
                                            platformText("invoiceLabels"),
                                        ],
                                        ...visibleInvoices.map((row) => [
                                            row.number,
                                            row.user_name,
                                            row.issued_on,
                                            row.due_on,
                                            row.total_amount,
                                            row.paid_amount,
                                            row.currency,
                                            t(row.status),
                                            (row.labels ?? []).join(" | "),
                                        ]),
                                    ])
                                }
                            >
                                <Download size={16}/>
                                {t("exportInvoices")}
                            </Button>
                        </div>
                        <div className="panel platform-filters">
                            <Field id="invoice-search" label={platformText("invoiceSearch")}>
                                <input
                                    id="invoice-search"
                                    type="search"
                                    value={invoiceSearch}
                                    onChange={(event) => setInvoiceSearch(event.target.value)}
                                />
                            </Field>
                            <Field
                                id="invoice-status-filter"
                                label={platformText("invoiceStatus")}
                            >
                                <select
                                    id="invoice-status-filter"
                                    value={invoiceStatus}
                                    onChange={(event) => setInvoiceStatus(event.target.value)}
                                >
                                    <option value="">{platformText("allStatuses")}</option>
                                    {[
                                        "submitted",
                                        "approved",
                                        "paid",
                                        "rejected",
                                        "cancelled",
                                    ].map((status) => (
                                        <option key={status} value={status}>
                                            {t(status)}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field
                                id="invoice-label-filter"
                                label={platformText("invoiceLabels")}
                            >
                                <select
                                    id="invoice-label-filter"
                                    value={invoiceLabel}
                                    onChange={(event) => setInvoiceLabel(event.target.value)}
                                >
                                    <option value="">{platformText("allLabels")}</option>
                                    {invoiceLabels.map((label) => (
                                        <option key={label} value={label}>
                                            {label}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field
                                id="invoice-currency-filter"
                                label={i18n.getFixedT(i18n.language)("currency")}
                            >
                                <select
                                    id="invoice-currency-filter"
                                    value={invoiceCurrency}
                                    onChange={(event) => setInvoiceCurrency(event.target.value)}
                                >
                                    <option value="">{platformText("allCurrencies")}</option>
                                    <option>EUR</option>
                                    <option>AUD</option>
                                </select>
                            </Field>
                        </div>
                        {visibleInvoices.length ? (
                            <div className="commercial-contract-grid">
                                {visibleInvoices.map((invoice) => (
                                    <InvoiceCard
                                        key={invoice.id}
                                        actor={actor}
                                        invoice={invoice}
                                        manager={manager}
                                        zone={zone}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="panel commercial-empty">
                                <Receipt size={34}/>
                                <p>{t("noInvoices")}</p>
                            </div>
                        )}
                    </section>
                </>
            )}
            <Dialog
                open={submitting}
                onOpenChange={(open) => {
                    setSubmitting(open);
                    if (!open && searchParams.has("claim")) {
                        const next = new URLSearchParams(searchParams);
                        next.delete("claim");
                        setSearchParams(next, {replace: true});
                    }
                }}
                title={t("createInvoice")}
                description={t("invoiceHint")}
            >
                {submitting && access.data?.can_submit_invoice && (
                    <SubmitInvoice
                        key={requestedClaimId ?? "manual"}
                        actor={actor}
                        zone={zone}
                        initialClaimId={requestedClaimId}
                        onDone={() => {
                            setSubmitting(false);
                            if (searchParams.has("claim")) {
                                const next = new URLSearchParams(searchParams);
                                next.delete("claim");
                                setSearchParams(next, {replace: true});
                            }
                        }}
                    />
                )}
            </Dialog>
        </>
    );
}
