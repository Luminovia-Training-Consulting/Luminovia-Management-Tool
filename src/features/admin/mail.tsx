/** Administrator-only SMTP/IMAP settings; secret values are write-only and tests run through the private relay. */
import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
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
import { useAcademyBrand } from "../branding/academy-branding";
import {
  academyMailPaths,
  mailRuntimeStatus,
} from "../developer-api/academy-mail-contract";
import "./mail-i18n";

type Protocol = "smtp" | "imap";
type MailTest = { protocol: Protocol; sendToSelf?: true };

const ports = {
  smtp: { implicit_tls: "465", starttls: "587" },
  imap: { implicit_tls: "993", starttls: "143" },
} as const;
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
  sender_name?: string;
  username: string;
  password: string;
};
type MailDraft = {
  version: number;
  smtp: TransportDraft;
  imap: TransportDraft;
};

const academyMailConfiguration = z.fromJSONSchema(
  academyMailPaths["/rest/v1/rpc/get_mail_configuration"].post.responses["200"]
    .content["application/json"].schema,
);

/** Convert the safe server projection into form state without ever hydrating credentials. */
function draftFrom(
  configuration: MailConfiguration,
  academy: boolean,
): MailDraft {
  return {
    version: configuration.version,
    smtp: {
      enabled: configuration.smtp.enabled,
      host: configuration.smtp.host ?? (academy ? "" : "smtp.hostinger.com"),
      port: String(configuration.smtp.port ?? 465),
      security: configuration.smtp.security ?? "implicit_tls",
      sender_email: configuration.smtp.sender_email ?? "",
      sender_name: configuration.smtp.sender_name ?? undefined,
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
  const { i18n } = useTranslation();
  if (!result) return null;
  const testedAt = result.finished_at ?? result.created_at;
  const timestamp = new Date(testedAt);
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
      {Number.isFinite(timestamp.getTime()) && (
        <>
          {" · "}
          <time dateTime={testedAt}>
            {new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(timestamp)}
          </time>
        </>
      )}
    </p>
  );
}

/** Administer the single SMTP transport used by Auth and notifications plus optional IMAP checks. */
export function AdminMailPage({ academy }: { academy?: "active" | "grace" }) {
  const { t } = useTranslation("adminMail");
  const brand = useAcademyBrand();
  const { session } = useAuth();
  const online = useOnline();
  const cache = useQueryClient();
  const actor = session!.user.id;
  const queryKey = [
    "admin-mail-configuration",
    actor,
    Boolean(academy),
  ] as const;
  const readOnly = academy === "grace";
  const configuration = useQuery({
    queryKey,
    ...(academy && {
      enabled: online,
      gcTime: 0,
      refetchInterval: 30_000,
      refetchOnMount: "always" as const,
      retry: false,
    }),
    queryFn: async () => {
      const result = await db().rpc("get_mail_configuration");
      if (result.error) throw result.error;
      return (
        academy ? academyMailConfiguration.parse(result.data) : result.data
      ) as MailConfiguration;
    },
  });
  const runtime = useQuery({
    queryKey: ["admin-mail-runtime", actor, Boolean(academy)],
    enabled: online && configuration.isSuccess,
    retry: false,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await db().functions.invoke("mail-admin", {
        method: "GET",
      });
      if (error) throw error;
      return mailRuntimeStatus.parse(data);
    },
  });
  const [edits, setDraft] = useState<MailDraft | null>(null);
  const draft =
    edits ??
    (configuration.data
      ? draftFrom(configuration.data, Boolean(academy))
      : null);
  const [notice, setNotice] = useState<
    | "saved"
    | "saveFailed"
    | "conflict"
    | "testFailed"
    | "testMailAccepted"
    | "testMailUnconfirmed"
    | "incompleteCredentials"
    | null
  >(null);

  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (readOnly || !draft || !configuration.data)
        throw new Error("configuration_unavailable");
      await cache.cancelQueries({ queryKey, exact: true });
      const { data, error } = await db().rpc("save_mail_configuration", {
        p_expected_version: draft.version,
        p_smtp: {
          ...draft.smtp,
          port: draft.smtp.port === "" ? null : Number(draft.smtp.port),
          sender_name: draft.smtp.sender_name ?? brand.name,
        },
        p_imap: academy
          ? { enabled: false }
          : {
              enabled: draft.imap.enabled,
              host: draft.imap.host,
              port: draft.imap.port === "" ? null : Number(draft.imap.port),
              security: draft.imap.security,
              username: draft.imap.username,
              password: draft.imap.password,
            },
      });
      if (error) throw error;
      return (
        academy ? academyMailConfiguration.parse(data) : data
      ) as MailConfiguration;
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
          (error.code === "PT409" || error.code === "40001")
          ? "conflict"
          : "saveFailed",
      ),
  });
  const test = useMutation({
    mutationFn: async ({ protocol, sendToSelf }: MailTest) => {
      requireOnline();
      if (readOnly) throw new Error("configuration_unavailable");
      const response = await db().functions.invoke("mail-admin", {
        body: { protocol, ...(sendToSelf && { send_to_self: true }) },
      });
      if (response.error) throw response.error;
      const result = response.data as {
        status: ConnectionStatus;
        error_code: string | null;
      };
      await cache.invalidateQueries({ queryKey });
      return result;
    },
    onSuccess: (result, { sendToSelf }) => {
      if (sendToSelf)
        setNotice(
          result.status === "succeeded"
            ? "testMailAccepted"
            : "testMailUnconfirmed",
        );
    },
    onError: (_error, { sendToSelf }) =>
      setNotice(sendToSelf ? "testMailUnconfirmed" : "testFailed"),
  });

  if (academy && !online) return <Notice>{t("academyOnline")}</Notice>;
  if (
    configuration.isPending ||
    (academy && configuration.isFetching && !configuration.isFetchedAfterMount)
  )
    return <Loading />;
  if (
    configuration.error &&
    "code" in configuration.error &&
    configuration.error.code === "42501"
  )
    return <Notice kind="error">{t("noPermission")}</Notice>;
  if (configuration.isError || !configuration.data || !draft)
    return <ErrorState retry={() => void configuration.refetch()} />;

  /** Change one field without replacing password drafts in the other transport. */
  function change(protocol: Protocol, patch: Partial<TransportDraft>) {
    setNotice(null);
    if (draft) {
      setDraft({ ...draft, [protocol]: { ...draft[protocol], ...patch } });
    }
  }

  function credentialsNeedAttention(current: MailDraft) {
    return (["smtp", "imap"] as const).some((protocol) => {
      if (academy && protocol === "imap") return false;
      const { enabled, username, password } = current[protocol];
      const hasUsername = Boolean(username.trim());
      const hasPassword = Boolean(password);
      if (!enabled) return hasUsername || hasPassword;
      return (
        hasUsername !== hasPassword ||
        (!hasUsername && !configuration.data?.[protocol].credentials_configured)
      );
    });
  }

  /** Do not contact the provider until any changes have been confirmed by a save. */
  async function runTest(
    event: FormEvent<HTMLButtonElement>,
    request: MailTest,
  ) {
    event.preventDefault();
    if (!draft || !event.currentTarget.form?.reportValidity()) return;
    setNotice(null);
    if (edits) {
      if (credentialsNeedAttention(draft)) {
        setNotice("incompleteCredentials");
        return;
      }
      try {
        await save.mutateAsync();
      } catch {
        // The save handler explains the failure and retains the draft.
        return;
      }
    }
    test.mutate(request);
  }

  const testDisabled = (protocol: Protocol) => {
    const transport = draft[protocol],
      saved = configuration.data[protocol];
    return (
      !online ||
      readOnly ||
      save.isPending ||
      test.isPending ||
      !transport.enabled ||
      runtime.data?.relay_configured === false ||
      (!saved.credentials_configured &&
        (!transport.username.trim() || !transport.password))
    );
  };
  return (
    <section className="mail-settings">
      <PageHeading
        title={t("title")}
        description={t(academy ? "academyDescription" : "description")}
      />
      {readOnly && <Notice>{t("academyReadOnly")}</Notice>}
      <section className="panel" aria-labelledby="mail-setup-title">
        <h2 id="mail-setup-title">{t("setupTitle")}</h2>
        <ul>
          <li>
            {t(
              configuration.data.smtp.enabled &&
                configuration.data.smtp.credentials_configured
                ? "smtpConfigured"
                : "smtpIncomplete",
            )}
          </li>
          <li>
            {t(
              runtime.data
                ? runtime.data.relay_configured
                  ? "relayConfigured"
                  : "relayMissing"
                : "relayUnknown",
            )}
          </li>
          <li>
            {t(
              runtime.data
                ? runtime.data.invitations_enabled
                  ? "invitationEnabled"
                  : "invitationDisabled"
                : "invitationUnknown",
            )}
          </li>
        </ul>
        <p>{t("connectionScope")}</p>
      </section>
      {notice && (
        <Notice
          kind={
            notice === "saved" || notice === "testMailAccepted"
              ? "success"
              : "error"
          }
        >
          {t(notice)}
        </Notice>
      )}
      <form
        className="panel mail-configuration"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          if (credentialsNeedAttention(draft)) {
            setNotice("incompleteCredentials");
            return;
          }
          save.mutate();
        }}
      >
        <fieldset disabled={readOnly || save.isPending || test.isPending}>
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
                  change("smtp", {
                    port: event.currentTarget.value,
                    security:
                      event.currentTarget.value === "465"
                        ? "implicit_tls"
                        : "starttls",
                  })
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
                    port: ports.smtp[event.currentTarget.value as SecurityMode],
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
                value={draft.smtp.sender_name ?? brand.name}
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
                disabled={!draft.smtp.enabled}
                placeholder={
                  configuration.data.smtp.credentials_configured
                    ? t("credentialSaved")
                    : undefined
                }
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
                disabled={!draft.smtp.enabled}
                placeholder={
                  configuration.data.smtp.credentials_configured
                    ? t("credentialSaved")
                    : undefined
                }
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
              onClick={(event) => void runTest(event, { protocol: "smtp" })}
            >
              {test.isPending ? t("testing") : t("smtpTest")}
            </Button>
            <Button
              type="button"
              disabled={testDisabled("smtp")}
              onClick={(event) =>
                void runTest(event, { protocol: "smtp", sendToSelf: true })
              }
            >
              {t("sendTestMail")}
            </Button>
          </div>
        </fieldset>
        {!academy && (
          <fieldset disabled={save.isPending || test.isPending}>
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
                    change("imap", {
                      port: event.currentTarget.value,
                      security:
                        event.currentTarget.value === "993"
                          ? "implicit_tls"
                          : "starttls",
                    })
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
                      port: ports.imap[
                        event.currentTarget.value as SecurityMode
                      ],
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
                  disabled={!draft.imap.enabled}
                  placeholder={
                    configuration.data.imap.credentials_configured
                      ? t("credentialSaved")
                      : undefined
                  }
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
                  disabled={!draft.imap.enabled}
                  placeholder={
                    configuration.data.imap.credentials_configured
                      ? t("credentialSaved")
                      : undefined
                  }
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
                onClick={(event) => void runTest(event, { protocol: "imap" })}
              >
                {test.isPending ? t("testing") : t("imapTest")}
              </Button>
            </div>
          </fieldset>
        )}
        {!readOnly && (
          <div className="form-actions">
            <Button
              type="submit"
              disabled={!online || save.isPending || test.isPending}
            >
              {save.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
