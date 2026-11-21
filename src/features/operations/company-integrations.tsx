import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { CompanyWebhooks } from "./company-webhooks";

type Integration = {
  id: string;
  label: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  version: number;
};

export function CompanyIntegrations({
  actor,
  organisation,
  archived,
  zone,
  canSubscribePremium = false,
  showWebhooks = true,
}: {
  actor: string;
  organisation: string;
  archived: boolean;
  zone: string;
  canSubscribePremium?: boolean;
  showWebhooks?: boolean;
}) {
  const { t, i18n } = useTranslation("operations");
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
        const result = await db().rpc("issue_company_integration_key", {
          p_organisation_id: organisation,
          p_label:
            action?.key.label ?? String(payload.get("label") ?? "").trim(),
          p_expires_at: new Date(
            Date.now() + Number(payload.get("days")) * 86_400_000,
          ).toISOString(),
          p_rotate_id: action?.key.id ?? null,
          p_expected_version: action?.key.version ?? null,
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
            {(keys.data ?? []).map((key) => (
              <li key={key.id}>
                <strong>{key.label}</strong>{" "}
                {key.revoked_at
                  ? t("integrationRevoked")
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
                <Field id="integration-label" label={t("integrationLabel")}>
                  <input
                    id="integration-label"
                    name="label"
                    required
                    maxLength={120}
                  />
                </Field>
              )}
              {action?.type !== "revoke" && (
                <Field id="integration-days" label={t("integrationDuration")}>
                  <select id="integration-days" name="days" defaultValue="30">
                    <option value="30">
                      {t("integrationDays", { count: 30 })}
                    </option>
                    <option value="90">
                      {t("integrationDays", { count: 90 })}
                    </option>
                  </select>
                </Field>
              )}
              <Button
                disabled={!online || pending || (!keys.isSuccess && !action)}
              >
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
              <Field id="integration-secret" label={t("integrationCredential")}>
                <input
                  id="integration-secret"
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
              keys={keys.data ?? []}
              canSubscribePremium={canSubscribePremium}
              archived={archived}
            />
          )}
        </>
      )}
    </details>
  );
}
