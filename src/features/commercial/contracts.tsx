/**
 * Register executed contract PDFs, view own versions and acknowledge receipt. Contracts
 * reference exact clean versions; acknowledgement is not an electronic signature.
 */
import { useRequestKey } from "../../lib/request-key";
import { useSearchParams } from "react-router-dom";
import { lazy, Suspense, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { CheckCircle2, Download, FileSignature, Plus } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { hasTeachingRole } from "../auth/internal-capabilities";
import { saveDownload } from "../files/api";
import { db } from "../../lib/supabase";
import { profileQuery, userRolesQuery } from "../../lib/queries";
import { PageNotFound } from "../../components/page-not-found";
import { dateTime, zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
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
  commercialAccessQuery,
  commercialKeys,
  commercialPeopleQuery,
  contractsQuery,
} from "./api";
import type { ContractRecord } from "./types";
import { FinanceRows } from "./finance-rows";
import { CommercialPdfUpload } from "./pdf-upload";
import "./i18n";
import "./commercial.css";

const SubjectDocuments = lazy(() =>
  import("../files/files").then(({ SubjectDocuments }) => ({
    default: SubjectDocuments,
  })),
);

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
  user: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["master", "addendum"]),
  parent: z.string(),
  effective: z.string().min(1),
  expires: z.string(),
});

/** Register contract metadata against an already confirmed clean PDF version. */
function RegisterContract({
  actor,
  zone,
  initialUser = "",
  boundUser,
  onDone,
}: {
  actor: string;
  zone: string;
  initialUser?: string;
  boundUser?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("commercial");
  const online = useOnline();
  const client = useQueryClient();
  const people = useQuery({
    ...commercialPeopleQuery(actor),
    enabled: !boundUser,
  });
  const [document, setDocument] = useState("");
  const [invalidDates, setInvalidDates] = useState(false);
  const [initialDate] = useState(() =>
    DateTime.now().setZone(zone).startOf("day").toFormat("yyyy-MM-dd'T'HH:mm"),
  );
  const retry = useRequestKey();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      user: boundUser ?? initialUser,
      title: "",
      kind: "master",
      parent: "",
      effective: initialDate,
      expires: "",
    },
  });
  // Contextual callers already checked eligibility. The fixed ID also owns upload and registration.
  const chosenUser = useWatch({ control: form.control, name: "user" });
  const person = boundUser ?? chosenUser;
  const eligiblePerson =
    Boolean(boundUser) ||
    (people.isSuccess && people.data.some(({ id }) => id === person));
  const kind = useWatch({ control: form.control, name: "kind" });
  const parent = useWatch({ control: form.control, name: "parent" });
  const previousContracts = useQuery({
    ...contractsQuery(actor, true, person),
    enabled: kind === "addendum" && eligiblePerson,
  });
  const parentOptions = (previousContracts.data ?? []).filter(
    (record) =>
      record.user_id === person && Boolean(record.document_version_id),
  );
  const currentParent = (id: string) =>
    previousContracts.isSuccess &&
    parentOptions.some((record) => record.id === id);
  const candidates = useQuery({
    queryKey: ["contract-registration-candidates", actor, person],
    enabled: eligiblePerson,
    queryFn: async () => {
      const { data, error } = await db().rpc(
        "contract_registration_candidates",
        { p_user_id: person },
      );
      if (error) throw error;
      return (data ?? []) as { version_id: string; file_name: string }[];
    },
  });
  const save = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      requireOnline();
      setInvalidDates(false);
      const effective = zonedInstant(values.effective, zone);
      const expires = values.expires
        ? zonedInstant(values.expires, zone)
        : null;
      if (
        !effective ||
        (values.expires && (!expires || expires <= effective))
      ) {
        setInvalidDates(true);
        throw new Error("invalid_date");
      }
      if (
        !eligiblePerson ||
        !document ||
        (values.kind === "addendum" && !currentParent(values.parent))
      )
        throw new Error("document_required");
      const payload = {
        p_user_id: boundUser ?? values.user,
        p_title: values.title,
        p_document_version_id: document,
        p_effective_from: effective,
        p_expires_at: expires,
        p_kind: values.kind,
        p_parent_id: values.kind === "addendum" ? values.parent : null,
      };
      const signature = JSON.stringify(payload);
      const retryId = retry.forInput(signature);
      const { data, error } = await db().rpc("register_executed_contract", {
        ...payload,
        p_client_id: retryId,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: commercialKeys.contracts(actor),
      });
      onDone();
    },
  });
  if (!boundUser && people.isPending) return <Loading />;
  if (!boundUser && people.isError)
    return <ErrorState retry={() => void people.refetch()} />;
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
    >
      {!boundUser && (
        <Field
          id="contract-person"
          label={t("person")}
          error={Boolean(form.formState.errors.user)}
        >
          <select
            id="contract-person"
            {...form.register("user", {
              onChange: () => {
                setDocument("");
                form.setValue("parent", "");
              },
            })}
            disabled={save.isPending}
          >
            <option value="">{t("selectPerson")}</option>
            {people.data?.map((person) => (
              <option key={person.id} value={person.id}>
                {person.display_name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field
        id="contract-title"
        label={t("title")}
        error={Boolean(form.formState.errors.title)}
      >
        <input
          id="contract-title"
          {...form.register("title")}
          maxLength={200}
          disabled={save.isPending}
        />
      </Field>
      <Field id="contract-kind" label={t("kind")}>
        <select
          id="contract-kind"
          {...form.register("kind")}
          disabled={save.isPending}
        >
          <option value="master">{t("master")}</option>
          <option value="addendum">{t("addendum")}</option>
        </select>
      </Field>
      {kind === "addendum" && (
        <>
          <Field id="contract-parent" label={t("parent")}>
            <select
              id="contract-parent"
              {...form.register("parent")}
              disabled={!previousContracts.isSuccess || save.isPending}
            >
              <option value="">{t("selectParent")}</option>
              {parentOptions.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.title} · {t("version", { version: record.version })}
                </option>
              ))}
            </select>
          </Field>
          {previousContracts.isError && (
            <ErrorState retry={() => void previousContracts.refetch()} />
          )}
        </>
      )}
      <div className="form-row">
        <Field
          id="contract-effective"
          label={`${t("effective")} (${zone})`}
          error={Boolean(form.formState.errors.effective)}
        >
          <input
            id="contract-effective"
            type="datetime-local"
            {...form.register("effective")}
            disabled={save.isPending}
          />
        </Field>
        <Field
          id="contract-expires"
          label={`${t("expires")} (${zone})`}
          hint={t("noExpiry")}
        >
          <input
            id="contract-expires"
            type="datetime-local"
            {...form.register("expires")}
            disabled={save.isPending}
          />
        </Field>
      </div>
      {eligiblePerson && (
        <CommercialPdfUpload
          key={person}
          kind="contract"
          ownerId={person}
          label={t("contractPdf")}
          disabled={!online || save.isPending}
          onDocument={(uploaded) =>
            setDocument(uploaded?.current_version_id ?? "")
          }
        />
      )}
      <Field
        id="contract-candidate"
        label={t("contractCandidate")}
        hint={t("contractCandidateHint")}
      >
        <select
          id="contract-candidate"
          value={document}
          onChange={(event) => setDocument(event.target.value)}
          disabled={
            !person ||
            candidates.isPending ||
            candidates.isError ||
            save.isPending
          }
        >
          <option value="">{t("selectContractCandidate")}</option>
          {candidates.data?.map((candidate) => (
            <option key={candidate.version_id} value={candidate.version_id}>
              {candidate.file_name}
            </option>
          ))}
        </select>
      </Field>
      {candidates.isError && <Notice kind="error">{t("failed")}</Notice>}
      <div className="form-actions">
        <Button
          disabled={
            !online ||
            save.isPending ||
            !eligiblePerson ||
            !document ||
            (kind === "addendum" && !currentParent(parent))
          }
        >
          {t("registerSave")}
        </Button>
      </div>
      {save.isError && (
        <Notice kind="error">
          {t(invalidDates ? "dateInvalid" : "failed")}
        </Notice>
      )}
    </form>
  );
}

/** Display an exact registered version; management of metadata is not file access. */
function ContractCard({
  actor,
  contract,
  zone,
  manager,
  delegatedDownload,
}: {
  actor: string;
  contract: ContractRecord;
  zone: string;
  manager: boolean;
  delegatedDownload: boolean;
}) {
  const { t, i18n } = useTranslation("commercial");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const own = contract.user_id === actor;
  const { document_id: documentId, document_version_id: versionId } = contract;
  const canDownload = own || delegatedDownload;
  const key = useRef(crypto.randomUUID());
  const acknowledge = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!checked || !contract.sha256)
        throw new Error("receipt_not_confirmed");
      const { error } = await db().rpc("acknowledge_contract", {
        p_contract_id: contract.id,
        p_sha256: contract.sha256,
        p_client_id: key.current,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: commercialKeys.contracts(actor) }),
  });
  const status = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("set_contract_status", {
        p_contract_id: contract.id,
        p_status: contract.status === "active" ? "expired" : "active",
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: commercialKeys.contracts(actor),
      });
      setStatusOpen(false);
    },
  });
  return (
    <article className="panel commercial-contract-card">
      <div className="commercial-card-heading">
        <span className="commercial-document-icon" aria-hidden="true">
          <FileSignature size={23} />
        </span>
        <div>
          <span className="eyebrow">
            {t(contract.kind)} · {t("version", { version: contract.version })}
          </span>
          <h2>{contract.title}</h2>
          {manager && <p>{contract.user_name}</p>}
        </div>
        <span className={`badge commercial-status-${contract.status}`}>
          {t(contract.status)}
        </span>
      </div>
      <dl className="commercial-facts">
        <dt>{t("effective")}</dt>
        <dd>{dateTime(contract.effective_from, i18n.language, zone)}</dd>
        <dt>{t("expires")}</dt>
        <dd>
          {contract.expires_at
            ? dateTime(contract.expires_at, i18n.language, zone)
            : t("noExpiry")}
        </dd>
      </dl>
      {contract.sha256 && (
        <details className="commercial-checksum">
          <summary>{t("checksum")}</summary>
          <code>{contract.sha256}</code>
        </details>
      )}
      <div className="form-actions">
        <Button
          variant="secondary"
          disabled={
            !canDownload || !online || busy || !documentId || !versionId
          }
          onClick={async () => {
            if (!canDownload || !documentId || !versionId) return;
            setBusy(true);
            setDownloadFailed(false);
            try {
              await saveDownload(
                documentId,
                `${contract.title}.pdf`,
                versionId,
              );
            } catch {
              setDownloadFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={16} />
          {t("download")}
        </Button>
        {manager && (
          <Button
            variant="ghost"
            disabled={!online}
            onClick={() => {
              status.reset();
              setStatusOpen(true);
            }}
          >
            {t(contract.status === "active" ? "setExpired" : "setActive")}
          </Button>
        )}
      </div>
      {!contract.document_id && (
        <p className="muted commercial-small">{t("noDocument")}</p>
      )}
      {own && contract.sha256 && contract.document_version_id && (
        <div className="commercial-receipt">
          {contract.acknowledged_at ? (
            <p>
              <CheckCircle2 size={17} />
              {t("acknowledged", {
                date: dateTime(contract.acknowledged_at, i18n.language, zone),
              })}
            </p>
          ) : (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                  disabled={acknowledge.isPending}
                />
                {t("acknowledgeLabel")}
              </label>
              <small>{t("acknowledgeHint")}</small>
              <Button
                variant="secondary"
                disabled={!online || !checked || acknowledge.isPending}
                onClick={() => acknowledge.mutate()}
              >
                {t("acknowledge")}
              </Button>
            </>
          )}
        </div>
      )}
      {(downloadFailed || acknowledge.isError) && (
        <Notice kind="error">{t("failed")}</Notice>
      )}
      <Dialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title={t("statusConfirm")}
        description={t("statusHint", { title: contract.title })}
      >
        <div className="form-actions">
          <Button
            variant="secondary"
            onClick={() => setStatusOpen(false)}
            disabled={status.isPending}
          >
            {common("cancel")}
          </Button>
          <Button
            disabled={!online || status.isPending}
            onClick={() => status.mutate()}
          >
            {t(contract.status === "active" ? "setExpired" : "setActive")}
          </Button>
        </div>
        {status.isError && <Notice kind="error">{t("failed")}</Notice>}
      </Dialog>
    </article>
  );
}

/** Render the same contract and status cards in the personal and lecturer contexts. */
function ContractCards({
  actor,
  records,
  zone,
  manager,
  checkDelegatedDownload,
}: {
  actor: string;
  records: ContractRecord[];
  zone: string;
  manager: boolean;
  checkDelegatedDownload?: boolean;
}) {
  const { t } = useTranslation("commercial");
  const canCheck = manager && checkDelegatedDownload;
  const versionIds = canCheck
    ? [
        ...new Set(
          records.flatMap((record) =>
            record.user_id !== actor &&
            record.document_version_id &&
            record.document_id
              ? [record.document_version_id]
              : [],
          ),
        ),
      ].sort()
    : [];
  const delegatedVersions = useQuery({
    queryKey: ["contract-download-versions", actor, versionIds],
    enabled: versionIds.length > 0,
    queryFn: async ({ signal }) => {
      // Keep each RLS-scoped request within a bounded URL and REST response size.
      // Match both returned IDs below; the file gateway still checks current access.
      const allowed = new Map<string, string>();
      const batchSize = 50;
      for (let from = 0; from < versionIds.length; from += batchSize) {
        const { data, error } = await db()
          .from("document_versions")
          .select("id,document_id")
          .in("id", versionIds.slice(from, from + batchSize))
          .eq("status", "clean")
          .eq("mime_type", "application/pdf")
          .abortSignal(signal);
        if (error) throw error;
        for (const row of data ?? []) allowed.set(row.id, row.document_id);
      }
      return allowed;
    },
  });
  return records.length ? (
    <FinanceRows label={t("contracts")} total={records.length} scroll={false}>
      {(shown) => (
        <div className="commercial-contract-grid">
          {records.slice(0, shown).map((contract) => (
            <ContractCard
              key={contract.id}
              actor={actor}
              contract={contract}
              zone={zone}
              manager={manager}
              delegatedDownload={Boolean(
                canCheck &&
                delegatedVersions.isSuccess &&
                contract.document_version_id &&
                contract.document_id &&
                delegatedVersions.data.get(contract.document_version_id) ===
                  contract.document_id,
              )}
            />
          ))}
        </div>
      )}
    </FinanceRows>
  ) : (
    <div className="panel commercial-empty">
      <FileSignature size={35} />
      <p>{t("noContracts")}</p>
    </div>
  );
}

/** Manage an eligible lecturer only. The person action mounts this after the commercial access checks. */
export function LecturerContracts({
  actor,
  lecturer,
}: {
  actor: string;
  lecturer: string;
}) {
  const { t } = useTranslation("commercial");
  const profile = useQuery(profileQuery(actor));
  const records = useQuery(contractsQuery(actor, true, lecturer));
  const [registering, setRegistering] = useState(false);
  const zone = profile.data?.time_zone ?? "Europe/Berlin";
  if (records.isPending) return <Loading />;
  if (records.isError)
    return <ErrorState retry={() => void records.refetch()} />;
  return (
    <div className="section-stack">
      <div className="form-actions">
        <Button type="button" onClick={() => setRegistering(true)}>
          <Plus size={17} />
          {t("register")}
        </Button>
      </div>
      <ContractCards
        actor={actor}
        records={records.data}
        zone={zone}
        manager
        checkDelegatedDownload
      />
      <Dialog
        open={registering}
        onOpenChange={setRegistering}
        title={t("register")}
        description={t("registerHint")}
      >
        <RegisterContract
          actor={actor}
          zone={zone}
          boundUser={lecturer}
          onDone={() => setRegistering(false)}
        />
      </Dialog>
    </div>
  );
}

/** Choose own or permitted administrative contract views using commercial capabilities. */
export function ContractsPage({ scope }: { scope: "personal" | "staff" }) {
  const { t } = useTranslation("commercial");
  const { session } = useAuth();
  const actor = session!.user.id;
  const staff = scope === "staff";
  const access = useQuery({ ...commercialAccessQuery(actor), enabled: staff });
  const roles = useQuery({ ...userRolesQuery(actor), enabled: !staff });
  const profile = useQuery(profileQuery(actor));
  const [params, setParams] = useSearchParams();
  const [all, setAll] = useState(true);
  const target = params.get("user") ?? "";
  const manager = staff && access.isSuccess && access.data.can_manage_contracts;
  const selectedUser =
    manager && z.string().uuid().safeParse(target).success ? target : "";
  const effectiveAll = manager && (all || Boolean(selectedUser));
  const records = useQuery({
    ...contractsQuery(actor, effectiveAll, selectedUser || undefined),
    enabled: !staff || manager,
  });
  const [registering, setRegistering] = useState(false);
  const [search, setSearch] = useState("");
  const term = search.toLocaleLowerCase();
  const filtered = term
    ? (records.data?.filter((record) =>
        `${record.title} ${record.user_name}`
          .toLocaleLowerCase()
          .includes(term),
      ) ?? [])
    : (records.data ?? []);
  if (staff) {
    if (access.isPending) return <Loading />;
    if (access.isError)
      return <ErrorState retry={() => void access.refetch()} />;
    if (!manager) return <PageNotFound />;
  }
  return (
    <>
      <PageHeading
        title={t("contracts")}
        description={t(staff ? "adminContractsIntro" : "contractsIntro")}
        action={
          manager && (
            <Button onClick={() => setRegistering(true)}>
              <Plus size={17} />
              {t("register")}
            </Button>
          )
        }
      />
      <div className="section-stack">
        {!staff &&
          (roles.isError ? (
            <ErrorState retry={() => void roles.refetch()} />
          ) : hasTeachingRole(roles.data) ? (
            <section
              aria-labelledby="own-contract-files"
              className="section-stack"
            >
              <div className="panel form-stack">
                <h2 id="own-contract-files">{t("ownContractFiles")}</h2>
                <p>{t("ownContractFilesIntro")}</p>
                <CommercialPdfUpload
                  key={actor}
                  kind="contract"
                  ownerId={actor}
                  expectedActor={actor}
                  label={t("ownContractUpload")}
                />
              </div>
              <Suspense fallback={<Loading />}>
                <SubjectDocuments ownerId={actor} kind="contract" />
              </Suspense>
            </section>
          ) : null)}
        <div className="panel contract-toolbar">
          <Field id="contract-search" label={t("contracts")}>
            <input
              id="contract-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          {selectedUser ? (
            <Button
              variant="secondary"
              onClick={() => {
                setAll(true);
                setParams((current) => {
                  current.delete("user");
                  return current;
                });
              }}
            >
              {t("allPeople")}
            </Button>
          ) : (
            manager && (
              <label className="checkbox-label contract-scope">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(event) => setAll(event.target.checked)}
                />
                {t("allPeople")}
              </label>
            )
          )}
        </div>
        {records.isPending ? (
          <Loading />
        ) : records.isError ? (
          <ErrorState retry={() => void records.refetch()} />
        ) : (
          <ContractCards
            actor={actor}
            records={filtered}
            zone={profile.data?.time_zone ?? "Europe/Berlin"}
            manager={effectiveAll}
          />
        )}
      </div>
      <Dialog
        open={registering}
        onOpenChange={setRegistering}
        title={t("register")}
        description={t("registerHint")}
      >
        {manager && (
          <RegisterContract
            key={`${actor}:${selectedUser}`}
            actor={actor}
            zone={profile.data?.time_zone ?? "Europe/Berlin"}
            initialUser={selectedUser}
            onDone={() => setRegistering(false)}
          />
        )}
      </Dialog>
    </>
  );
}
