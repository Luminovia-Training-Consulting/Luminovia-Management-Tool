import { PermanentDeleteAction } from "../deletions/deletions";
/**
 * Customer directory with authorized contacts, internal notes and organization settings. Shared
 * metadata and private business fields keep their separate table permissions.
 */
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Building2, Mail, Phone, Plus } from "lucide-react";
import "./i18n";
import "./styles.css";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery, userRolesQuery } from "../../lib/queries";
import { validZone } from "../../lib/dates";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { TableImport } from "../../components/table-import";
import { importTableRow } from "../../components/table-import-api";
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
  companyPremiumSettingsQuery,
  type Contact,
  contactsQuery,
  notesQuery,
  type Organisation,
  orgQuery,
} from "./data";
import { CompanyDispatchSettings } from "./company-dispatch-settings";
import { CompanyPremiumControl } from "./company-premium";
import { CompanyLecturerBlocks } from "./company-lecturer-blocks";
import { CompanyIntegrations } from "./company-integrations";
import { CompanyParticipantsPanel } from "./company-participants";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const orgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.string().max(100),
  time_zone: z.string().refine(validZone),
  industry: z.string().max(120),
  city: z.string().max(120),
  tags: z.string().max(1200),
  private_notes: z.string().max(8000),
  archived: z.boolean(),
});
/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  position: z.string().max(120),
  email: z.union([z.email(), z.literal("")]),
  phone: z.string().max(50),
  notes: z.string().max(4000),
  archived: z.boolean(),
});

function organisationPayload(values: z.infer<typeof orgSchema>) {
  return {
    ...values,
    tags: values.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

async function saveOrganisation(
  values: z.infer<typeof orgSchema>,
  id: string | null,
  premiumRequestId?: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_organisation", {
    p_id: id,
    p_payload: {
      ...organisationPayload(values),
      ...(premiumRequestId ? { premium_request_id: premiumRequestId } : {}),
    },
  });
  if (error) throw error;
  return data as string;
}

async function saveContact(
  values: z.infer<typeof contactSchema>,
  organisation: string,
  id: string | null,
) {
  requireOnline();
  const { error } = await db().rpc("save_organisation_contact", {
    p_id: id,
    p_organisation_id: organisation,
    p_payload: values,
  });
  if (error) throw error;
}

/** Validate organization metadata and await the owning create/update RPC. */
function OrganisationForm({
  original,
  notes,
  canEnablePremium,
  onDone,
}: {
  original?: Organisation;
  notes: string;
  canEnablePremium: boolean;
  onDone: (id: string) => void;
}) {
  const { t } = useTranslation("operations");
  const client = useQueryClient();
  const online = useOnline();
  const showPremium = canEnablePremium && !original;
  const [premium, setPremium] = useState(false);
  const premiumRequest = useRef<string | undefined>(undefined);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<z.infer<typeof orgSchema>>({
    resolver: zodResolver(orgSchema),
    defaultValues: {
      name: original?.name ?? "",
      country: original?.country ?? "",
      time_zone: original?.time_zone ?? "Europe/Berlin",
      industry: original?.industry ?? "",
      city: original?.city ?? "",
      tags: original?.tags.join(", ") ?? "",
      private_notes: notes,
      archived: Boolean(original?.archived_at),
    },
  });
  const archived = useWatch({ control, name: "archived" });
  const save = useMutation({
    mutationFn: (values: z.infer<typeof orgSchema>) => {
      if (showPremium && premium && !values.archived) {
        premiumRequest.current ??= crypto.randomUUID();
        return saveOrganisation(values, null, premiumRequest.current);
      }
      return saveOrganisation(values, original?.id ?? null);
    },
    onSuccess: async (id) => {
      await client.invalidateQueries({ queryKey: ["operations"] });
      onDone(id);
    },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      {(
        ["name", "country", "industry", "city", "time_zone", "tags"] as const
      ).map((key) => (
        <Field
          key={key}
          id={`org-${key}`}
          label={t(key === "time_zone" ? "timezone" : key)}
          error={Boolean(errors[key])}
        >
          <input id={`org-${key}`} {...register(key)} />
        </Field>
      ))}
      <Field
        id="org-notes"
        label={t("notes")}
        hint={t("privateHint")}
        error={Boolean(errors.private_notes)}
      >
        <textarea id="org-notes" rows={5} {...register("private_notes")} />
      </Field>
      <label className="checkbox-label">
        <input type="checkbox" {...register("archived")} />
        {t("archive")}
      </label>
      {showPremium && (
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            role="switch"
            aria-label={t("premiumSwitch")}
            aria-checked={premium && !archived}
            aria-describedby="org-premium-help"
            className={`premium-switch premium-switch-${premium && !archived ? "on" : "off"}`}
            disabled={archived || save.isPending}
            onClick={() => setPremium((enabled) => !enabled)}
          >
            <span className="premium-switch-indicator" aria-hidden="true" />
            {t(premium && !archived ? "premiumEnabled" : "premiumDisabled")}
          </Button>
          <small className="muted" id="org-premium-help">
            {t(archived ? "premiumArchived" : "premiumOnCreateHelp")}
          </small>
        </div>
      )}
      <Button disabled={!online || save.isPending}>{t("save")}</Button>
      {save.isError && <Notice kind="error">{t("error")}</Notice>}
    </form>
  );
}

/** Edit organization contacts under their existing private data permissions. */
function ContactForm({
  original,
  organisation,
  onDone,
}: {
  original?: Contact;
  organisation: string;
  onDone: () => void;
}) {
  const { t } = useTranslation("operations");
  const client = useQueryClient();
  const online = useOnline();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof contactSchema>>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: original?.name ?? "",
      position: original?.position ?? "",
      email: original?.email ?? "",
      phone: original?.phone ?? "",
      notes: original?.notes ?? "",
      archived: Boolean(original?.archived_at),
    },
  });
  const save = useMutation({
    mutationFn: (values: z.infer<typeof contactSchema>) =>
      saveContact(values, organisation, original?.id ?? null),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["operations"] }),
        client.invalidateQueries({ queryKey: ["company-class-directory"] }),
      ]);
      onDone();
    },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      {(["name", "position", "email", "phone"] as const).map((key) => (
        <Field
          key={key}
          id={`contact-${key}`}
          label={t(key)}
          error={Boolean(errors[key])}
        >
          <input
            id={`contact-${key}`}
            type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
            {...register(key)}
          />
        </Field>
      ))}
      <Field
        id="contact-notes"
        label={t("contactNotes")}
        error={Boolean(errors.notes)}
      >
        <textarea id="contact-notes" rows={4} {...register("notes")} />
      </Field>
      <label className="checkbox-label">
        <input type="checkbox" {...register("archived")} />
        {t("archive")}
      </label>
      <Button disabled={!online || save.isPending}>{t("save")}</Button>
      {save.isError && <Notice kind="error">{t("error")}</Notice>}
    </form>
  );
}

/** Compose organization details, permitted contacts and separately stored internal notes. */
function ClientWorkspace({
  actor,
  isAdmin,
  canManageIntegrations,
  canManageWebhooks,
  canSubscribeAccounting,
}: {
  actor: string;
  isAdmin: boolean;
  canManageIntegrations: boolean;
  canManageWebhooks: boolean;
  canSubscribeAccounting: boolean;
}) {
  const { t, i18n } = useTranslation("operations");
  const de = i18n.language.startsWith("de");
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["operations"] });
  const orgs = useQuery(orgQuery(actor));
  const notes = useQuery(notesQuery(actor));
  const premiums = useQuery(companyPremiumSettingsQuery(actor));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>();
  const [orgEdit, setOrgEdit] = useState<Organisation | null | undefined>();
  const [contactEdit, setContactEdit] = useState<Contact | null | undefined>();
  const [saved, setSaved] = useState(false);
  const online = useOnline();
  const visible = (orgs.data ?? []).filter((org) =>
    [org.name, org.city, org.industry, ...org.tags]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const organisation = visible.find((org) => org.id === selected) ?? visible[0];
  const contacts = useQuery(contactsQuery(actor, organisation?.id));
  if (orgs.isPending || notes.isPending || premiums.isPending)
    return <Loading />;
  if (orgs.isError || notes.isError || premiums.isError)
    return (
      <ErrorState
        retry={() => {
          void orgs.refetch();
          void notes.refetch();
          void premiums.refetch();
        }}
      />
    );
  const detail =
    notes.data.find((note) => note.organisation_id === organisation?.id)
      ?.private_notes ?? "";
  const premiumSetting = organisation
    ? (premiums.data.find(
        (setting) => setting.organisation_id === organisation.id,
      ) ?? {
        organisation_id: organisation.id,
        enabled: false,
        version: 0,
        updated_at: null,
      })
    : null;
  return (
    <>
      <PageHeading
        title={t("clients")}
        description={t("clientsIntro")}
        action={
          <Button
            onClick={() => {
              setSaved(false);
              setOrgEdit(null);
            }}
            disabled={!online}
          >
            <Plus size={18} />
            {t("newClient")}
          </Button>
        }
      />
      <TableImport
        label={de ? "Firmen importieren" : "Import companies"}
        filename="companies"
        columns={[
          "name",
          "country",
          "time_zone",
          "industry",
          "city",
          "tags",
          "private_notes",
        ]}
        example={[
          "Beispielakademie",
          "DE",
          "Europe/Berlin",
          "Training",
          "Hamburg",
          "",
          "",
        ]}
        parse={(row) => orgSchema.parse({ ...row, archived: false })}
        save={(row, key) =>
          importTableRow(key, "company", organisationPayload(row))
        }
        refresh={refresh}
      />
      {saved && <Notice>{t("saved")}</Notice>}
      <div className="operations-layout">
        <section className="panel operations-directory">
          <Field id="client-search" label={t("search")}>
            <input
              id="client-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <ul>
            {visible.map((org) => (
              <li key={org.id}>
                <button
                  className="operations-select"
                  aria-pressed={organisation?.id === org.id}
                  onClick={() => setSelected(org.id)}
                >
                  <Building2 size={19} />
                  <span>
                    {org.name}
                    {org.archived_at && <small> {t("archive")}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!visible.length && <p>{t("empty")}</p>}
        </section>
        {organisation && (
          <section key={organisation.id} className="panel operations-detail">
            <div className="section-heading">
              <h2>{organisation.name}</h2>
              <Button
                variant="secondary"
                onClick={() => {
                  setSaved(false);
                  setOrgEdit(organisation);
                }}
                disabled={!online}
              >
                {t("editClient")}
              </Button>
            </div>
            <p className="muted">
              {[
                organisation.industry,
                organisation.city,
                organisation.country,
                organisation.time_zone,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="tags">
              {organisation.tags.map((tag) => (
                <span className="badge" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <div className="section-stack company-operation-sections">
              {/* Each panel resets for a new organisation with its own sibling key. */}
              {premiumSetting && (
                <CompanyPremiumControl
                  key={`premium:${organisation.id}`}
                  actor={actor}
                  zone={organisation.time_zone}
                  setting={premiumSetting}
                  isAdmin={isAdmin}
                  archived={Boolean(organisation.archived_at)}
                />
              )}
              {!organisation.archived_at && (
                <CompanyDispatchSettings
                  actor={actor}
                  organisations={[organisation]}
                />
              )}
              {!organisation.archived_at && (
                <CompanyLecturerBlocks
                  key={`lecturer-blocks:${organisation.id}`}
                  actor={actor}
                  organisations={[organisation]}
                />
              )}
              {canManageIntegrations && (
                <CompanyIntegrations
                  key={`integrations:${organisation.id}`}
                  actor={actor}
                  organisation={organisation.id}
                  archived={Boolean(organisation.archived_at)}
                  zone={organisation.time_zone}
                  canSubscribePremium={
                    isAdmin && Boolean(premiumSetting?.enabled)
                  }
                  canSubscribeAccounting={canSubscribeAccounting}
                  showWebhooks={canManageWebhooks}
                />
              )}
              {premiumSetting?.enabled && (
                <CompanyParticipantsPanel
                  actor={actor}
                  organisationId={organisation.id}
                />
              )}
            </div>
            <h3>{t("notes")}</h3>
            <p className="preserve-text">{detail || "—"}</p>
            <small className="muted">{t("privateHint")}</small>
            <div className="section-heading">
              <h3>{t("contacts")}</h3>
              <Button
                variant="secondary"
                onClick={() => setContactEdit(null)}
                disabled={!online}
              >
                {t("newContact")}
              </Button>
            </div>
            <TableImport
              key={organisation.id}
              label={
                de
                  ? "Kontakte dieser Firma importieren"
                  : "Import contacts for this company"
              }
              filename="company-contacts"
              columns={["name", "position", "email", "phone", "notes"]}
              example={[
                "Alex Example",
                "Training",
                "alex@example.invalid",
                "",
                "",
              ]}
              parse={(row) => contactSchema.parse({ ...row, archived: false })}
              save={(row, key) =>
                importTableRow(key, "contact", row, organisation.id)
              }
              refresh={async () => {
                await Promise.all([
                  refresh(),
                  client.invalidateQueries({
                    queryKey: [
                      "company-class-directory",
                      actor,
                      organisation.id,
                    ],
                  }),
                ]);
              }}
            />
            <div className="operations-contact-list">
              {contacts.isPending && <Loading />}
              {contacts.isError && (
                <ErrorState retry={() => void contacts.refetch()} />
              )}
              {contacts.data?.map((contact) => (
                <article className="operations-contact" key={contact.id}>
                  <div className="section-heading">
                    <h3>{contact.name}</h3>
                    {contact.archived_at && (
                      <span className="badge">{t("archive")}</span>
                    )}
                  </div>
                  <p>{contact.position}</p>
                  {contact.email && (
                    <a
                      className="text-link"
                      href={`mailto:${encodeURIComponent(contact.email)}`}
                    >
                      <Mail size={16} />
                      {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <a
                      className="text-link"
                      href={`tel:${contact.phone.replace(/[^+0-9]/g, "")}`}
                    >
                      <Phone size={16} />
                      {contact.phone}
                    </a>
                  )}
                  <p className="preserve-text">{contact.notes}</p>
                  <Button
                    variant="ghost"
                    onClick={() => setContactEdit(contact)}
                    disabled={!online}
                  >
                    {t("edit")}
                  </Button>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
      <Dialog
        open={orgEdit !== undefined}
        onOpenChange={(open) => {
          if (!open) setOrgEdit(undefined);
        }}
        title={t(orgEdit ? "editClient" : "newClient")}
        description={t("privateHint")}
      >
        <OrganisationForm
          key={orgEdit?.id ?? "new"}
          original={orgEdit ?? undefined}
          canEnablePremium={isAdmin}
          notes={
            orgEdit
              ? (notes.data.find((note) => note.organisation_id === orgEdit.id)
                  ?.private_notes ?? "")
              : ""
          }
          onDone={(id) => {
            setOrgEdit(undefined);
            setSelected(id);
            setSaved(true);
          }}
        />
        {orgEdit && (
          <PermanentDeleteAction
            kind="organisation"
            id={orgEdit.id}
            label={orgEdit.name}
          />
        )}
      </Dialog>
      <Dialog
        open={contactEdit !== undefined}
        onOpenChange={(open) => {
          if (!open) setContactEdit(undefined);
        }}
        title={t(contactEdit ? "edit" : "newContact")}
        description={t("privateHint")}
      >
        {organisation && (
          <ContactForm
            key={contactEdit?.id ?? `new-${organisation.id}`}
            original={contactEdit ?? undefined}
            organisation={organisation.id}
            onDone={() => {
              setContactEdit(undefined);
              setSaved(true);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

/** Coordinate search/selection in the authorized organization directory. */
export function ClientsPage() {
  const { t } = useTranslation("operations");
  const { session } = useAuth();
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const roles = useQuery(userRolesQuery(session!.user.id));
  if (permissions.isPending || roles.isPending) return <Loading />;
  if (permissions.isError || roles.isError)
    return (
      <ErrorState
        retry={() => {
          void permissions.refetch();
          void roles.refetch();
        }}
      />
    );
  if (!permissions.data.includes("organisations.manage"))
    return (
      <>
        <PageHeading title={t("clients")} />
        <Notice kind="error">{t("noAccess")}</Notice>
      </>
    );
  return (
    <ClientWorkspace
      actor={session!.user.id}
      isAdmin={roles.data.includes("admin")}
      canManageIntegrations={roles.data.some(
        (role) => role === "admin" || role === "owner" || role === "management",
      )}
      canManageWebhooks={
        roles.data.includes("admin") || roles.data.includes("owner")
      }
      canSubscribeAccounting={permissions.data.includes("finance.gross.read")}
    />
  );
}
