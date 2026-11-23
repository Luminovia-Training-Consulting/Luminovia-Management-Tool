import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { TimeZoneOptions } from "../../components/time-zone-options";
import { Button } from "../../components/ui/button";
import { saveBlob } from "../../lib/blob-download";
import { requireOnline, useOnline } from "../../lib/online";
import { profileQuery, userRolesQuery } from "../../lib/queries";
import {
  accountRequest,
  type AccountList,
  accountMemberships,
  accountOrganisationsQuery,
} from "../accounts/api";
import { useAuth } from "../auth/auth-context";
import {
  academyCustomerDraftSchema,
  type AcademyCustomerDraft,
} from "../branding/academy-customer-draft-schema";

type Word = (de: string, en: string) => string;
type Company = { id: string; name: string };

export function WhiteLabelSetupPage() {
  const { session } = useAuth();
  const { i18n } = useTranslation();
  const actor = session!.user.id;
  const online = useOnline();
  const roles = useQuery(userRolesQuery(actor));
  const profile = useQuery(profileQuery(actor));
  const [preparing, setPreparing] = useState(false);
  const word: Word = (de, en) => (i18n.language.startsWith("de") ? de : en);
  const isAdministrator =
    profile.data?.active &&
    roles.data?.some((role) => role === "admin" || role === "owner");
  const companies = useQuery({
    ...accountOrganisationsQuery(actor),
    enabled: Boolean(isAdministrator && preparing && online),
  });

  if (!online)
    return (
      <Notice>
        {word(
          "Verbinde dich mit dem Internet, um die White-Label-Einrichtung zu öffnen.",
          "Connect to the internet to open White Label setup.",
        )}
      </Notice>
    );
  if (roles.isPending || profile.isPending) return <Loading />;
  if (roles.isError || profile.isError)
    return (
      <ErrorState
        retry={() => void Promise.all([roles.refetch(), profile.refetch()])}
      />
    );
  if (!isAdministrator)
    return (
      <Notice kind="error">
        {word(
          "Die White-Label-Einrichtung ist nur für aktive Administratoren und Owner verfügbar.",
          "White Label setup is available to active administrators and owners only.",
        )}
      </Notice>
    );

  return (
    <>
      <PageHeading
        title="White Label"
        description={word(
          "Bereite eine eigenständige Akademie mit Premium LMS, eigener Domain und eigener Verwaltung vor.",
          "Prepare a dedicated academy with Premium LMS, its own domain and its own administration.",
        )}
      />
      <section className="panel">
        <h2>{word("Kundeninstallation", "Customer installation")}</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            role="switch"
            checked={preparing}
            onChange={(event) => setPreparing(event.target.checked)}
          />
          {word("White-Label-Einrichtung öffnen", "Open White Label setup")}
        </label>
        <p className="muted">
          {word(
            "Für eine neue Installation erhält der Betreiber den signierten Übergang und richtet das erste Administratorkonto ein. Öffne für Änderungen an einer laufenden Kundeninstallation die White-Label-Einrichtung direkt in deren Verwaltung.",
            "For a new installation, the operator receives the signed handoff and creates the first administrator. To change a running customer installation, open White Label setup in that installation’s administration.",
          )}
        </p>
      </section>
      {preparing &&
        (companies.isError ? (
          <ErrorState retry={() => void companies.refetch()} />
        ) : companies.isPending ? (
          <Loading />
        ) : companies.data.length ? (
          <WhiteLabelDraftForm
            key={actor}
            companies={companies.data}
            word={word}
          />
        ) : (
          <Notice>
            {word(
              "Lege zuerst ein Unternehmen und ein aktives Unternehmens­konto an.",
              "Create a company and an active company account first.",
            )}
          </Notice>
        ))}
    </>
  );
}

function WhiteLabelDraftForm({
  companies,
  word,
}: {
  companies: Company[];
  word: Word;
}) {
  const [companyId, setCompanyId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [errors, setErrors] = useState<string[]>([]);
  const [exported, setExported] = useState(false);
  const requestId = useRef<string | undefined>(undefined);
  const mutation = useMutation({
    mutationFn: async ({
      company,
      draft,
    }: {
      company: Company;
      draft: AcademyCustomerDraft;
    }) => {
      requireOnline();
      const email = draft.initial_administrator.email;
      const search = encodeURIComponent(email.slice(0, 120));
      let offset = 0;
      let account;
      do {
        const page = await accountRequest<AccountList>(
          `users?q=${search}&limit=100&offset=${offset}`,
        );
        account = page.items.find(
          (person) =>
            person.email.toLowerCase() === email &&
            person.active &&
            person.roles.includes("client"),
        );
        offset += page.items.length;
        if (account || !page.items.length || offset >= page.total) break;
      } while (offset <= 100_000);
      if (!account) throw new Error("company_administrator");
      const memberships = await accountMemberships(account.id);
      if (!memberships.some((entry) => entry.organisation_id === company.id))
        throw new Error("company_administrator");
      return draft;
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    const company = companies.find(({ id }) => id === companyId);
    if (!company) return;
    setExported(false);
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();
    requestId.current ??= crypto.randomUUID();
    const parsed = academyCustomerDraftSchema.safeParse({
      version: 1,
      request_id: requestId.current,
      purpose: "customer",
      legal_customer_name: field("legal_customer_name"),
      branding: {
        name: field("branding.name"),
        short_name: field("branding.short_name"),
        theme: field("branding.theme"),
        theme_color: field("branding.theme_color"),
        approved_assets_reference: field("branding.approved_assets_reference"),
      },
      initial_administrator: {
        email: field("initial_administrator.email"),
        username: field("initial_administrator.username") || null,
      },
      target: {
        edition: field("target.edition"),
        portal_origin: field("target.portal_origin"),
        domain_status: field("target.domain_status"),
        runtime_directory: field("target.runtime_directory"),
        host_reference: field("target.host_reference"),
        data_region: field("target.data_region"),
        tls: field("target.tls"),
      },
      preferences: {
        locale: field("preferences.locale"),
        time_zone: field("preferences.time_zone"),
      },
      smtp_mode: field("smtp_mode"),
      backup_retention_days: Number(field("backup_retention_days")),
      support: {
        agreement_reference: field("support.agreement_reference"),
        contact_email: field("support.contact_email"),
      },
      licence: {
        release_commit: field("licence.release_commit"),
        limits: {
          seat_count: Number(field("licence.limits.seat_count")),
          storage_bytes: Number(field("licence.limits.storage_bytes")),
          api_requests_per_minute: Number(
            field("licence.limits.api_requests_per_minute"),
          ),
        },
      },
    });
    setErrors(
      parsed.success
        ? []
        : parsed.error.issues.map(({ path }) => path.join(".")),
    );
    mutation.reset();
    if (!parsed.success) return;
    mutation.mutate(
      { company, draft: parsed.data },
      {
        onSuccess: (draft) => {
          saveBlob(
            new Blob([JSON.stringify(draft, null, 2) + "\n"], {
              type: "application/json",
            }),
            "academy-customer-draft.json",
          );
          setExported(true);
        },
      },
    );
  }

  return (
    <section className="panel">
      <h2>
        {word("Privater Installationsentwurf", "Private installation draft")}
      </h2>
      <form
        className="white-label-draft"
        onSubmit={submit}
        onChange={() => {
          requestId.current = undefined;
          setExported(false);
          if (mutation.isError) mutation.reset();
        }}
      >
        <fieldset disabled={mutation.isPending}>
          <legend>
            {word("Unternehmen und Branding", "Company and branding")}
          </legend>
          <Field
            id="white-label-company"
            label={word("Unternehmen", "Company")}
          >
            <select
              required
              value={companyId}
              onChange={(event) => {
                const id = event.target.value;
                setCompanyId(id);
                setCustomerName(
                  companies.find((company) => company.id === id)?.name ?? "",
                );
              }}
            >
              <option value="">
                {word("Unternehmen auswählen", "Select a company")}
              </option>
              {companies.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="white-label-legal-customer-name"
            label={word("Rechtlicher Firmenname", "Legal company name")}
            error={errors.includes("legal_customer_name")}
          >
            <input
              name="legal_customer_name"
              required
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
            />
          </Field>
          <div className="form-row">
            <DraftField
              name="initial_administrator.email"
              label={word("E-Mail des Firmenkontos", "Company account email")}
              type="email"
              hint={word(
                "Der Betreiber verwendet diese aktive Firmenadresse für das erste Administratorkonto.",
                "The operator uses this active company email for the first administrator.",
              )}
              errors={errors}
            />
            <DraftField
              name="initial_administrator.username"
              label={word(
                "Benutzername in der Akademie (optional)",
                "Academy username (optional)",
              )}
              required={false}
              maxLength={32}
              errors={errors}
            />
          </div>
          <div className="form-row">
            <DraftField
              name="branding.name"
              label={word("Name der Akademie", "Academy name")}
              maxLength={72}
              errors={errors}
            />
            <DraftField
              name="branding.short_name"
              label={word("Kurzname", "Short name")}
              maxLength={20}
              errors={errors}
            />
          </div>
          <div className="form-row">
            <DraftSelect
              name="branding.theme"
              label={word("Standarddarstellung", "Default appearance")}
              options={[
                ["system", word("Systemeinstellung", "System preference")],
                ["light", word("Hell", "Light")],
                ["dark", word("Dunkel", "Dark")],
              ]}
              errors={errors}
            />
            <DraftField
              name="branding.theme_color"
              label={word("Akzentfarbe", "Accent colour")}
              type="color"
              defaultValue="#172b4b"
              errors={errors}
            />
          </div>
          <DraftField
            name="branding.approved_assets_reference"
            label={word(
              "Referenz für geprüfte Logos und Icons",
              "Approved logo and icon reference",
            )}
            maxLength={120}
            errors={errors}
          />
        </fieldset>
        <fieldset disabled={mutation.isPending}>
          <legend>{word("Domain und Betrieb", "Domain and operations")}</legend>
          <div className="form-row">
            <DraftSelect
              name="target.edition"
              label={word("Betriebsmodell", "Operating model")}
              options={[
                [
                  "customer-self-hosted",
                  word("Kundenseitig selbst gehostet", "Customer self-hosted"),
                ],
                [
                  "customer-managed",
                  word(
                    "Betreute Einzelinstallation",
                    "Managed dedicated installation",
                  ),
                ],
              ]}
              errors={errors}
            />
            <DraftField
              name="target.portal_origin"
              label={word(
                "HTTPS-Adresse der Akademie",
                "Academy HTTPS address",
              )}
              type="url"
              errors={errors}
            />
          </div>
          <div className="form-row">
            <DraftSelect
              name="target.domain_status"
              label={word("Domainprüfung", "Domain verification")}
              options={[
                [
                  "temporary-pending",
                  word("Prüfung ausstehend", "Verification pending"),
                ],
                [
                  "verified-by-operator",
                  word("Vom Betreiber geprüft", "Verified by operator"),
                ],
              ]}
              errors={errors}
            />
            <DraftField
              name="target.runtime_directory"
              label={word("Installationsverzeichnis", "Installation directory")}
              placeholder="/opt/academies/customer"
              errors={errors}
            />
          </div>
          <div className="form-row">
            <DraftField
              name="target.host_reference"
              label={word("Serverreferenz", "Host reference")}
              errors={errors}
            />
            <DraftField
              name="target.data_region"
              label={word("Datenregion", "Data region")}
              placeholder="eu-central"
              errors={errors}
            />
          </div>
          <div className="form-row">
            <DraftSelect
              name="target.tls"
              label="TLS"
              options={[
                ["acme", word("Automatisch über ACME", "Automatic via ACME")],
                [
                  "operator-terminated",
                  word("Über externen Reverse Proxy", "External reverse proxy"),
                ],
              ]}
              errors={errors}
            />
            <DraftSelect
              name="preferences.locale"
              label={word("Standardsprache", "Default language")}
              options={
                word("de", "en") === "de"
                  ? [
                      ["de", "Deutsch"],
                      ["en", "English"],
                    ]
                  : [
                      ["en", "English"],
                      ["de", "Deutsch"],
                    ]
              }
              errors={errors}
            />
          </div>
          <Field
            id="white-label-time-zone"
            label={word("Zeitzone", "Time zone")}
            error={errors.includes("preferences.time_zone")}
          >
            <select name="preferences.time_zone" defaultValue={timeZone}>
              <TimeZoneOptions current={timeZone} />
            </select>
          </Field>
          <div className="form-row">
            <DraftSelect
              name="smtp_mode"
              label={word("Mailbetrieb", "Mail delivery")}
              options={[
                ["provider", word("Externer Anbieter", "External provider")],
                ["capture", word("Lokales Testpostfach", "Local test inbox")],
              ]}
              errors={errors}
            />
            <DraftField
              name="backup_retention_days"
              label={word(
                "Backup-Aufbewahrung in Tagen",
                "Backup retention in days",
              )}
              type="number"
              defaultValue="30"
              errors={errors}
            />
          </div>
        </fieldset>
        <fieldset disabled={mutation.isPending}>
          <legend>{word("Vertrag und Lizenz", "Agreement and licence")}</legend>
          <div className="form-row">
            <DraftField
              name="support.agreement_reference"
              label={word("Vertragsreferenz", "Agreement reference")}
              errors={errors}
            />
            <DraftField
              name="support.contact_email"
              label={word("Support-E-Mail", "Support email")}
              type="email"
              errors={errors}
            />
          </div>
          <DraftField
            name="licence.release_commit"
            label={word(
              "Geprüfter Git-Commit (SHA)",
              "Reviewed Git commit (SHA)",
            )}
            maxLength={40}
            errors={errors}
          />
          <div className="form-row">
            <DraftField
              name="licence.limits.seat_count"
              label={word("Kontoplätze", "Account seats")}
              type="number"
              errors={errors}
            />
            <DraftField
              name="licence.limits.storage_bytes"
              label={word("Speicherlimit in Byte", "Storage limit in bytes")}
              type="number"
              errors={errors}
            />
            <DraftField
              name="licence.limits.api_requests_per_minute"
              label={word("API-Anfragen pro Minute", "API requests per minute")}
              type="number"
              errors={errors}
            />
          </div>
        </fieldset>
        {errors.length > 0 && (
          <Notice kind="error">
            {word(
              "Prüfe die markierten Eingaben.",
              "Check the highlighted fields.",
            )}
          </Notice>
        )}
        {mutation.isError && (
          <Notice kind="error">
            {mutation.error.message === "company_administrator"
              ? word(
                  "Die Adresse muss zu einem aktiven Firmenkonto dieses Unternehmens gehören.",
                  "The address must belong to an active company account at this company.",
                )
              : word(
                  "Das Firmenkonto konnte nicht geprüft werden. Versuche es erneut.",
                  "The company account could not be verified. Try again.",
                )}
          </Notice>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? word("Firmenkonto wird geprüft …", "Verifying company account…")
            : word("Privaten Entwurf herunterladen", "Download private draft")}
        </Button>
        {exported && (
          <Notice>
            {word(
              "Entwurf exportiert. Lege die JSON-Datei im privaten Betreiberverzeichnis ab und prüfe sie vor der Signatur mit dem Academy-Installationswerkzeug.",
              "Draft exported. Store the JSON file in the private operator directory and review it with the Academy installation tool before signing.",
            )}
          </Notice>
        )}
      </form>
    </section>
  );
}

type DraftFieldProps = {
  name: string;
  label: string;
  errors: string[];
};

function DraftField({
  name,
  label,
  errors,
  type = "text",
  required = true,
  defaultValue,
  maxLength,
  placeholder,
  hint,
}: DraftFieldProps & {
  type?: "text" | "email" | "url" | "color" | "number";
  required?: boolean;
  defaultValue?: string;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <Field
      id={"white-label-" + name.replaceAll(".", "-")}
      label={label}
      error={errors.includes(name)}
      hint={hint}
    >
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        maxLength={maxLength}
        placeholder={placeholder}
        min={type === "number" ? 1 : undefined}
      />
    </Field>
  );
}

function DraftSelect({
  name,
  label,
  errors,
  options,
}: DraftFieldProps & { options: [string, string][] }) {
  return (
    <Field
      id={"white-label-" + name.replaceAll(".", "-")}
      label={label}
      error={errors.includes(name)}
    >
      <select name={name}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}
