import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { academyLicenceQuery } from "../accounts/academy-licence-api";
import { AcademyLicencePanel } from "../accounts/academy-licence-panel";
import {
  academyAdministrationQuery,
  createAcademyAccount,
  createAcademyOrganisation,
  setAcademyManagement,
  setAcademyMemberActive,
} from "../accounts/academy-api";
import type {
  AcademyAdministration,
  AcademyManagedAccount,
} from "../accounts/academy-schema";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../../lib/online";
import { AcademyBrandLinksEditor } from "../branding/academy-brand-links-panel";
import { AcademyBrandEditor } from "../branding/academy-brand-editor";
import { AcademyWebhookPanel } from "./academy-webhook-panel";
import { AcademyRoleEditor } from "./academy-role-editor";

type Localize = (de: string, en: string) => string;
type Result = { kind: "ok" | "error"; message: string };

function failure(error: unknown, word: Localize) {
  const code =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "code" in error
        ? error.code
        : null;
  if (
    code === "academy_seat_limit" ||
    (error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "PT409" &&
      "details" in error &&
      error.details === "academy_seat_limit")
  )
    return word(
      "Alle lizenzierten Kontoplätze sind belegt.",
      "All licensed account seats are in use.",
    );
  if (code === "invitations_disabled")
    return word(
      "Der Einladungsversand ist noch nicht eingerichtet.",
      "Invitation delivery is not configured.",
    );
  if (code === "invalid_request" || code === "22023")
    return word(
      "Prüfe die eingegebenen Angaben.",
      "Check the submitted details.",
    );
  if (code === "permission_required" || code === "42501")
    return word(
      "Deine Berechtigung für diese Aktion fehlt.",
      "Your account lacks permission for this action.",
    );
  if (code === "creation_conflict" || code === "PT409")
    return word(
      "Die Angaben stehen mit einem bestehenden Eintrag in Konflikt.",
      "The details conflict with an existing entry.",
    );
  return word(
    "Der Server hat die Änderung nicht bestätigt. Du kannst sie erneut prüfen.",
    "The server did not confirm the change. You can check it again.",
  );
}

function OrganisationForm({
  word,
  changed,
}: {
  word: Localize;
  changed: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const requestId = useRef<string | undefined>(undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    requestId.current ??= crypto.randomUUID();
    setBusy(true);
    setResult(undefined);
    try {
      await createAcademyOrganisation(
        requestId.current,
        String(data.get("name") ?? ""),
        String(data.get("zone") ?? ""),
      );
      form.reset();
      requestId.current = undefined;
      await changed();
      setResult({
        kind: "ok",
        message: word("Organisation angelegt.", "Organisation created."),
      });
    } catch (error) {
      setResult({ kind: "error", message: failure(error, word) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>{word("Organisation anlegen", "Create an organisation")}</h2>
      <form
        onSubmit={(event) => void submit(event)}
        onChange={() => {
          requestId.current = undefined;
        }}
      >
        <fieldset disabled={busy}>
          <Field
            id="academy-organisation-name"
            label={word("Name der Organisation", "Organisation name")}
          >
            <input name="name" required maxLength={200} />
          </Field>
          <Field
            id="academy-organisation-zone"
            label={word("Zeitzone", "Time zone")}
            hint={word(
              "IANA-Zeitzone, z. B. Europe/Berlin",
              "IANA time zone, e.g. Australia/Brisbane",
            )}
          >
            <input
              name="zone"
              required
              maxLength={80}
              defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
            />
          </Field>
          <Button type="submit">
            {word("Organisation speichern", "Save organisation")}
          </Button>
        </fieldset>
      </form>
      {result && (
        <Notice kind={result.kind === "error" ? "error" : undefined}>
          {result.message}
        </Notice>
      )}
    </section>
  );
}

function AccountForm({
  organisations,
  canCreateManagement,
  word,
  changed,
}: {
  organisations: AcademyAdministration["organisations"];
  canCreateManagement: boolean;
  word: Localize;
  changed: () => Promise<unknown>;
}) {
  const [role, setRole] = useState<AcademyManagedAccount["role"]>("lecturer");
  const requiresOrganisation = role === "participant" || role === "client";
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const requestId = useRef<string | undefined>(undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    requestId.current ??= crypto.randomUUID();
    setBusy(true);
    setResult(undefined);
    try {
      const response = await createAcademyAccount({
        idempotency_key: requestId.current,
        display_name: String(data.get("name") ?? ""),
        email: String(data.get("email") ?? ""),
        role,
        mode,
        organisation_id: requiresOrganisation
          ? String(data.get("organisation") ?? "")
          : null,
        ...(mode === "password"
          ? { password: String(data.get("password") ?? "") }
          : {}),
      });
      if (response.status === "in_progress") {
        setResult({
          kind: "ok",
          message: word(
            "Die Anfrage wird bearbeitet. Sende sie erneut, um den Status zu prüfen.",
            "The request is being processed. Submit it again to check its status.",
          ),
        });
        return;
      }
      form.reset();
      requestId.current = undefined;
      await changed();
      setResult({
        kind: "ok",
        message:
          mode === "invite"
            ? word("Einladung veranlasst.", "Invitation requested.")
            : word("Konto angelegt.", "Account created."),
      });
    } catch (error) {
      setResult({ kind: "error", message: failure(error, word) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>{word("Konto einrichten", "Set up an account")}</h2>
      <form
        onSubmit={(event) => void submit(event)}
        onChange={() => {
          requestId.current = undefined;
        }}
      >
        <fieldset disabled={busy}>
          <Field
            id="academy-account-name"
            label={word("Anzeigename", "Display name")}
          >
            <input name="name" required maxLength={120} />
          </Field>
          <Field
            id="academy-account-email"
            label={word("E-Mail-Adresse", "Email address")}
          >
            <input name="email" type="email" required maxLength={254} />
          </Field>
          <Field id="academy-account-role" label={word("Rolle", "Role")}>
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as AcademyManagedAccount["role"])
              }
            >
              <option value="lecturer">{word("Lehrende", "Instructor")}</option>
              <option value="participant">
                {word("Teilnehmende", "Learner")}
              </option>
              {canCreateManagement && (
                <>
                  <option value="management">
                    {word("Kursmanagement", "Course manager")}
                  </option>
                  <option value="client">
                    {word("Unternehmenskontakt", "Company contact")}
                  </option>
                </>
              )}
            </select>
          </Field>
          {requiresOrganisation && (
            <Field
              id="academy-account-organisation"
              label={
                role === "client"
                  ? word("Unternehmen", "Company")
                  : word(
                      "Organisation für die Teilnahme",
                      "Learner organisation",
                    )
              }
            >
              <select name="organisation" required defaultValue="">
                <option value="" disabled>
                  {word("Organisation auswählen", "Select an organisation")}
                </option>
                {organisations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field
            id="academy-account-mode"
            label={word("Einrichtungsmethode", "Setup method")}
          >
            <select
              value={mode}
              onChange={(event) =>
                setMode(event.target.value === "invite" ? "invite" : "password")
              }
            >
              <option value="invite">
                {word("Einladung per E-Mail", "Email invitation")}
              </option>
              <option value="password">
                {word(
                  "Mit Startpasswort anlegen",
                  "Create with a temporary password",
                )}
              </option>
            </select>
          </Field>
          {mode === "password" && (
            <Field
              id="academy-account-password"
              label={word("Startpasswort", "Temporary password")}
              hint={word(
                "Mindestens 8 Zeichen mit Großbuchstaben, Kleinbuchstaben, Ziffern und Sonderzeichen.",
                "At least 8 characters with upper and lower case letters, numbers and symbols.",
              )}
            >
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
              />
            </Field>
          )}
          <Button
            type="submit"
            disabled={requiresOrganisation && organisations.length === 0}
          >
            {mode === "invite"
              ? word("Einladung senden", "Send invitation")
              : word("Konto anlegen", "Create account")}
          </Button>
        </fieldset>
      </form>
      {result && (
        <Notice kind={result.kind === "error" ? "error" : undefined}>
          {result.message}
        </Notice>
      )}
    </section>
  );
}

function MemberRow({
  actor,
  account,
  organisations,
  canManageRoles,
  word,
  changed,
}: {
  actor: string;
  account: AcademyManagedAccount;
  organisations: AcademyAdministration["organisations"];
  canManageRoles: boolean;
  word: Localize;
  changed: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const roleLabels = {
    lecturer: word("Lehrende", "Instructor"),
    participant: word("Teilnehmende", "Learner"),
    client: word("Unternehmenskontakt", "Company contact"),
    management: word("Kursmanagement", "Course manager"),
  };
  const statusLabel = !account.active
    ? word("Inaktiv", "Inactive")
    : account.confirmed
      ? word("Bestätigt", "Confirmed")
      : word("Bestätigung ausstehend", "Confirmation pending");
  const activeAction = account.active
    ? word("Konto sperren", "Suspend account")
    : word("Konto reaktivieren", "Reactivate account");
  const managementAction = account.management_delegated
    ? word("Managementrechte entziehen", "Withdraw management rights")
    : word("Managementrechte vergeben", "Grant management rights");

  async function change(action: "active" | "management") {
    if (busy) return;
    setBusy(true);
    setResult(undefined);
    try {
      if (action === "active")
        await setAcademyMemberActive(account, !account.active);
      else await setAcademyManagement(account, !account.management_delegated);
      await changed();
      setResult({
        kind: "ok",
        message: word("Konto aktualisiert.", "Account updated."),
      });
    } catch (error) {
      setResult({ kind: "error", message: failure(error, word) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <p>
        {account.display_name} · {roleLabels[account.role]} · {statusLabel}
      </p>
      {account.can_set_active && (
        <Button
          variant="secondary"
          disabled={busy}
          aria-label={activeAction + " · " + account.display_name}
          onClick={() => void change("active")}
        >
          {activeAction}
        </Button>
      )}
      {account.can_set_management && (
        <Button
          variant="secondary"
          disabled={busy}
          aria-label={managementAction + " · " + account.display_name}
          onClick={() => void change("management")}
        >
          {managementAction}
        </Button>
      )}
      {canManageRoles && (
        <AcademyRoleEditor
          actor={actor}
          accountId={account.id}
          organisations={organisations}
          word={word}
          roleLabel={(role) => roleLabels[role]}
          explainError={(error) => failure(error, word)}
          changed={changed}
        />
      )}
      {result && (
        <Notice kind={result.kind === "error" ? "error" : undefined}>
          {result.message}
        </Notice>
      )}
    </li>
  );
}

export function AcademyAdministrationPage() {
  const { session } = useAuth();
  const { i18n } = useTranslation();
  const online = useOnline();
  const actor = session?.user.id ?? "";
  const cache = useQueryClient();
  const word: Localize = (de, en) => (i18n.language.startsWith("de") ? de : en);
  const query = useQuery({
    ...academyAdministrationQuery(actor),
    enabled: Boolean(actor && online),
  });

  if (!online)
    return (
      <Notice>
        {word(
          "Verbinde dich mit dem Internet, um die Verwaltung zu öffnen.",
          "Connect to the internet to open administration.",
        )}
      </Notice>
    );
  if (query.isPending || (query.isFetching && !query.isFetchedAfterMount))
    return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data)
    return (
      <Notice kind="error">
        {word(
          "Diese Verwaltung ist für dein Konto nicht verfügbar.",
          "Administration is unavailable to your account.",
        )}
      </Notice>
    );

  const { accounts, organisations, can_write, can_create_management } =
    query.data;
  const changed = () =>
    Promise.all([
      query.refetch(),
      cache.invalidateQueries({
        queryKey: academyLicenceQuery(actor).queryKey,
      }),
      cache.invalidateQueries({ queryKey: ["academy-member-roles", actor] }),
    ]);

  return (
    <>
      <PageHeading
        title={word("Akademie verwalten", "Academy administration")}
      />
      <AcademyLicencePanel actor={actor} />
      {can_create_management && (
        <>
          <AcademyBrandEditor />
          <AcademyBrandLinksEditor />
        </>
      )}
      {can_create_management && organisations.length > 0 && (
        <AcademyWebhookPanel actor={actor} organisations={organisations} />
      )}
      {can_write ? (
        <>
          <OrganisationForm word={word} changed={changed} />
          <AccountForm
            key={String(can_create_management)}
            organisations={organisations}
            canCreateManagement={can_create_management}
            word={word}
            changed={changed}
          />
        </>
      ) : (
        <Notice>
          {word(
            "Organisationen und Konten sind derzeit nur lesbar.",
            "Organisations and accounts are currently read-only.",
          )}
        </Notice>
      )}
      <section className="panel">
        <h2>{word("Organisationen", "Organisations")}</h2>
        {organisations.length === 0 ? (
          <p>
            {word(
              "Es sind noch keine Organisationen vorhanden.",
              "No organisations yet.",
            )}
          </p>
        ) : (
          <ul>
            {organisations.map((item) => (
              <li key={item.id}>
                {item.name} · {item.time_zone}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <h2>{word("Akademiekonten", "Academy accounts")}</h2>
        {accounts.length === 0 ? (
          <p>
            {word(
              "Es gibt noch keine Akademiekonten.",
              "No academy accounts yet.",
            )}
          </p>
        ) : (
          <ul>
            {accounts.map((account) => (
              <MemberRow
                key={account.id}
                actor={actor}
                account={account}
                organisations={organisations}
                canManageRoles={can_create_management}
                word={word}
                changed={changed}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
