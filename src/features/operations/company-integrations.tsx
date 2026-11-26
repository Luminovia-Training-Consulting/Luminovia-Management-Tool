import { useId, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { CompanyWebhooks } from "./company-webhooks";
import {
  companyIntegrationScopes,
  type CompanyIntegrationScope,
} from "./company-integration-scopes";

const scopeLabel = {
  "courses.read": "integrationCourseIndex",
  "enrolments.write": "integrationEnrolments",
  "reports.read": "integrationReports",
} as const;

type Integration = {
  id: string;
  label: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  version: number;
  scope: CompanyIntegrationScope;
  webhook_eligible?: boolean;
};

export function CompanyIntegrations({
  actor,
  organisation,
  archived,
  zone,
  canSubscribePremium = false,
  canSubscribeAccounting = false,
  showWebhooks = true,
  allowPermanent = true,
}: {
  actor: string;
  organisation: string;
  archived: boolean;
  zone: string;
  canSubscribePremium?: boolean;
  canSubscribeAccounting?: boolean;
  showWebhooks?: boolean;
  allowPermanent?: boolean;
}) {
  const { t, i18n } = useTranslation("operations");
  const fieldId = useId();
  const cache = useQueryClient();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [credential, setCredential] = useState("");
  const [action, setAction] = useState<{
    key: Integration;
    type: "rotate" | "revoke";
  }>();
  const queryKey = ["company-integration-keys", actor, organisation];
  const keys = useQuery({
    queryKey,
    enabled: open && online,
    queryFn: async () => {
      const { data, error } = await db().rpc("company_integration_keys", {
        p_organisation_id: organisation,
      });
      if (error) throw error;
      return data as Integration[];
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !online || !keys.isSuccess) return;
    const form = event.currentTarget;
    const payload = new FormData(form);
    setCredential("");
    setError(false);
    setPending(true);
    try {
      requireOnline();
      if (action?.type === "revoke") {
        const result = await db().rpc("revoke_company_integration_key", {
          p_id: action.key.id,
          p_expected_version: action.key.version,
        });
        if (result.error) throw result.error;
      } else {
        const validity = payload.get("days");
        const expiry =
          validity === "permanent" && allowPermanent
            ? null
            : new Date(
                Date.now() + Number(validity) * 86_400_000,
              ).toISOString();
        const result = await db().rpc("issue_scoped_company_integration_key", {
          p_organisation_id: organisation,
          p_label:
            action?.key.label ?? String(payload.get("label") ?? "").trim(),
          p_expires_at: expiry,
          p_rotate_id: action?.key.id ?? null,
          p_expected_version: action?.key.version ?? null,
          p_scope:
            action?.key.scope ?? String(payload.get("scope") ?? "courses.read"),
        });
        if (result.error || typeof result.data?.credential !== "string")
          throw new Error("key_issue_failed");
        if (form.isConnected) setCredential(result.data.credential);
      }
      setAction(undefined);
      form.reset();
    } catch {
      setError(true);
    } finally {
      await Promise.all([
        cache.invalidateQueries({ queryKey }),
        cache.invalidateQueries({
          queryKey: ["company-course-webhooks", actor, organisation],
        }),
      ]);
      setPending(false);
    }
  }

  return (
    <details
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (!event.currentTarget.open) {
          setCredential("");
          setAction(undefined);
        }
      }}
    >
      <summary>{t("integrationTitle")}</summary>
      {open && (
        <>
          <p>{t("integrationScope")}</p>
          {keys.isPending && online && <Loading />}
          {keys.isError && <ErrorState retry={() => void keys.refetch()} />}
          <ul>
            {(keys.isSuccess ? keys.data : []).map((key) => (
              <li key={key.id}>
                <strong>{key.label}</strong> ·{" "}
                {t(scopeLabel[key.scope ?? "courses.read"])} ·{" "}
                {key.revoked_at
                  ? t("integrationRevoked")
                  : key.expires_at === null
                    ? t("integrationPermanent")
                    : t("integrationExpiry", {
                        date: dateTime(key.expires_at, i18n.language, zone),
                      })}
                {key.last_used_at && (
                  <>
                    {" "}
                    ·{" "}
                    {t("integrationLastUsed", {
                      date: dateTime(key.last_used_at, i18n.language, zone),
                    })}
                  </>
                )}
                {!key.revoked_at && (
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!online || pending || archived}
                      onClick={() => {
                        setCredential("");
                        setAction({ key, type: "rotate" });
                      }}
                    >
                      {t("integrationRotate")}
                    </Button>{" "}
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!online || pending}
                      onClick={() => {
                        setCredential("");
                        setAction({ key, type: "revoke" });
                      }}
                    >
                      {t("integrationRevoke")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {(!archived || action?.type === "revoke") && (
            <form onSubmit={submit}>
              {action ? (
                <p>
                  {t(
                    action.type === "rotate"
                      ? "integrationConfirmRotate"
                      : "integrationConfirmRevoke",
                    { label: action.key.label },
                  )}
                </p>
              ) : (
                <>
                  <Field id={`${fieldId}-label`} label={t("integrationLabel")}>
                    <input
                      id={`${fieldId}-label`}
                      name="label"
                      required
                      maxLength={120}
                    />
                  </Field>
                  <Field
                    id={`${fieldId}-scope`}
                    label={t("integrationScopeChoice")}
                  >
                    <select
                      id={`${fieldId}-scope`}
                      name="scope"
                      defaultValue="courses.read"
                    >
                      {companyIntegrationScopes.map((scope) => (
                        <option key={scope} value={scope}>
                          {t(scopeLabel[scope])}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {action?.type !== "revoke" && (
                <Field id={`${fieldId}-days`} label={t("integrationDuration")}>
                  <select
                    id={`${fieldId}-days`}
                    name="days"
                    key={action?.key.id ?? "new"}
                    defaultValue={
                      allowPermanent && action?.key.expires_at === null
                        ? "permanent"
                        : "30"
                    }
                  >
                    <option value="30">
                      {t("integrationDays", { count: 30 })}
                    </option>
                    <option value="90">
                      {t("integrationDays", { count: 90 })}
                    </option>
                    {allowPermanent && (
                      <option value="permanent">
                        {t("integrationPermanent")}
                      </option>
                    )}
                  </select>
                </Field>
              )}
              <Button disabled={!online || pending || !keys.isSuccess}>
                {t(action ? "integrationConfirm" : "integrationCreate")}
              </Button>{" "}
              {action && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => setAction(undefined)}
                >
                  {t("cancel")}
                </Button>
              )}
            </form>
          )}
          {credential && (
            <div role="status">
              <p>{t("integrationCopy")}</p>
              <Field
                id={`${fieldId}-secret`}
                label={t("integrationCredential")}
              >
                <input
                  id={`${fieldId}-secret`}
                  value={credential}
                  readOnly
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </Field>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCredential("")}
              >
                {t("integrationHide")}
              </Button>
            </div>
          )}
          {error && <Notice kind="error">{t("integrationError")}</Notice>}
          {showWebhooks && (
            <CompanyWebhooks
              actor={actor}
              organisation={organisation}
              zone={zone}
              keys={(keys.data ?? []).filter(
                (key) =>
                  (key.scope ?? "courses.read") === "courses.read" &&
                  key.webhook_eligible !== false,
              )}
              canSubscribePremium={canSubscribePremium}
              canSubscribeAccounting={canSubscribeAccounting}
              archived={archived}
            />
          )}
        </>
      )}
    </details>
  );
}

/** Use the company portal's already scoped directory without loading other organisations. */
export function CompanyIntegrationPicker({
  actor,
  organisations,
  zone,
}: {
  actor: string;
  organisations: { id: string; name: string }[];
  zone: string;
}) {
  const { t } = useTranslation("operations");
  const companyField = useId();
  const [companyId, setCompanyId] = useState("");
  const company =
    organisations.find(({ id }) => id === companyId) ?? organisations[0];
  if (!company) return null;

  return (
    <section className="panel">
      {organisations.length > 1 && (
        <Field id={companyField} label={t("integrationCompany")}>
          <select
            value={company.id}
            onChange={(event) => setCompanyId(event.target.value)}
          >
            {organisations.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <CompanyIntegrations
        key={company.id}
        actor={actor}
        organisation={company.id}
        zone={zone}
        archived={false}
        showWebhooks={false}
      />
    </section>
  );
}
