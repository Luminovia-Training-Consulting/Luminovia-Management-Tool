/** Permanent deletion uses a reviewed server preview and acknowledged resumable operation. */
import {createContext, type ReactNode, useContext, useEffect, useRef, useState,} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {useAuth} from "../auth/auth-context";
import {Button} from "../../components/ui/button";
import {Dialog} from "../../components/ui/dialog";
import {ErrorState, Field, Loading, Notice, PageHeading,} from "../../components/common";
import {useOnline} from "../../lib/online";
import {confirmDeletion, deletionAccessQuery, type DeletionAttempt, deletionAttemptsQuery, deletionDenied, type DeletionOperation, deletionPreviewQuery, deletionReceiptsQuery, deletionResourcesQuery, refreshAfterDeletion, resumeDeletion,} from "./api";
import "./i18n";
import "./deletions.css";

type Target = { kind: string; id: string; label: string };
const DialogContext = createContext<((target: Target) => void) | null>(null);

/** Keep a confirmed operation visible when its original resource row disappears. */
export function PermanentDeletionProvider({
                                              children,
                                          }: {
    children: ReactNode;
}) {
    const {session} = useAuth();
    const actor = session!.user.id;
    const [target, setTarget] = useState<(Target & { actor: string }) | null>(
        null,
    );
    return (
        <DialogContext.Provider value={(value) => setTarget({...value, actor})}>
            {children}
            <OperationReceipts
                actor={actor}
                open={(value) => setTarget({...value, label: "", actor})}
            />
            {target?.actor === actor && (
                <AuthorizedDialog
                    key={`${actor}:${target.kind}:${target.id}`}
                    actor={actor}
                    target={target}
                    close={() => setTarget(null)}
                />
            )}
        </DialogContext.Provider>
    );
}

/** Keep incomplete cleanup reachable after closing a dialog or changing routes. */
function OperationReceipts({
                               actor,
                               open,
                           }: {
    actor: string;
    open: (value: { kind: string; id: string }) => void;
}) {
    const {t} = useTranslation("deletions");
    const access = useQuery(deletionAccessQuery(actor));
    const receipts = useQuery(deletionReceiptsQuery(actor));
    const attempts = useQuery(deletionAttemptsQuery(actor));
    const pending = receipts.data.filter(
        (operation) =>
            operation.status !== "completed" &&
            access.data?.kinds.includes(operation.kind),
    );
    const uncertain = attempts.data.filter(
        (attempt) =>
            access.data?.kinds.includes(attempt.plan.kind) &&
            !pending.some(
                (operation) =>
                    operation.kind === attempt.plan.kind &&
                    operation.id === attempt.plan.id,
            ),
    );
    if (
        access.isError ||
        deletionDenied(receipts.error) ||
        (!pending.length && !uncertain.length)
    )
        return null;
    return (
        <aside
            className="deletion-operation-receipts"
            aria-label={t("pendingOperations")}
        >
            {uncertain.map((attempt) => (
                <div key={attempt.request}>
                    <p>{t("uncertain")}</p>
                    <Button variant="secondary" onClick={() => open(attempt.plan)}>
                        {t("resume")}
                    </Button>
                </div>
            ))}
            {pending.map((operation) => (
                <div key={operation.operation_id}>
                    <p>{t(operation.status)}</p>
                    <small>{t("operation", {id: operation.operation_id})}</small>
                    <Button variant="secondary" onClick={() => open(operation)}>
                        {t("resume")}
                    </Button>
                </div>
            ))}
        </aside>
    );
}

/** Render a contextual action only under a current server-provided deletion capability. */
export function PermanentDeleteAction({kind, id, label}: Target) {
    const {session} = useAuth();
    const actor = session!.user.id;
    const {t} = useTranslation("deletions");
    const access = useQuery(deletionAccessQuery(actor));
    const online = useOnline();
    const launch = useContext(DialogContext);
    const [local, setLocal] = useState<string | null>(null);
    const allowed = !access.isError && access.data?.kinds.includes(kind);
    if (!allowed) return null;
    return (
        <>
            <Button
                type="button"
                variant="danger"
                disabled={!online}
                aria-label={t("actionNamed", {
                    name: targetLabel({kind, id, label}, t),
                })}
                onClick={() => (launch ? launch({kind, id, label}) : setLocal(actor))}
            >
                {t("action")}
            </Button>
            {local === actor && (
                <AuthorizedDialog
                    key={`${actor}:${kind}:${id}`}
                    actor={actor}
                    target={{kind, id, label}}
                    close={() => setLocal(null)}
                />
            )}
        </>
    );
}

/** Revocation immediately unmounts the preview, confirmation draft and operation details. */
function AuthorizedDialog({
                              actor,
                              target,
                              close,
                          }: {
    actor: string;
    target: Target;
    close: () => void;
}) {
    const access = useQuery(deletionAccessQuery(actor));
    const receipts = useQuery(deletionReceiptsQuery(actor));
    const allowed =
        !access.isError &&
        !deletionDenied(receipts.error) &&
        access.data?.kinds.includes(target.kind);
    useEffect(() => {
        if (
            access.isError ||
            deletionDenied(receipts.error) ||
            (access.data && !allowed)
        )
            close();
    }, [access.isError, access.data, receipts.error, allowed, close]);
    if (!allowed) return null;
    return <DeletionDialog actor={actor} target={target} close={close}/>;
}

/** Translate known table/root labels without presenting internal schema names as product copy. */
function resourceLabel(
    kind: string,
    t: ReturnType<typeof useTranslation>["t"],
) {
    const raw = kind.split(".").at(-1) ?? kind;
    const aliases: Record<string, string> = {
        protected_payment_history: "protectedPaymentHistory",
        audit_attributions: "auditAttributions",
        released_chat_ownership: "releasedChatOwnership",
        pending_personal_deletions: "pendingPersonalDeletions",
        user_roles: "roleAssignments",
        lecturer_topics: "expertiseEntries",
        profile_details: "profileDetails",
        profile_avatars: "avatarSelections",
        notifications: "notificationEntries",
        notification_preferences: "notificationPreferences",
        delivery_preferences: "deliveryPreferences",
        dashboard_preferences: "dashboardPreferences",
        staff_contact_visibility: "contactVisibility",
        push_subscriptions: "pushSubscriptions",
        calendar_subscriptions: "calendarSubscriptions",
        personal_favourites: "personalFavourites",
        job_waitlist: "jobWaitlist",
        course_notebooks: "courseNotebooks",
        course_resource_acknowledgements: "courseResourceAcknowledgements",
        notification_email_outbox: "emailDeliveries",
        notification_push_outbox: "pushDeliveries",
        teaching_preparation: "teachingPreparation",
        client_request_briefs: "clientRequestBriefs",
        client_request_revisions: "clientRequestRevisions",
        pending_external_deliveries: "pendingExternalDeliveries",
        attention_preferences: "attentionPreferences",
        welcome_progress: "welcomeProgress",
        chat_members: "chatMemberships",
        message_reactions: "messageReactions",
        client_organisation_memberships: "companyMemberships",
        invitation_requests: "invitationRecords",
        claim_events: "assignmentHistory",
        job_lifecycle_requests: "jobChangeRecords",
        job_briefings: "jobBriefings",
        job_briefing_requests: "jobBriefingRequests",
        client_course_requests: "companyCourseRequests",
        job_commission_offers: "jobPricingRecords",
        course_run_job_requests: "courseJobRecords",
        organisation_private_details: "organisationDetails",
        course_template_topics: "courseTopicAssignments",
        chat_message_revisions: "messageRevisions",
        chat_content_versions: "messageVersions",
        chat_mention_versions: "mentionRecords",
        chat_mention_requests: "mentionOperations",
        document_organisation: "fileOrganisation",
        saved_job_views: "saved_job_view",
        announcement_revisions: "announcementVersions",
        announcement_publications: "announcementPublications",
        announcement_acknowledgements: "announcementAcknowledgements",
        announcement_requests: "announcementOperations",
        portal_announcements: "announcement",
        global_event_requests: "calendarChangeRecords",
        qualification_states: "qualificationStates",
        qualification_evidence: "qualificationEvidence",
        qualification_events: "qualificationHistory",
        qualification_requests: "qualificationOperations",
        forum_post_revisions: "forumPostVersions",
        forum_subscriptions: "forumSubscriptions",
        forum_reports: "forumReports",
        building_blocks: "building_block",
        profiles: "account",
        users: "account",
        documents: "document",
        document_versions: "versions",
        jobs: "job",
        job_sessions: "jobSessions",
        job_requirements: "jobRequirements",
        job_claims: "assignment",
        assignment_sessions: "assignmentSessions",
        organisations: "organisation",
        organisation_contacts: "organisation_contact",
        course_templates: "course_template",
        course_runs: "course_run",
        course_sessions: "course_session",
        topics: "topic",
        wiki_pages: "wiki_page",
        wiki_revisions: "revisions",
        forum_threads: "forum_thread",
        forum_posts: "forum_post",
        chat_rooms: "chat_room",
        messages: "message",
        resource_comments: "resource_comment",
        course_reviews: "course_review",
        announcements: "announcement",
        global_events: "global_event",
        contracts: "contract",
        invoices: "invoice",
        payment_records: "payment",
        personal_events: "personal_event",
        lecturer_availability: "availability",
    };
    return t(aliases[raw] ?? raw, {defaultValue: t("resources")});
}

/** Localise generated metadata labels while leaving authored names unchanged. */
function targetLabel(
    target: Target,
    t: ReturnType<typeof useTranslation>["t"],
) {
    return target.label === `${target.kind} ${target.id}`
        ? `${resourceLabel(target.kind, t)} ${target.id}`
        : target.label;
}

/** Freeze each confirmation to its reviewed plan; retries never generate another request ID. */
function DeletionDialog({
                            actor,
                            target,
                            close,
                        }: {
    actor: string;
    target: Target;
    close: () => void;
}) {
    const {t} = useTranslation("deletions");
    const client = useQueryClient();
    const online = useOnline();
    const [attempt, setAttempt] = useState<DeletionAttempt | null>(
        () =>
            client
                .getQueryData<DeletionAttempt[]>(deletionAttemptsQuery(actor).queryKey)
                ?.find(
                    (value) =>
                        value.plan.kind === target.kind && value.plan.id === target.id,
                ) ?? null,
    );
    const [operation, setOperation] = useState<DeletionOperation | null>(
        () =>
            client
                .getQueryData<DeletionOperation[]>(
                    deletionReceiptsQuery(actor).queryKey,
                )
                ?.find(
                    (value) =>
                        value.kind === target.kind &&
                        value.id === target.id &&
                        value.status !== "completed",
                ) ?? null,
    );
    const preview = useQuery({
        ...deletionPreviewQuery(actor, target.kind, target.id),
        refetchOnMount: "always",
        enabled: operation === null && attempt === null,
    });
    const [text, setText] = useState("");
    const [checked, setChecked] = useState(false);
    const [expired, setExpired] = useState(false);
    const [rejected, setRejected] = useState(false);
    const request = useRef({
        plan: attempt?.plan.plan_id ?? "",
        id: attempt?.request ?? crypto.randomUUID(),
    });
    const [denied, setDenied] = useState(false);
    const change = useMutation({
        mutationFn: async () => {
            if (operation) return resumeDeletion(operation);
            if (attempt) return confirmDeletion(attempt.plan, attempt.request);
            const plan = preview.data;
            if (
                !plan ||
                !plan.can_confirm ||
                plan.blockers.length ||
                text !== "DELETE" ||
                !checked
            )
                throw new Error("confirmation_required");
            if (
                request.current.plan !== plan.plan_id &&
                Date.parse(plan.expires_at) <= Date.now()
            ) {
                setExpired(true);
                throw new Error("preview_expired");
            }
            if (request.current.plan !== plan.plan_id)
                request.current = {plan: plan.plan_id, id: crypto.randomUUID()};
            const next = {plan, request: request.current.id};
            setAttempt(next);
            client.setQueryData<DeletionAttempt[]>(
                deletionAttemptsQuery(actor).queryKey,
                (previous = []) => [
                    ...previous.filter(
                        (value) =>
                            value.plan.kind !== plan.kind || value.plan.id !== plan.id,
                    ),
                    next,
                ],
            );
            return confirmDeletion(plan, next.request);
        },
        onSuccess: async (result) => {
            await client.cancelQueries({
                queryKey: deletionReceiptsQuery(actor).queryKey,
            });
            setOperation(result);
            setAttempt(null);
            client.setQueryData<DeletionAttempt[]>(
                deletionAttemptsQuery(actor).queryKey,
                (previous = []) =>
                    previous.filter(
                        (value) =>
                            value.plan.kind !== result.kind || value.plan.id !== result.id,
                    ),
            );
            client.setQueryData<DeletionOperation[]>(
                deletionReceiptsQuery(actor).queryKey,
                (previous = []) => [
                    ...previous.filter(
                        (value) => value.operation_id !== result.operation_id,
                    ),
                    result,
                ],
            );
            if (result.status === "completed") await refreshAfterDeletion(client);
        },
        onError: (error) => {
            if (
                !operation &&
                error instanceof Error &&
                ["invalid_request", "deletion_conflict"].includes(error.message)
            ) {
                setAttempt(null);
                setRejected(true);
                client.setQueryData<DeletionAttempt[]>(
                    deletionAttemptsQuery(actor).queryKey,
                    (previous = []) =>
                        previous.filter(
                            (value) =>
                                value.plan.kind !== target.kind || value.plan.id !== target.id,
                        ),
                );
            }
            if (deletionDenied(error)) {
                setDenied(true);
                close();
                void client.invalidateQueries({
                    queryKey: ["deletions", "access", actor],
                });
            }
        },
    });
    useEffect(() => {
        if (preview.isError && deletionDenied(preview.error)) close();
    }, [preview.isError, preview.error, close]);
    if (denied) return null;
    const reload = async () => {
        setText("");
        setChecked(false);
        setExpired(false);
        setRejected(false);
        change.reset();
        await preview.refetch();
    };
    return (
        <Dialog
            open
            onOpenChange={(value) => {
                if (!value && !change.isPending) close();
            }}
            title={t("title")}
            description={t("irreversible")}
        >
            <div className="permanent-deletion-dialog">
                {operation ? (
                    <>
                        {operation.status === "pending" ? (
                            <p role="status" className="deletion-pending">
                                {t("pending")}
                            </p>
                        ) : (
                            <Notice
                                kind={operation.status === "failed" ? "error" : "success"}
                            >
                                {t(operation.status)}
                            </Notice>
                        )}
                        <p className="muted">
                            {t("operation", {id: operation.operation_id})}
                        </p>
                        {operation.status !== "completed" && (
                            <Button
                                type="button"
                                disabled={!online || change.isPending}
                                onClick={() => change.mutate()}
                            >
                                {t("resume")}
                            </Button>
                        )}
                    </>
                ) : attempt ? (
                    <>
                        <p role="status">{t("uncertain")}</p>
                        <Button
                            type="button"
                            disabled={!online || change.isPending}
                            onClick={() => change.mutate()}
                        >
                            {t("resume")}
                        </Button>
                    </>
                ) : preview.isPending || preview.isFetching ? (
                    <Loading/>
                ) : preview.isError ? (
                    <ErrorState retry={() => void reload()}/>
                ) : (
                    <>
                        <h3>{targetLabel(preview.data, t)}</h3>
                        <h4>{t("impact")}</h4>
                        <dl className="deletion-counts">
                            {Object.entries(preview.data.counts)
                                .filter(([, count]) => count > 0)
                                .map(([kind, count]) => (
                                    <div key={kind}>
                                        <dt>{resourceLabel(kind, t)}</dt>
                                        <dd>{count}</dd>
                                    </div>
                                ))}
                        </dl>
                        {preview.data.blockers.length > 0 && (
                            <Notice kind="error">
                                <strong>{t("blockers")}</strong>
                                <p>{t("blocked")}</p>
                                <ul>
                                    {preview.data.blockers.map((blocker, index) => (
                                        <li key={index}>
                                            {t("count", {
                                                name: resourceLabel(blocker.kind, t),
                                                count: blocker.count,
                                            })}
                                        </li>
                                    ))}
                                </ul>
                            </Notice>
                        )}
                        {preview.data.can_confirm && !preview.data.blockers.length && (
                            <>
                                <label className="deletion-ack">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={change.isPending}
                                        onChange={(event) => setChecked(event.target.checked)}
                                    />
                                    {t("acknowledge")}
                                </label>
                                <Field
                                    id="permanent-deletion-confirmation"
                                    label={t("typeDelete")}
                                >
                                    <input
                                        id="permanent-deletion-confirmation"
                                        autoComplete="off"
                                        value={text}
                                        disabled={change.isPending}
                                        onChange={(event) => setText(event.target.value)}
                                    />
                                </Field>
                                <Button
                                    type="button"
                                    variant="danger"
                                    disabled={
                                        !online ||
                                        !checked ||
                                        text !== "DELETE" ||
                                        change.isPending ||
                                        expired ||
                                        rejected
                                    }
                                    onClick={() => change.mutate()}
                                >
                                    {t("confirm")}
                                </Button>
                            </>
                        )}
                        {!preview.data.can_confirm && !preview.data.blockers.length && (
                            <Notice>{t("blocked")}</Notice>
                        )}
                        {expired && <Notice kind="error">{t("expires")}</Notice>}
                        {(expired || change.isError) && (
                            <Button
                                type="button"
                                variant="secondary"
                                disabled={!online || change.isPending}
                                onClick={() => void reload()}
                            >
                                {t("reload")}
                            </Button>
                        )}
                    </>
                )}
                {change.isError && !expired && (
                    <Notice kind="error">{t("error")}</Notice>
                )}
                <Button
                    type="button"
                    variant="secondary"
                    disabled={change.isPending}
                    onClick={close}
                >
                    {t("cancel")}
                </Button>
            </div>
        </Dialog>
    );
}

/** Bounded current-authority resource metadata list shared by administration and companies. */
function ResourceList({actor, kind}: { actor: string; kind: string }) {
    const {t} = useTranslation("deletions");
    const [search, setSearch] = useState("");
    const [cursor, setCursor] = useState<string | null>(null);
    const resources = useQuery(
        deletionResourcesQuery(actor, kind, search, cursor),
    );
    return (
        <section className="panel permanent-deletion-list">
            <Field id={`deletion-search-${kind}`} label={t("search")}>
                <input
                    id={`deletion-search-${kind}`}
                    type="search"
                    maxLength={120}
                    value={search}
                    onChange={(event) => {
                        setSearch(event.target.value);
                        setCursor(null);
                    }}
                />
            </Field>
            {resources.isPending ? (
                <Loading/>
            ) : resources.isError ? (
                <ErrorState retry={() => void resources.refetch()}/>
            ) : (
                <>
                    {resources.data.items.length ? (
                        <ul>
                            {resources.data.items.map((target) => (
                                <li key={`${target.kind}:${target.id}`}>
                                    <div>
                                        <strong>{targetLabel(target, t)}</strong>
                                        {target.owner_label && <small>{target.owner_label}</small>}
                                    </div>
                                    {target.can_delete ? (
                                        <PermanentDeleteAction {...target} />
                                    ) : (
                                        <span className="badge">{t("protected")}</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>{t("empty")}</p>
                    )}
                    <div className="form-actions">
                        {cursor && (
                            <Button variant="secondary" onClick={() => setCursor(null)}>
                                {t("previous")}
                            </Button>
                        )}
                        {resources.data.next_cursor && (
                            <Button
                                variant="secondary"
                                onClick={() => setCursor(resources.data.next_cursor)}
                            >
                                {t("next")}
                            </Button>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}

export function DeletionsPage() {
    const {session} = useAuth();
    const actor = session!.user.id;
    const {t} = useTranslation("deletions");
    const access = useQuery(deletionAccessQuery(actor));
    const [kind, setKind] = useState("");
    const selected = access.data?.kinds.includes(kind)
        ? kind
        : (access.data?.kinds[0] ?? "");
    return (
        <>
            <PageHeading title={t("title")} description={t("intro")}/>
            {access.isPending ? (
                <Loading/>
            ) : access.isError ? (
                <ErrorState retry={() => void access.refetch()}/>
            ) : !access.data.can_admin ? (
                <Notice>{t("denied")}</Notice>
            ) : (
                <>
                    <section className="panel">
                        <Field id="deletion-kind" label={t("kind")}>
                            <select
                                id="deletion-kind"
                                value={selected}
                                onChange={(event) => setKind(event.target.value)}
                            >
                                {access.data.kinds.map((value) => (
                                    <option key={value} value={value}>
                                        {resourceLabel(value, t)}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </section>
                    {selected && (
                        <ResourceList
                            key={`${actor}:${selected}`}
                            actor={actor}
                            kind={selected}
                        />
                    )}
                </>
            )}
        </>
    );
}

/** This projection grants company job metadata only, never staff job-detail/private-fee access. */
export function CompanyJobDeletions() {
    const {session} = useAuth();
    const actor = session!.user.id;
    const {t} = useTranslation("deletions");
    const access = useQuery(deletionAccessQuery(actor));
    if (
        access.isError ||
        !access.data ||
        access.data.can_admin ||
        !access.data.kinds.includes("job")
    )
        return null;
    return (
        <section>
            <h2>{t("ownJobs")}</h2>
            <p>{t("ownJobsHelp")}</p>
            <ResourceList key={actor} actor={actor} kind="job"/>
        </section>
    );
}