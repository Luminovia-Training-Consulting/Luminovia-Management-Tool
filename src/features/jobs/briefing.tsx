/**
 * Optional authored job references and explicitly shared contacts. Editing freezes the
 * reviewed version; only explicit reload replaces a draft, and errors hide retained reads.
 */
import { useRequestKey } from "../../lib/request-key";
import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field, Loading, Notice } from "../../components/common";
import {
  briefingDenied,
  briefingKey,
  briefingQuery,
  briefingValues,
  type BriefingValues,
  briefingValuesSchema,
  briefingWebUrl,
  type JobBriefingData,
  saveBriefing,
} from "./briefing-api";
import "./briefing-i18n";
import "./briefing.css";

/** Actor/job changes remount all local drafts and uncertain-write identities. */
export function JobBriefing({
  jobId,
  managementHint = false,
  archived = false,
}: {
  jobId: string;
  managementHint?: boolean;
  archived?: boolean;
}) {
  const { session } = useAuth();
  return (
    <BriefingContent
      key={`${session!.user.id}:${jobId}`}
      actor={session!.user.id}
      jobId={jobId}
      managementHint={managementHint}
      archived={archived}
    />
  );
}

/** Select a safe dial destination while preserving the author's full phone text for display. */
function phoneHref(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, "");
  return digits
    ? `tel:${phone.trim().startsWith("+") ? "+" : ""}${digits}`
    : undefined;
}

/** Read one current server projection and keep a deliberate editing snapshot independent of refetches. */
function BriefingContent({
  actor,
  jobId,
  managementHint,
  archived,
}: {
  actor: string;
  jobId: string;
  managementHint: boolean;
  archived: boolean;
}) {
  const { t } = useTranslation("jobBriefing");
  const client = useQueryClient();
  const online = useOnline();
  const query = useQuery(briefingQuery(actor, jobId));
  const [draft, setDraft] = useState<{
    version: number;
    values: BriefingValues;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const request = useRequestKey();
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("missing_draft");
      const signature = JSON.stringify([jobId, draft.version, draft.values]);
      const requestId = request.forInput(signature);
      return saveBriefing(jobId, draft.version, requestId, draft.values);
    },
    onError: (error) => {
      // A write denial is fresh authorization evidence; close the private draft
      // immediately instead of waiting for the next periodic read.
      if (briefingDenied(error)) setDraft(null);
    },
    onSuccess: async (confirmed) => {
      client.setQueryData(briefingKey(actor, jobId), confirmed);
      request.clear();
      setDraft(null);
      setSaved(true);
      await client.invalidateQueries({
        queryKey: briefingKey(actor, jobId),
        exact: true,
      });
    },
  });
  const reload = useMutation({
    mutationFn: async () => {
      if (!online) throw new Error("offline");
      const response = await query.refetch();
      if (response.error) throw response.error;
      if (!response.data) throw new Error("unconfirmed_read");
      return response.data;
    },
    onSuccess: (current) => {
      setDraft({ version: current.version, values: briefingValues(current) });
      request.clear();
      save.reset();
    },
  });
  const deniedNotice = <Notice kind="error">{t("permissionRequired")}</Notice>;
  // React Query may retain the previous success after a failed refresh. Do not render
  // those private contacts or an open editing draft once a current read has failed.
  if (query.isError || briefingDenied(save.error))
    return (
      <section
        id="job-briefing"
        className="panel job-briefing"
        aria-label={t("title")}
      >
        <h2>{t("title")}</h2>
        {managementHint &&
        (briefingDenied(query.error) || briefingDenied(save.error)) ? (
          deniedNotice
        ) : (
          <Notice kind="error">{t("loadError")}</Notice>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={!online || query.isFetching}
          onClick={() => {
            void query.refetch().then((result) => {
              if (!result.error) save.reset();
            });
          }}
        >
          {t("retry")}
        </Button>
      </section>
    );
  if (query.isPending) return managementHint ? <Loading /> : null;
  const current = query.data;
  const href = briefingWebUrl(current.reference_url);
  const hasReference = Boolean(
    href || current.reference_label || current.reference_description,
  );
  if (
    !hasReference &&
    !current.has_contact &&
    !current.can_manage &&
    !managementHint
  )
    return null;
  const parsed = draft ? briefingValuesSchema.safeParse(draft.values) : null;
  const invalid = new Set(
    parsed && !parsed.success
      ? parsed.error.issues.map((issue) => String(issue.path[0]))
      : [],
  );
  const pending = save.isPending || reload.isPending;
  const update = (name: keyof BriefingValues, value: string) =>
    setDraft((previous) =>
      previous
        ? { ...previous, values: { ...previous.values, [name]: value } }
        : previous,
    );
  // HTML counts UTF-16 units; the schema enforces PostgreSQL code-point limits.
  const field = (
    name: Exclude<keyof BriefingValues, "contact_visibility">,
    label: string,
    maxLength: number,
    type = "text",
    rows?: number,
  ) => (
    <Field
      key={name}
      id={`briefing-${name}`}
      label={t(label)}
      error={invalid.has(name)}
    >
      {rows ? (
        <textarea
          rows={rows}
          value={draft!.values[name]}
          maxLength={maxLength * 2}
          disabled={pending}
          onChange={(event) => update(name, event.target.value)}
        />
      ) : (
        <input
          type={type}
          value={draft!.values[name]}
          maxLength={maxLength * 2}
          disabled={pending}
          onChange={(event) => update(name, event.target.value)}
        />
      )}
    </Field>
  );
  const beginEdit = (data: JobBriefingData) => {
    setDraft({ version: data.version, values: briefingValues(data) });
    setSaved(false);
    save.reset();
    reload.reset();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsed?.success && online && current.can_edit && !pending)
      save.mutate();
  };
  const conflict =
    typeof save.error === "object" &&
    save.error !== null &&
    "code" in save.error &&
    save.error.code === "40001";
  return (
    <section
      id="job-briefing"
      className="panel job-briefing"
      aria-label={t("title")}
    >
      <div className="job-briefing-heading">
        <h2>{t("title")}</h2>
        {current.can_edit && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => beginEdit(current)}
          >
            {t("edit")}
          </Button>
        )}
      </div>
      {(current.can_manage || managementHint) &&
        !hasReference &&
        !current.has_contact && <p>{t("introduction")}</p>}
      {(current.can_manage || managementHint) &&
        !current.can_edit &&
        (archived ? <p>{t("readOnly")}</p> : deniedNotice)}
      {saved && <Notice>{t("saved")}</Notice>}
      {hasReference && (
        <div className="job-briefing-block">
          <h3>{t("reference")}</h3>
          {href ? (
            <p>
              <a href={href} target="_blank" rel="noopener noreferrer">
                {current.reference_label || current.reference_url}
              </a>
            </p>
          ) : (
            current.reference_label && <p>{current.reference_label}</p>
          )}
          {current.reference_description && (
            <p className="preserve-text">{current.reference_description}</p>
          )}
        </div>
      )}
      {current.has_contact && (
        <div className="job-briefing-block">
          <h3>{t("contact")}</h3>
          {current.contact_visible ? (
            <>
              <div className="job-briefing-contact">
                {current.contact_name && (
                  <strong>{current.contact_name}</strong>
                )}
                {current.contact_email && (
                  <a
                    href={`mailto:${encodeURIComponent(current.contact_email)}`}
                  >
                    {current.contact_email}
                  </a>
                )}
                {current.contact_phone && (
                  <a href={phoneHref(current.contact_phone)}>
                    {current.contact_phone}
                  </a>
                )}
              </div>
              {current.contact_description && (
                <p className="preserve-text">{current.contact_description}</p>
              )}
            </>
          ) : (
            <p className="muted">{t("hidden")}</p>
          )}
        </div>
      )}
      <Dialog
        open={Boolean(draft) && current.can_edit}
        onOpenChange={(open) => {
          if (!open && !pending) setDraft(null);
        }}
        title={t("edit")}
        description={t("editDescription")}
      >
        {draft && (
          <form className="job-briefing-form" noValidate onSubmit={submit}>
            {!online && <Notice>{t("offline")}</Notice>}
            <fieldset disabled={pending}>
              <legend>{t("reference")}</legend>
              {field("reference_url", "referenceUrl", 2048, "url")}
              {field("reference_label", "referenceLabel", 120)}
              {field(
                "reference_description",
                "referenceDescription",
                4000,
                "text",
                4,
              )}
            </fieldset>
            <fieldset disabled={pending}>
              <legend>{t("contact")}</legend>
              {field("contact_name", "contactName", 120)}
              {field("contact_email", "contactEmail", 254, "email")}
              {field("contact_phone", "contactPhone", 50, "tel")}
              {field(
                "contact_description",
                "contactDescription",
                2000,
                "text",
                3,
              )}
              <Field
                id="briefing-contact_visibility"
                label={t("visibility")}
                hint={t("visibilityHint")}
              >
                <select
                  value={draft.values.contact_visibility}
                  disabled={pending}
                  onChange={(event) =>
                    update("contact_visibility", event.target.value)
                  }
                >
                  <option value="after_claim">{t("afterClaim")}</option>
                  <option value="offer_viewers">{t("offerViewers")}</option>
                </select>
              </Field>
            </fieldset>
            {parsed && !parsed.success && (
              <Notice kind="error">{t("invalid")}</Notice>
            )}
            {save.isError && (
              <Notice kind="error">{t(conflict ? "conflict" : "error")}</Notice>
            )}
            {reload.isError && <Notice kind="error">{t("reloadError")}</Notice>}
            {save.isError && (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!online || pending}
                  onClick={() => reload.mutate()}
                >
                  {t("reload")}
                </Button>
                <p className="muted">{t("reloadHint")}</p>
              </div>
            )}
            <div className="job-briefing-actions">
              <Button
                type="submit"
                disabled={
                  !online || pending || !parsed?.success || !current.can_edit
                }
              >
                {t(save.isPending ? "saving" : "save")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setDraft(null)}
              >
                {t("cancel")}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
