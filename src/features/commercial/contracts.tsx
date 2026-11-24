/**
 * Register executed contract PDFs, view own versions and acknowledge receipt. Contracts
 * reference exact clean versions; acknowledgement is not an electronic signature.
 */
import { useRequestKey } from "../../lib/request-key";
import { useSearchParams } from "react-router-dom";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { CheckCircle2, Download, FileSignature, Plus } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { saveDownload } from "../files/api";
import { db } from "../../lib/supabase";
import { profileQuery } from "../../lib/queries";
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
import { CommercialPdfUpload } from "./pdf-upload";
import "./i18n";
import "./commercial.css";

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
  records,
  initialUser,
  onDone,
}: {
  actor: string;
  zone: string;
  records: ContractRecord[];
  initialUser: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("commercial");
  const online = useOnline();
  const client = useQueryClient();
  const people = useQuery(commercialPeopleQuery(actor));
  const [document, setDocument] = useState("");
  const [invalidDates, setInvalidDates] = useState(false);
  const [initialDate] = useState(() =>
    DateTime.now().setZone(zone).startOf("day").toFormat("yyyy-MM-dd'T'HH:mm"),
  );
  const retry = useRequestKey();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      user: initialUser,
      title: "",
      kind: "master",
      parent: "",
      effective: initialDate,
      expires: "",
    },
  });
  const person = useWatch({ control: form.control, name: "user" });
  const eligiblePerson = people.data?.some(({ id }) => id === person) === true;
  const kind = useWatch({ control: form.control, name: "kind" });
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
        (values.kind === "addendum" && !values.parent)
      )
        throw new Error("document_required");
      const payload = {
        p_user_id: values.user,
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
  if (people.isPending) return <Loading />;
  if (people.isError) return <ErrorState retry={() => void people.refetch()} />;
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
    >
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
          {people.data.map((person) => (
            <option key={person.id} value={person.id}>
              {person.display_name}
            </option>
          ))}
        </select>
      </Field>
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
        <Field id="contract-parent" label={t("parent")}>
          <select
            id="contract-parent"
            {...form.register("parent")}
            disabled={save.isPending}
          >
            <option value="">{t("selectParent")}</option>
            {records
              .filter(
                (record) =>
                  record.user_id === person &&
                  Boolean(record.document_version_id),
              )
              .map((record) => (
                <option key={record.id} value={record.id}>
                  {record.title} · {t("version", { version: record.version })}
                </option>
              ))}
          </select>
        </Field>
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
          disabled={!online || save.isPending || !eligiblePerson || !document}
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

/** Display contract version/validity and perform an explicit receipt acknowledgement. */
function ContractCard({
  actor,
  contract,
  zone,
  manager,
}: {
  actor: string;
  contract: ContractRecord;
  zone: string;
  manager: boolean;
}) {
  const { t, i18n } = useTranslation("commercial");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
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
            contract.user_id !== actor ||
            !online ||
            busy ||
            !contract.document_id ||
            !contract.document_version_id
          }
          onClick={async () => {
            setBusy(true);
            setDownloadFailed(false);
            try {
              await saveDownload(
                contract.document_id!,
                `${contract.title}.pdf`,
                contract.document_version_id!,
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
      {contract.user_id === actor &&
        contract.sha256 &&
        contract.document_version_id && (
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

/** Choose own or permitted administrative contract views using commercial capabilities. */
export function ContractsPage() {
  const { t } = useTranslation("commercial");
  const { session } = useAuth();
  const actor = session!.user.id;
  const access = useQuery(commercialAccessQuery(actor));
  const profile = useQuery(profileQuery(actor));
  const [params, setParams] = useSearchParams();
  const [all, setAll] = useState(false);
  const target = params.get("user") ?? "";
  const manager = access.data?.can_manage_contracts ?? false;
  const selectedUser =
    manager && z.string().uuid().safeParse(target).success ? target : "";
  const effectiveAll = manager && (all || Boolean(selectedUser));
  const records = useQuery({
    ...contractsQuery(actor, effectiveAll),
    enabled: !access.isPending,
  });
  const allRecords = useQuery({
    ...contractsQuery(actor, true),
    enabled: manager,
  });
  const [registering, setRegistering] = useState(false);
  const [search, setSearch] = useState("");
  const filtered =
    records.data?.filter(
      (record) =>
        (!selectedUser || record.user_id === selectedUser) &&
        `${record.title} ${record.user_name}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    ) ?? [];
  return (
    <>
      <PageHeading
        title={t("contracts")}
        description={t("contractsIntro")}
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
        {!selectedUser && (
          <section className="panel">
            <p>{t("ownContractUploadHint")}</p>
            <CommercialPdfUpload
              kind="contract"
              ownerId={actor}
              label={t("contractPdf")}
            />
          </section>
        )}
        {access.isPending || records.isPending ? (
          <Loading />
        ) : access.isError || records.isError ? (
          <ErrorState
            retry={() => {
              void access.refetch();
              void records.refetch();
            }}
          />
        ) : filtered.length ? (
          <div className="commercial-contract-grid">
            {filtered.map((contract) => (
              <ContractCard
                key={contract.id}
                actor={actor}
                contract={contract}
                zone={profile.data?.time_zone ?? "Europe/Berlin"}
                manager={effectiveAll}
              />
            ))}
          </div>
        ) : (
          <div className="panel commercial-empty">
            <FileSignature size={35} />
            <p>{t("noContracts")}</p>
          </div>
        )}
      </div>
      <Dialog
        open={registering}
        onOpenChange={setRegistering}
        title={t("register")}
        description={t("registerHint")}
      >
        {manager &&
          (allRecords.isPending ? (
            <Loading />
          ) : allRecords.isError ? (
            <ErrorState retry={() => void allRecords.refetch()} />
          ) : (
            <RegisterContract
              actor={actor}
              zone={profile.data?.time_zone ?? "Europe/Berlin"}
              records={allRecords.data ?? []}
              initialUser={selectedUser}
              onDone={() => setRegistering(false)}
            />
          ))}
      </Dialog>
    </>
  );
}
