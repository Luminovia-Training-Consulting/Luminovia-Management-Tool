import {userRolesQuery} from "../../lib/queries";
import {DateTime} from "luxon";
import {useEffect, useRef, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Button} from "../../components/ui/button";
import {ErrorState, Field, Loading, Notice} from "../../components/common";
import {useOnline} from "../../lib/online";
import {dateTime, zonedInstant} from "../../lib/dates";
import {useAuth} from "../auth/auth-context";
import {saveQualificationEvidence} from "../files/api";
import {attestEvidence, type Certificate, certificatesQuery, type Cursor, qualificationDenied, qualificationHistoryQuery, qualificationKey, qualificationReviewQuery, saveEvidence,} from "./api";
import "./i18n";
import "./qualifications.css";

/** Retain the same idempotency key for a lost-response retry of an unchanged
 * command. Changing its payload creates a new command rather than reusing it. */
function useRequest() {
    const saved = useRef({body: "", id: ""});
    return (body: unknown) => {
        const serialized = JSON.stringify(body);
        if (saved.current.body !== serialized)
            saved.current = {body: serialized, id: crypto.randomUUID()};
        return saved.current.id;
    };
}

function Pager({
                   back,
                   next,
                   hasMore,
               }: {
    back?: () => void;
    next: () => void;
    hasMore: boolean;
}) {
    const {t} = useTranslation("qualifications");
    return (
        <div className="form-actions">
            <Button type="button" variant="ghost" onClick={back} disabled={!back}>
                {t("previous")}
            </Button>
            <Button type="button" variant="ghost" onClick={next} disabled={!hasMore}>
                {t("next")}
            </Button>
        </div>
    );
}

function CertificatePicker({
                               actor,
                               onSelect,
                               onDenied,
                           }: {
    actor: string;
    onSelect: (certificate: Certificate) => void;
    onDenied: (denied: boolean) => void;
}) {
    const {t, i18n} = useTranslation("qualifications");
    const [input, setInput] = useState("");
    const [search, setSearch] = useState("");
    const [cursors, setCursors] = useState<(Cursor | null)[]>([null]);
    const certificates = useQuery(
        certificatesQuery(actor, search, cursors.at(-1)!),
    );
    useEffect(() => {
        if (certificates.isError && qualificationDenied(certificates.error))
            onDenied(true);
    }, [certificates.isError, certificates.error, onDenied]);
    return (
        <section aria-label={t("choose")}>
            <Field id="qualification-certificate-search" label={t("search")}>
                <input
                    id="qualification-certificate-search"
                    value={input}
                    maxLength={160}
                    onChange={(event) => setInput(event.target.value)}
                />
            </Field>
            <Button
                type="button"
                variant="secondary"
                onClick={() => {
                    setSearch(input);
                    setCursors([null]);
                }}
            >
                {t("searchAction")}
            </Button>
            {certificates.isPending ? (
                <Loading/>
            ) : certificates.isError ? (
                <ErrorState retry={() => void certificates.refetch()}/>
            ) : (
                <>
                    <ul className="qualification-list">
                        {certificates.data.items.map((certificate) => (
                            <li key={certificate.version_id}>
                                <strong>{certificate.name}</strong>
                                <small>
                                    {t("version")} {certificate.version} ·{" "}
                                    {dateTime(certificate.created_at, i18n.language, "UTC")} UTC
                                </small>
                                <code>{certificate.sha256}</code>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => onSelect(certificate)}
                                    aria-label={`${t("select")}: ${certificate.name}, ${t("version")} ${certificate.version}`}
                                >
                                    {t("select")}
                                </Button>
                            </li>
                        ))}
                    </ul>
                    {!certificates.data.items.length && <p>{t("empty")}</p>}
                    <Pager
                        back={
                            cursors.length > 1
                                ? () => setCursors((value) => value.slice(0, -1))
                                : undefined
                        }
                        hasMore={certificates.data.has_more}
                        next={() => {
                            if (certificates.data.next_cursor)
                                setCursors((value) => [
                                    ...value,
                                    certificates.data.next_cursor,
                                ]);
                        }}
                    />
                </>
            )}
        </section>
    );
}

function History({
                     actor,
                     user,
                     topic,
                     onDenied,
                 }: {
    actor: string;
    user: string;
    topic: string;
    onDenied: (denied: boolean) => void;
}) {
    const {t, i18n} = useTranslation("qualifications");
    const [cursors, setCursors] = useState<(Cursor | null)[]>([null]);
    const history = useQuery(
        qualificationHistoryQuery(actor, user, topic, cursors.at(-1)!),
    );
    useEffect(() => {
        if (history.isError && qualificationDenied(history.error)) onDenied(true);
    }, [history.isError, history.error, onDenied]);
    if (history.isPending) return <Loading/>;
    if (history.isError)
        return <ErrorState retry={() => void history.refetch()}/>;
    return (
        <section aria-label={t("history")}>
            <h4>{t("history")}</h4>
            {!history.data.items.length ? (
                <p>{t("emptyHistory")}</p>
            ) : (
                <ol className="qualification-list">
                    {history.data.items.map((event) => (
                        <li key={event.id}>
                            <strong>
                                {t(
                                    event.action === "withdraw" ? "withdrawEvent" : event.action,
                                )}
                            </strong>
                            <span>
                {event.actor_name} ·{" "}
                                {dateTime(event.created_at, i18n.language, "UTC")} UTC
              </span>
                            {event.basis && (
                                <span>
                  {t(event.basis)} ·{" "}
                                    {t(event.verified ? "verified" : "revoked")}
                                    {event.valid_until &&
                                        ` · ${dateTime(event.valid_until, i18n.language, "UTC")} UTC`}
                </span>
                            )}
                        </li>
                    ))}
                </ol>
            )}
            <Pager
                back={
                    cursors.length > 1
                        ? () => setCursors((value) => value.slice(0, -1))
                        : undefined
                }
                hasMore={history.data.has_more}
                next={() => {
                    if (history.data.next_cursor)
                        setCursors((value) => [...value, history.data.next_cursor]);
                }}
            />
        </section>
    );
}

function EvidenceTopic({
                           actor,
                           user,
                           topic,
                           manage,
                           disabled = false,
                       }: {
    actor: string;
    user: string;
    topic: string;
    manage: boolean;
    disabled?: boolean;
}) {
    const {t, i18n} = useTranslation("qualifications");
    const online = useOnline();
    const client = useQueryClient();
    const request = useRequest();
    const record = useQuery({
        ...qualificationReviewQuery(actor, user, topic),
        enabled: online,
    });
    const [picker, setPicker] = useState(false);
    const [selected, setSelected] = useState<Certificate | null>(null);
    const [consent, setConsent] = useState(false);
    const [until, setUntil] = useState<string | null>(null);
    const [draft, setDraft] = useState<{
        version: number;
        evidenceId: string | null;
        validUntil: string | null;
    } | null>(null);
    const capture = () =>
        record.data
            ? {
                version: record.data.version,
                evidenceId: record.data.evidence?.id ?? null,
                validUntil: record.data.valid_until,
            }
            : null;
    const [denied, setDenied] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [downloadError, setDownloadError] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const change = useMutation({
        mutationFn: async (action: "bind" | "withdraw" | "attest") => {
            if (!record.data || denied) throw new Error("access_denied");
            const baseline = draft ? draft.validUntil : record.data.valid_until;
            const shown = baseline
                ? DateTime.fromISO(baseline).toUTC().toFormat("yyyy-MM-dd'T'HH:mm")
                : "";
            const input = until ?? shown;
            // Preserve the exact server instant when the minute-only editor is untouched.
            const expiry =
                until === null || until === shown
                    ? baseline
                    : input
                        ? zonedInstant(input, "UTC")
                        : null;
            const expected =
                action === "withdraw"
                    ? record.data.version
                    : (draft?.version ?? record.data.version);
            const evidenceId = draft
                ? draft.evidenceId
                : (record.data.evidence?.id ?? null);
            if (
                action === "attest" &&
                input &&
                (!expiry || new Date(expiry) <= new Date())
            )
                throw new Error("invalid_expiry");
            const version = action === "bind" ? (selected?.version_id ?? null) : null;
            if (action === "bind" && (!version || !consent))
                throw new Error("consent_required");
            const key = request([
                action,
                topic,
                version,
                expected,
                expiry,
                evidenceId,
            ]);
            if (action === "attest") {
                if (!evidenceId) throw new Error("access_denied");
                return attestEvidence(user, topic, evidenceId, expiry, expected, key);
            }
            return saveEvidence(topic, version, expected, key);
        },
        onSuccess: async () => {
            setDraft(null);
            setUntil(null);
            setPicker(false);
            setSelected(null);
            setConsent(false);
            await Promise.all([
                client.invalidateQueries({
                    queryKey: qualificationKey(actor, user, topic),
                }),
                client.invalidateQueries({queryKey: ["expertise", user]}),
                client.invalidateQueries({queryKey: ["admin-expertise", actor]}),
            ]);
        },
        onError: (error) => {
            if (qualificationDenied(error)) setDenied(true);
        },
    });
    if (!online) return <Notice kind="error">{t("offline")}</Notice>;
    if (record.isPending) return <Loading/>;
    if (record.isError || denied || !record.data)
        return (
            <>
                <Notice kind="error">{t("error")}</Notice>
                <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                        const result = await record.refetch();
                        if (!result.error) setDenied(false);
                    }}
                >
                    {t("reload")}
                </Button>
            </>
        );
    const evidence = record.data.evidence;
    return (
        <div className="qualification-evidence">
            {evidence ? (
                <section aria-label={t("title")}>
                    <strong>{evidence.name}</strong>
                    <small>
                        {dateTime(evidence.created_at, i18n.language, "UTC")} UTC
                    </small>
                    <code aria-label={t("hash")}>{evidence.sha256}</code>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={downloading}
                        onClick={async () => {
                            setDownloading(true);
                            setDownloadError(false);
                            try {
                                await saveQualificationEvidence(evidence.id, evidence.name);
                            } catch (error) {
                                setDownloadError(true);
                                if (qualificationDenied(error)) setDenied(true);
                            } finally {
                                setDownloading(false);
                            }
                        }}
                    >
                        {t("download")}
                    </Button>
                </section>
            ) : (
                <p>{t("none")}</p>
            )}
            {!manage && (
                <>
                    <p>{t("intro")}</p>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={change.isPending}
                        onClick={() => setPicker((value) => !value)}
                    >
                        {t("choose")}
                    </Button>
                    {picker && (
                        <CertificatePicker
                            actor={actor}
                            onDenied={setDenied}
                            onSelect={(certificate) => {
                                setDraft(capture());
                                setSelected(certificate);
                                setConsent(false);
                                change.reset();
                            }}
                        />
                    )}
                    {selected && (
                        <section aria-label={t("selected")}>
                            <strong>
                                {selected.name} · {t("version")} {selected.version}
                            </strong>
                            <code>{selected.sha256}</code>
                            <label className="checkbox-field">
                                <input
                                    type="checkbox"
                                    checked={consent}
                                    onChange={(event) => setConsent(event.target.checked)}
                                />
                                {t("consent")}
                            </label>
                            <Button
                                type="button"
                                disabled={!consent || change.isPending}
                                onClick={() => change.mutate("bind")}
                            >
                                {t("save")}
                            </Button>
                        </section>
                    )}
                    {evidence && (
                        <>
                            <p>{t("withdrawHint")}</p>
                            <Button
                                type="button"
                                variant="secondary"
                                disabled={change.isPending}
                                onClick={() => change.mutate("withdraw")}
                            >
                                {t("withdraw")}
                            </Button>
                        </>
                    )}
                </>
            )}
            {manage && evidence && (
                <>
                    <Field
                        id={`qualification-expiry-${user}-${topic}`}
                        label={t("expiry")}
                        hint={t("expiryHint")}
                    >
                        <input
                            id={`qualification-expiry-${user}-${topic}`}
                            type="datetime-local"
                            value={
                                until ??
                                (record.data.valid_until
                                    ? DateTime.fromISO(record.data.valid_until)
                                        .toUTC()
                                        .toFormat("yyyy-MM-dd'T'HH:mm")
                                    : "")
                            }
                            disabled={disabled || change.isPending}
                            onChange={(event) => {
                                if (!draft) setDraft(capture());
                                setUntil(event.target.value);
                                change.reset();
                            }}
                        />
                    </Field>
                    <Button
                        type="button"
                        disabled={disabled || change.isPending}
                        onClick={() => change.mutate("attest")}
                    >
                        {t("review")}
                    </Button>
                </>
            )}
            {change.isSuccess && <Notice>{t(manage ? "attested" : "saved")}</Notice>}
            {change.isError && (
                <Notice kind="error">
                    {t(
                        change.error.message === "invalid_expiry"
                            ? "invalidExpiry"
                            : "failed",
                    )}
                </Notice>
            )}
            {change.isError && (
                <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                        const fresh = await record.refetch();
                        if (fresh.data && !fresh.error)
                            setDraft({
                                version: fresh.data.version,
                                evidenceId: fresh.data.evidence?.id ?? null,
                                validUntil: fresh.data.valid_until,
                            });
                    }}
                >
                    {t("reload")}
                </Button>
            )}
            {downloadError && <Notice kind="error">{t("error")}</Notice>}
            <Button
                type="button"
                variant="ghost"
                aria-expanded={showHistory}
                onClick={() => setShowHistory((value) => !value)}
            >
                {t("history")}
            </Button>
            {showHistory && (
                <History actor={actor} user={user} topic={topic} onDenied={setDenied}/>
            )}
        </div>
    );
}

export function QualificationEvidenceReview({
                                                userId,
                                                topicId,
                                                disabled,
                                            }: {
    userId: string;
    topicId: string;
    disabled: boolean;
}) {
    const {t} = useTranslation("qualifications");
    const {session} = useAuth();
    const [open, setOpen] = useState(false);
    const actor = session?.user.id ?? "";
    return (
        <section>
            <Button
                type="button"
                variant="ghost"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            >
                {t(open ? "close" : "open")}
            </Button>
            {open && actor && (
                <EvidenceTopic
                    key={`${actor}-${userId}-${topicId}`}
                    actor={actor}
                    user={userId}
                    topic={topicId}
                    manage
                    disabled={disabled}
                />
            )}
        </section>
    );
}

export function OwnQualificationEvidence({
                                             topics,
                                         }: {
    topics: { id: string; label_de: string; label_en: string }[];
}) {
    const {t, i18n} = useTranslation("qualifications");
    const {session} = useAuth();
    const [topic, setTopic] = useState("");
    const actor = session?.user.id ?? "";
    // Reuse the Shell's actor-scoped role cache and its refresh lifecycle. This
    // observer adds no polling timer or extra fetch when the Shell has the roles.
    const roles = useQuery({
        ...userRolesQuery(actor),
        enabled: Boolean(actor),
        refetchInterval: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });
    if (
        roles.isPending ||
        roles.isError ||
        !roles.data?.some((role) =>
            ["lecturer", "senior_lecturer", "admin", "owner"].includes(role),
        )
    )
        return null;
    return (
        <section className="panel">
            <h2>{t("title")}</h2>
            <p>{t("intro")}</p>
            {topics.length ? (
                <Field id="qualification-topic" label={t("topic")}>
                    <select
                        id="qualification-topic"
                        value={topic}
                        onChange={(event) => setTopic(event.target.value)}
                    >
                        <option value="">{t("chooseTopic")}</option>
                        {topics.map((value) => (
                            <option key={value.id} value={value.id}>
                                {i18n.language === "de" ? value.label_de : value.label_en}
                            </option>
                        ))}
                    </select>
                </Field>
            ) : (
                <p>{t("noTopics")}</p>
            )}
            {topic && topics.some((value) => value.id === topic) && actor && (
                <EvidenceTopic
                    key={`${actor}-${topic}`}
                    actor={actor}
                    user={actor}
                    topic={topic}
                    manage={false}
                />
            )}
        </section>
    );
}