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
import { requireOnline, useOnline } from "../../lib/online";
import { profileQuery, userRolesQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { accountOrganisationsQuery } from "../accounts/api";
import { z } from "zod";
import { useAuth } from "../auth/auth-context";
import {
  academyCustomerDraftSchema,
  type AcademyCustomerDraft,
} from "../branding/academy-customer-draft-schema";

type Word = (de: string, en: string) => string;
type Company = { id: string; name: string };
const receiptSchema = z.object({
  revision: z.int().nonnegative(),
  settings: academyCustomerDraftSchema.nullable(),
});

async function customerSetup(
  organisationId: string,
  change?: { revision: number; settings: AcademyCustomerDraft },
) {
  requireOnline();
  const { data, error } = await db().rpc("academy_customer_setup", {
    p_organisation_id: organisationId,
    ...(change && {
      p_expected_revision: change.revision,
      p_settings: change.settings,
    }),
  });
  if (error) throw error;
  return receiptSchema.parse(data);
}

function CompanySettings({
  actor,
  company,
  word,
}: {
  actor: string;
  company: Company;
  word: Word;
}) {
  const settings = useQuery({
    queryKey: ["academy-customer-setup", actor, company.id],
    queryFn: () => customerSetup(company.id),
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  if (settings.isPending) return <Loading />;
  if (settings.isError)
    return <ErrorState retry={() => void settings.refetch()} />;
  return (
    <WhiteLabelSettingsForm
      key={`${company.id}:${settings.data.revision}`}
      company={company}
      initial={settings.data}
      word={word}
      reload={() => void settings.refetch()}
    />
  );
}

export function WhiteLabelSetupPage() {
  const { session } = useAuth();
  const { i18n } = useTranslation();
  const actor = session!.user.id;
  const online = useOnline();
  const roles = useQuery(userRolesQuery(actor));
  const profile = useQuery(profileQuery(actor));
  const [preparing, setPreparing] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const word: Word = (de, en) => (i18n.language.startsWith("de") ? de : en);
  const isAdministrator =
    profile.data?.active &&
    roles.data?.some((role) => role === "admin" || role === "owner");
  const companies = useQuery({
    ...accountOrganisationsQuery(actor),
    enabled: Boolean(isAdministrator && preparing && online),
  });

  const company = companies.data?.find(({ id }) => id === companyId);

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
          "Bereite eine eigenständige Akademie mit eigener Domain, eigener Verwaltung und dem gebuchten LMS-Paket vor.",
          "Prepare a dedicated academy with its own domain, administration, and selected LMS package.",
        )}
      />
      <div className="section-stack">
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
              "Speichere die Einstellungen beim Unternehmen. Eine laufende Akademie übernimmt Änderungen am Auftritt direkt in ihrer eigenen Verwaltung.",
              "Save the settings against the company. A running academy applies branding changes directly in its own administration.",
            )}
          </p>
        </section>
        {preparing &&
          (companies.isError ? (
            <ErrorState retry={() => void companies.refetch()} />
          ) : companies.isPending ? (
            <Loading />
          ) : companies.data.length ? (
            <section className="panel">
              <Field
                id="white-label-company"
                label={word("Unternehmen", "Company")}
              >
                <select
                  value={companyId}
                  onChange={(event) => setCompanyId(event.target.value)}
                >
                  <option value="">
                    {word("Unternehmen auswählen", "Select a company")}
                  </option>
                  {companies.data.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              {company && (
                <CompanySettings
                  key={company.id}
                  actor={actor}
                  company={company}
                  word={word}
                />
              )}
            </section>
          ) : (
            <Notice>
              {word(
                "Lege zuerst ein Unternehmen und ein aktives Unternehmens­konto an.",
                "Create a company and an active company account first.",
              )}
            </Notice>
          ))}
      </div>
    </>
  );
}

function WhiteLabelSettingsForm({
  company,
  initial,
  word,
  reload,
}: {
  company: Company;
  initial: z.infer<typeof receiptSchema>;
  word: Word;
  reload: () => void;
}) {
  const [confirmed, setConfirmed] = useState(initial);
  const saved = initial.settings;
  const timeZone =
    saved?.preferences.time_zone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [errors, setErrors] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [packageChosen, setPackageChosen] = useState(
    Boolean(saved?.licence.lms_package),
  );
  const requestId = useRef<string | undefined>(saved?.request_id);
  const mutation = useMutation({
    mutationFn: (settings: AcademyCustomerDraft) =>
      customerSetup(company.id, { revision: confirmed.revision, settings }),
    onSuccess: (receipt) => {
      setConfirmed(receipt);
      setApplied(true);
    },
  });
  const liveOrigin =
    confirmed.settings?.target.domain_status === "verified-by-operator"
      ? confirmed.settings.target.portal_origin
      : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    setApplied(false);
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
        ...(packageChosen || field("licence.lms_package") !== "premium"
          ? { lms_package: field("licence.lms_package") }
          : {}),
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
    mutation.mutate(parsed.data);
  }

  return (
    <section>
      <h2>
        {word(
          "Einstellungen der Kundeninstallation",
          "Customer installation settings",
        )}
      </h2>
      <p className="muted">
        {word(
          "Domain, TLS, Datenregion und Lizenz werden beim Unternehmen gespeichert. Der Betreiber übernimmt diese Angaben bei der Einrichtung der eigenständigen Installation.",
          "Domain, TLS, data region and licence are saved against the company. The operator applies them when setting up the independent installation.",
        )}
      </p>
      {liveOrigin && (
        <a href={liveOrigin + "/administration"} rel="noreferrer">
          {word("Kundeninstallation öffnen", "Open customer installation")}
        </a>
      )}
      <form
        className="white-label-draft"
        onSubmit={submit}
        onChange={() => {
          requestId.current = undefined;
          setApplied(false);
          if (mutation.isError) mutation.reset();
        }}
      >
        <fieldset disabled={mutation.isPending}>
          <legend>
            {word("Unternehmen und Branding", "Company and branding")}
          </legend>
          <Field
            id="white-label-legal-customer-name"
            label={word("Rechtlicher Firmenname", "Legal company name")}
            error={errors.includes("legal_customer_name")}
          >
            <input
              name="legal_customer_name"
              required
              defaultValue={saved?.legal_customer_name ?? company.name}
            />
          </Field>
          <DraftField
            name="initial_administrator.email"
            defaultValue={saved?.initial_administrator.email}
            label={word("E-Mail des Firmenkontos", "Company account email")}
            type="email"
            hint={word(
              "Der Betreiber verwendet diese aktive Firmenadresse für das erste Administratorkonto.",
              "The operator uses this active company email for the first administrator.",
            )}
            errors={errors}
          />
          <div className="form-row">
            <DraftField
              name="branding.name"
              defaultValue={saved?.branding.name}
              label={word("Name der Akademie", "Academy name")}
              maxLength={72}
              errors={errors}
            />
            <DraftField
              name="branding.short_name"
              defaultValue={saved?.branding.short_name}
              label={word("Kurzname", "Short name")}
              maxLength={20}
              errors={errors}
            />
          </div>
          <div className="form-row">
            <DraftSelect
              name="branding.theme"
              defaultValue={saved?.branding.theme}
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
              defaultValue={saved?.branding.theme_color ?? "#172b4b"}
              errors={errors}
            />
          </div>
          <DraftField
            name="branding.approved_assets_reference"
            defaultValue={saved?.branding.approved_assets_reference}
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
              defaultValue={saved?.target.edition}
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
              defaultValue={saved?.target.portal_origin}
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
              defaultValue={saved?.target.domain_status}
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
              defaultValue={saved?.target.runtime_directory}
              label={word("Installationsverzeichnis", "Installation directory")}
              placeholder="/opt/academies/customer"
              errors={errors}
            />
          </div>
          <div className="form-row">
            <DraftField
              name="target.host_reference"
              defaultValue={saved?.target.host_reference}
              label={word("Serverreferenz", "Host reference")}
              errors={errors}
            />
            <DraftField
              name="target.data_region"
              defaultValue={saved?.target.data_region}
              label={word("Datenregion", "Data region")}
              placeholder="eu-central"
              errors={errors}
            />
          </div>
          <div className="form-row">
            <DraftSelect
              name="target.tls"
              defaultValue={saved?.target.tls}
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
              defaultValue={saved?.preferences.locale}
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
              defaultValue={saved?.smtp_mode}
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
              defaultValue={saved?.backup_retention_days.toString() ?? "30"}
              errors={errors}
            />
          </div>
        </fieldset>
        <fieldset disabled={mutation.isPending}>
          <legend>{word("Vertrag und Lizenz", "Agreement and licence")}</legend>
          <DraftSelect
            name="licence.lms_package"
            defaultValue={saved?.licence.lms_package ?? "premium"}
            label={word("LMS-Paket", "LMS package")}
            options={[
              ["standard", "Standard LMS"],
              ["premium", "Premium LMS"],
            ]}
            hint={word(
              "Das Paket gilt für die erste signierte Lizenz. Für eine laufende Academy ändert der Betreiber das Paket mit einer neuen signierten Lizenz.",
              "The package applies to the first signed licence. The operator changes the package for a running Academy with a new signed licence.",
            )}
            onChange={() => setPackageChosen(true)}
            errors={errors}
          />
          <div className="form-row">
            <DraftField
              name="support.agreement_reference"
              defaultValue={saved?.support.agreement_reference}
              label={word("Vertragsreferenz", "Agreement reference")}
              errors={errors}
            />
            <DraftField
              name="support.contact_email"
              defaultValue={saved?.support.contact_email}
              label={word("Support-E-Mail", "Support email")}
              type="email"
              errors={errors}
            />
          </div>
          <DraftField
            name="licence.release_commit"
            defaultValue={saved?.licence.release_commit}
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
              defaultValue={saved?.licence.limits.seat_count.toString()}
              label={word("Kontoplätze", "Account seats")}
              type="number"
              errors={errors}
            />
            <DraftField
              name="licence.limits.storage_bytes"
              defaultValue={saved?.licence.limits.storage_bytes.toString()}
              label={word("Speicherlimit in Byte", "Storage limit in bytes")}
              type="number"
              errors={errors}
            />
            <DraftField
              name="licence.limits.api_requests_per_minute"
              defaultValue={saved?.licence.limits.api_requests_per_minute.toString()}
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
              : mutation.error.message === "white_label_revision_changed"
                ? word(
                    "Die Einstellungen wurden inzwischen geändert.",
                    "The settings have changed since you opened them.",
                  )
                : word(
                    "Die Einstellungen konnten nicht gespeichert werden.",
                    "The settings could not be saved.",
                  )}
            {mutation.error.message === "white_label_revision_changed" && (
              <Button type="button" variant="secondary" onClick={reload}>
                {word("Aktuelle Einstellungen laden", "Load current settings")}
              </Button>
            )}
          </Notice>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? word("Einstellungen werden gespeichert …", "Saving settings…")
            : word("Einstellungen speichern", "Save settings")}
        </Button>
        {applied && (
          <Notice>
            {word("Einstellungen gespeichert.", "Settings saved.")}
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
  defaultValue,
  hint,
  onChange,
}: DraftFieldProps & {
  options: [string, string][];
  defaultValue?: string;
  hint?: string;
  onChange?: () => void;
}) {
  return (
    <Field
      id={"white-label-" + name.replaceAll(".", "-")}
      label={label}
      error={errors.includes(name)}
      hint={hint}
    >
      <select name={name} defaultValue={defaultValue} onChange={onChange}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}
