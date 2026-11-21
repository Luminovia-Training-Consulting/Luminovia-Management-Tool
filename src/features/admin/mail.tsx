/** Administrator-only SMTP/IMAP settings; secret values are write-only and tests run through the private relay. */
import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import "./mail-i18n";

type Protocol = "smtp" | "imap";
type SecurityMode = "implicit_tls" | "starttls";
type ConnectionStatus = "pending" | "running" | "succeeded" | "failed";
type ConnectionResult = {
  status: ConnectionStatus;
  error_code: string | null;
  created_at: string;
  finished_at: string | null;
};
type Transport = {
  enabled: boolean;
  host: string | null;
  port: number | null;
  security: SecurityMode | null;
  sender_email?: string | null;
  sender_name?: string | null;
  credentials_configured: boolean;
  last_test: ConnectionResult | null;
};
export type MailConfiguration = {
  version: number;
  smtp: Transport;
  imap: Transport;
};
type TransportDraft = {
  enabled: boolean;
  host: string;
  port: string;
  security: SecurityMode;
  sender_email: string;
  sender_name: string;
  username: string;
  password: string;
};
type MailDraft = {
  version: number;
  smtp: TransportDraft;
  imap: TransportDraft;
};

/** Convert the safe server projection into form state without ever hydrating credentials. */
function draftFrom(configuration: MailConfiguration): MailDraft {
  return {
    version: configuration.version,
    smtp: {
      enabled: configuration.smtp.enabled,
      host: configuration.smtp.host ?? "smtp.hostinger.com",
      port: String(configuration.smtp.port ?? 465),
      security: configuration.smtp.security ?? "implicit_tls",
      sender_email: configuration.smtp.sender_email ?? "",
      sender_name: configuration.smtp.sender_name ?? "Luminovia Portal",
      username: "",
      password: "",
    },
    imap: {
      enabled: configuration.imap.enabled,
      host: configuration.imap.host ?? "imap.hostinger.com",
      port: String(configuration.imap.port ?? 993),
      security: configuration.imap.security ?? "implicit_tls",
      sender_email: "",
      sender_name: "",
      username: "",
      password: "",
    },
  };
}

/** Render a non-secret last-test status and map server codes to fixed bilingual copy. */
function TestStatus({
  result,
  t,
}: {
  result: ConnectionResult | null;
  t: (key: string) => string;
}) {
  if (!result) return null;
  const status = {
    pending: "statusPending",
    running: "statusRunning",
    succeeded: "statusSucceeded",
    failed: "statusFailed",
  }[result.status];
  const errorKey = {
    connect_failed: "errorConnect",
    tls_failed: "errorTls",
    authentication_failed: "errorAuth",
    protocol_failed: "errorProtocol",
    timeout: "errorTimeout",
    configuration_changed: "errorChanged",
    configuration_unavailable: "errorUnavailable",
  }[result.error_code ?? ""];
  return (
    <p className="mail-test-status" role="status">
      {t(status)}
      {errorKey && ` · ${t(errorKey)}`}
    </p>
  );
}

/** Administer the single SMTP transport used by Auth and notifications plus optional IMAP checks. */
export function AdminMailPage() {
  const { t } = useTranslation("adminMail");
  const { session } = useAuth();
  const online = useOnline();
  const cache = useQueryClient();
  const actor = session!.user.id;
  const queryKey = ["admin-mail-configuration", actor] as const;
  const configuration = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await db().rpc("get_mail_configuration");
      if (result.error) throw result.error;
      return result.data as MailConfiguration;
    },
  });
  const [edits, setDraft] = useState<MailDraft | null>(null);
  const draft =
    edits ?? (configuration.data ? draftFrom(configuration.data) : null);
  const [notice, setNotice] = useState<
    "saved" | "saveFailed" | "conflict" | "testFailed" | null
  >(null);

  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!draft || !configuration.data)
        throw new Error("configuration_unavailable");
      const { data, error } = await db().rpc("save_mail_configuration", {
        p_expected_version: draft.version,
        p_smtp: {
          ...draft.smtp,
          port: draft.smtp.port === "" ? null : Number(draft.smtp.port),
        },
        p_imap: {
          enabled: draft.imap.enabled,
          host: draft.imap.host,
          port: draft.imap.port === "" ? null : Number(draft.imap.port),
          security: draft.imap.security,
          username: draft.imap.username,
          password: draft.imap.password,
        },
      });
      if (error) throw error;
      return data as MailConfiguration;
    },
    onSuccess: (value) => {
      cache.setQueryData(queryKey, value);
      setDraft(null);
      setNotice("saved");
    },
    onError: (error) =>
      setNotice(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "40001"
          ? "conflict"
          : "saveFailed",
      ),
  });
  const test = useMutation({
    mutationFn: async (protocol: Protocol) => {
      requireOnline();
      await save.mutateAsync();
      const response = await db().functions.invoke("mail-admin", {
        body: { protocol },
      });
      if (response.error) throw response.error;
      const result = response.data as {
        status: ConnectionStatus;
        error_code: string | null;
      };
      await cache.invalidateQueries({ queryKey });
      return result;
    },
    onError: (error) =>
      setNotice(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "40001"
          ? "conflict"
          : "testFailed",
      ),
  });

  if (configuration.isPending) return <Loading />;
  if (configuration.isError || !configuration.data || !draft)
    return <ErrorState retry={() => void configuration.refetch()} />;

  /** Change one field without replacing password drafts in the other transport. */
  function change(protocol: Protocol, patch: Partial<TransportDraft>) {
    setNotice(null);
    if (draft) {
      setDraft({ ...draft, [protocol]: { ...draft[protocol], ...patch } });
    }
  }

  /** Save first, then ask the internal relay to perform a no-message protocol handshake. */
  function runTest(event: FormEvent, protocol: Protocol) {
    event.preventDefault();
    setNotice(null);
    test.mutate(protocol);
  }

  const testDisabled = (protocol: Protocol) => {
    const transport = draft[protocol],
      saved = configuration.data[protocol];
    return (
      !online ||
      save.isPending ||
      test.isPending ||
      !transport.enabled ||
      (!saved.credentials_configured &&
        (!transport.username.trim() || !transport.password))
    );
  };
  return (
    <section className="mail-settings">
      <PageHeading title={t("title")} description={t("description")} />
      {notice && (
        <Notice kind={notice === "saved" ? "success" : "error"}>
          {t(notice)}
        </Notice>
      )}
      <form
        className="panel mail-configuration"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          save.mutate();
        }}
      >
        <fieldset>
          <legend>{t("smtp")}</legend>
          <label className="mail-enabled">
            <input
              type="checkbox"
              checked={draft.smtp.enabled}
              onChange={(event) =>
                change("smtp", { enabled: event.currentTarget.checked })
              }
            />
            <span>{t("enabled")}</span>
          </label>
          <div className="mail-fields">
            <Field id="mail-smtp-host" label={t("host")}>
              <input
                type="text"
                autoComplete="url"
                maxLength={253}
                value={draft.smtp.host}
                onChange={(event) =>
                  change("smtp", { host: event.currentTarget.value })
                }
              />
            </Field>
            <Field id="mail-smtp-port" label={t("port")}>
              <select
                value={draft.smtp.port}
                onChange={(event) =>
                  change("smtp", { port: event.currentTarget.value })
                }
              >
                <option value="465">465</option>
                <option value="587">587</option>
              </select>
            </Field>
            <Field id="mail-smtp-security" label={t("security")}>
              <select
                value={draft.smtp.security}
                onChange={(event) =>
                  change("smtp", {
                    security: event.currentTarget.value as SecurityMode,
                  })
                }
              >
                <option value="implicit_tls">{t("implicitTls")}</option>
                <option value="starttls">{t("startTls")}</option>
              </select>
            </Field>
            <Field id="mail-smtp-sender" label={t("senderEmail")}>
              <input
                type="email"
                autoComplete="email"
                maxLength={254}
                value={draft.smtp.sender_email}
                onChange={(event) =>
                  change("smtp", { sender_email: event.currentTarget.value })
                }
              />
            </Field>
            <Field id="mail-smtp-sender-name" label={t("senderName")}>
              <input
                type="text"
                maxLength={120}
                value={draft.smtp.sender_name}
                onChange={(event) =>
                  change("smtp", { sender_name: event.currentTarget.value })
                }
              />
            </Field>
            <Field
              id="mail-smtp-user"
              label={t("username")}
              hint={
                configuration.data.smtp.credentials_configured
                  ? t("leaveBlank")
                  : undefined
              }
            >
              <input
                type="text"
                autoComplete="off"
                maxLength={254}
                value={draft.smtp.username}
                onChange={(event) =>
                  change("smtp", { username: event.currentTarget.value })
                }
              />
            </Field>
            <Field
              id="mail-smtp-password"
              label={t("password")}
              hint={
                configuration.data.smtp.credentials_configured
                  ? t("credentialsConfigured")
                  : undefined
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                value={draft.smtp.password}
                onChange={(event) =>
                  change("smtp", { password: event.currentTarget.value })
                }
              />
            </Field>
          </div>
          <TestStatus result={configuration.data.smtp.last_test} t={t} />
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={testDisabled("smtp")}
              onClick={(event) => runTest(event, "smtp")}
            >
              {test.isPending ? t("testing") : t("smtpTest")}
            </Button>
          </div>
        </fieldset>
        <fieldset>
          <legend>{t("imap")}</legend>
          <label className="mail-enabled">
            <input
              type="checkbox"
              checked={draft.imap.enabled}
              onChange={(event) =>
                change("imap", { enabled: event.currentTarget.checked })
              }
            />
            <span>{t("enabled")}</span>
          </label>
          <div className="mail-fields">
            <Field id="mail-imap-host" label={t("host")}>
              <input
                type="text"
                autoComplete="url"
                maxLength={253}
                value={draft.imap.host}
                onChange={(event) =>
                  change("imap", { host: event.currentTarget.value })
                }
              />
            </Field>
            <Field id="mail-imap-port" label={t("port")}>
              <select
                value={draft.imap.port}
                onChange={(event) =>
                  change("imap", { port: event.currentTarget.value })
                }
              >
                <option value="993">993</option>
                <option value="143">143</option>
              </select>
            </Field>
            <Field id="mail-imap-security" label={t("security")}>
              <select
                value={draft.imap.security}
                onChange={(event) =>
                  change("imap", {
                    security: event.currentTarget.value as SecurityMode,
                  })
                }
              >
                <option value="implicit_tls">{t("implicitTls")}</option>
                <option value="starttls">{t("startTls")}</option>
              </select>
            </Field>
            <Field
              id="mail-imap-user"
              label={t("username")}
              hint={
                configuration.data.imap.credentials_configured
                  ? t("leaveBlank")
                  : undefined
              }
            >
              <input
                type="text"
                autoComplete="off"
                maxLength={254}
                value={draft.imap.username}
                onChange={(event) =>
                  change("imap", { username: event.currentTarget.value })
                }
              />
            </Field>
            <Field
              id="mail-imap-password"
              label={t("password")}
              hint={
                configuration.data.imap.credentials_configured
                  ? t("credentialsConfigured")
                  : undefined
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                value={draft.imap.password}
                onChange={(event) =>
                  change("imap", { password: event.currentTarget.value })
                }
              />
            </Field>
          </div>
          <TestStatus result={configuration.data.imap.last_test} t={t} />
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={testDisabled("imap")}
              onClick={(event) => runTest(event, "imap")}
            >
              {test.isPending ? t("testing") : t("imapTest")}
            </Button>
          </div>
        </fieldset>
        <div className="form-actions">
          <Button
            type="submit"
            disabled={!online || save.isPending || test.isPending}
          >
            {save.isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </section>
  );
}
