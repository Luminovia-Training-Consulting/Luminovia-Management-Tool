/** Requests retain their retry identity, and never release assignments optimistically. */
import {useRef, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {useAuth} from "../auth/auth-context";
import {useOnline} from "../../lib/online";
import {dateTime} from "../../lib/dates";
import {Button} from "../../components/ui/button";
import {Dialog} from "../../components/ui/dialog";
import {ErrorState, Field, Loading, Notice} from "../../components/common";
import {refreshJobState} from "./lifecycle-api";
import {requestWithdrawal, reviewWithdrawal, withdrawalsQuery,} from "./withdrawal-api";
import "./withdrawal-i18n";

type Action =
    | { kind: "request"; id: string; requiresApproval: boolean }
    | { kind: "approve"; id: string }
    | { kind: "reject"; id: string };

/** Show own withdrawals and authorized reviews; retain draft and retry state until confirmation. */
export function JobWithdrawalPanel({
                                       jobId,
                                       zone,
                                   }: {
    jobId: string;
    zone: string;
}) {
    const actor = useAuth().session!.user.id;
    const {t, i18n} = useTranslation("withdrawal");
    const online = useOnline();
    const client = useQueryClient();
    const query = useQuery(withdrawalsQuery(actor, jobId));
    const [action, setAction] = useState<Action | null>(null);
    const [reason, setReason] = useState("");
    const retry = useRef<{ signature: string; id: string } | null>(null);
    const change = useMutation({
        mutationFn: async ({
                               action: chosen,
                               reason: text,
                           }: {
            action: Action;
            reason: string;
        }) => {
            const signature = JSON.stringify({chosen, text});
            if (retry.current?.signature !== signature)
                retry.current = {signature, id: crypto.randomUUID()};
            return chosen.kind === "request"
                ? requestWithdrawal(chosen.id, text, retry.current.id)
                : reviewWithdrawal(
                    chosen.id,
                    chosen.kind === "approve",
                    text,
                    retry.current.id,
                );
        },
        onSuccess: async () => {
            setAction(null);
            await refreshJobState(client);
        },
    });
    const open = (chosen: Action) => {
        setAction(chosen);
        setReason("");
        retry.current = null;
        change.reset();
    };
    // Synthetic/non-resource IDs do not issue a protected query.
    if (!query.isEnabled) return null;
    if (query.isPending) return <Loading/>;
    if (query.isError) return <ErrorState retry={() => void query.refetch()}/>;
    if (!query.data.claims.length && !query.data.items.length) return null;
    const required = action?.kind !== "request" || action.requiresApproval;
    return (
        <section className="panel job-lifecycle" aria-label={t("heading")}>
            <h2>{t("heading")}</h2>
            <p>{t("help")}</p>
            {!online && <Notice>{t("offline")}</Notice>}
            {query.data.claims
                .filter((claim) => claim.can_withdraw)
                .map((claim) => (
                    <div key={claim.claim_id}>
                        <p>{dateTime(claim.starts_at, i18n.language, zone)}</p>
                        <Button
                            variant="secondary"
                            disabled={!online || change.isPending}
                            onClick={() =>
                                open({
                                    kind: "request",
                                    id: claim.claim_id,
                                    requiresApproval: claim.requires_approval,
                                })
                            }
                        >
                            {t(claim.requires_approval ? "request" : "withdraw")}
                        </Button>
                    </div>
                ))}
            <ol className="job-life-history">
                {query.data.items.map((item) => (
                    <li key={item.id}>
                        <strong>{item.lecturer_name}</strong>
                        <p>{t(item.status)}</p>
                        <small>{dateTime(item.created_at, i18n.language, zone)}</small>
                        {item.reason && <p className="preserve-text">{item.reason}</p>}
                        {item.review_reason && (
                            <p className="preserve-text">
                                {t("decisionReason")}: {item.review_reason}
                            </p>
                        )}
                        {item.can_review && (
                            <div className="job-life-actions">
                                <Button
                                    disabled={!online || change.isPending}
                                    onClick={() => open({kind: "approve", id: item.id})}
                                >
                                    {t("approve")}
                                </Button>
                                <Button
                                    variant="secondary"
                                    disabled={!online || change.isPending}
                                    onClick={() => open({kind: "reject", id: item.id})}
                                >
                                    {t("reject")}
                                </Button>
                            </div>
                        )}
                    </li>
                ))}
            </ol>
            {change.isSuccess && (
                <Notice>
                    {t(
                        query.data.items.find((item) => item.id === change.data.id)
                            ?.status ?? change.data.status,
                    )}
                </Notice>
            )}
            <Button
                variant="ghost"
                disabled={!online || query.isFetching || change.isPending}
                onClick={() => void query.refetch()}
            >
                {t("refresh")}
            </Button>
            <Dialog
                open={action !== null}
                onOpenChange={(isOpen) => {
                    if (!isOpen && !change.isPending) setAction(null);
                }}
                title={t(
                    action?.kind === "approve"
                        ? "approve"
                        : action?.kind === "reject"
                            ? "reject"
                            : action?.requiresApproval
                                ? "request"
                                : "withdraw",
                )}
                description={t(
                    action?.kind === "approve"
                        ? "approveHelp"
                        : action?.kind === "reject"
                            ? "rejectHelp"
                            : action?.requiresApproval
                                ? "requestHelp"
                                : "directHelp",
                )}
            >
                <form
                    className="job-life-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (action) change.mutate({action, reason: reason.trim()});
                    }}
                >
                    {action?.kind === "request" && <p>{t("boundary")}</p>}
                    <Field
                        id="withdrawal-reason"
                        label={t(
                            action?.kind === "request"
                                ? required
                                    ? "reason"
                                    : "optionalReason"
                                : "decisionReason",
                        )}
                    >
            <textarea
                id="withdrawal-reason"
                value={reason}
                required={required}
                minLength={required ? 5 : undefined}
                maxLength={1000}
                disabled={change.isPending}
                onChange={(event) => setReason(event.target.value)}
            />
                    </Field>
                    <Button
                        disabled={
                            !online ||
                            change.isPending ||
                            (required && reason.trim().length < 5) ||
                            (!required &&
                                reason.trim().length > 0 &&
                                reason.trim().length < 5)
                        }
                    >
                        {t(
                            action?.kind === "approve"
                                ? "approve"
                                : action?.kind === "reject"
                                    ? "reject"
                                    : action?.requiresApproval
                                        ? "submit"
                                        : "confirm",
                        )}
                    </Button>
                    {change.isError && (
                        <Notice kind="error">
                            {t(
                                "code" in change.error && change.error.code === "PZ002"
                                    ? "chatOriginBlocked"
                                    : "failed",
                            )}
                        </Notice>
                    )}
                </form>
            </Dialog>
        </section>
    );
}