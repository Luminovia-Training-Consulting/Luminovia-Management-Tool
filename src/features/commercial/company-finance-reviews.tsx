import {useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Link} from "react-router-dom";
import {db} from "../../lib/supabase";
import {dateTime} from "../../lib/dates";
import {Notice} from "../../components/common";
import {Button} from "../../components/ui/button";
import {Dialog} from "../../components/ui/dialog";
import {requireOnline, useOnline} from "../../lib/online";

type Review = {
    claim_id: string;
    job_id: string;
    job_title: string;
    lecturer_name: string;
    requested_at: string;
    invoices: { number: string; status: string }[];
};

/** Persistently shows unresolved billing cases without changing invoices or assignments. */
export function CompanyFinanceReviews({
                                          actor,
                                          zone,
                                      }: {
    actor: string;
    zone: string;
}) {
    const {t, i18n} = useTranslation("platform");
    const invoiceText = useTranslation("commercial").t;
    const client = useQueryClient();
    const online = useOnline();
    const [selected, setSelected] = useState<Review | null>(null);
    const [note, setNote] = useState("");
    const resolve = useMutation({
        mutationFn: async () => {
            requireOnline();
            if (!selected) throw new Error("No selected review");
            const {error} = await db().rpc("resolve_company_invoice_rejection", {
                p_claim: selected.claim_id,
                p_note: note.trim(),
            });
            if (error) throw error;
        },
        onSuccess: async () => {
            await client.invalidateQueries();
            setSelected(null);
            setNote("");
        },
    });
    const reviews = useQuery({
        queryKey: ["company-invoice-reviews", actor],
        queryFn: async () => {
            const {data, error} = await db().rpc("company_invoice_reviews");
            if (error) throw error;
            if (!Array.isArray(data))
                throw new Error("Invalid finance review response");
            return data as Review[];
        },
    });
    if (reviews.isPending) return null;
    if (reviews.isError)
        return <Notice kind="error">{t("companyDecisionFailed")}</Notice>;
    return (
        <section className="panel commercial-section">
            <h2>{t("companyFinanceReviews")}</h2>
            <p>{t("companyFinanceHint")}</p>
            {!reviews.data.length ? (
                <p>{t("companyFinanceNone")}</p>
            ) : (
                reviews.data.map((item) => (
                    <article key={item.claim_id}>
                        <h3>
                            <Link to={`/jobs/${item.job_id}`}>{item.job_title}</Link>
                        </h3>
                        <p>
                            {item.lecturer_name} ·{" "}
                            {dateTime(item.requested_at, i18n.language, zone)} ({zone})
                        </p>
                        <ul>
                            {item.invoices.map((invoice) => (
                                <li key={invoice.number}>
                                    {invoice.number} · {invoiceText(invoice.status)}
                                </li>
                            ))}
                        </ul>
                        <Button
                            variant="secondary"
                            disabled={
                                !online ||
                                item.invoices.some(
                                    (invoice) =>
                                        !["cancelled", "rejected"].includes(invoice.status),
                                )
                            }
                            onClick={() => {
                                setSelected(item);
                                setNote("");
                                resolve.reset();
                            }}
                        >
                            {t("companyFinanceResolve")}
                        </Button>
                    </article>
                ))
            )}
            <Dialog
                open={Boolean(selected)}
                onOpenChange={(open) => {
                    if (!open && !resolve.isPending) setSelected(null);
                }}
                title={t("companyFinanceResolve")}
                description={t("companyFinanceResolveHint")}
            >
                <label htmlFor="company-finance-note">{t("companyFinanceNote")}</label>
                <textarea
                    id="company-finance-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={1000}
                />
                {resolve.isError && (
                    <Notice kind="error">{t("companyFinanceResolveError")}</Notice>
                )}
                <Button
                    disabled={!online || resolve.isPending || note.trim().length < 10}
                    onClick={() => resolve.mutate()}
                >
                    {t("companyFinanceResolveConfirm")}
                </Button>
            </Dialog>
        </section>
    );
}