import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { isMeetingUrl, maxMeetingUrlLength } from "../learning/meeting-url";
import {
  companyClassDirectoryQuery,
  companyClassDirectorySchema,
} from "./company-class-directory-api";
import { contactsQuery } from "./data";
import { CompanyClassFeedback } from "./company-class-feedback";

const messages = {
  heading: ["Klassen und Auftragskontakt", "Classes and assignment contact"],
  intro: [
    "Klassen und Auftragskontakte sind auch ohne Premium LMS verfügbar. Der Standardlink einer Klasse und der Auftragskontakt können in Aufträge übernommen werden.",
    "Classes and assignment contacts are available without Premium LMS. A class's default meeting link and the assignment contact can be copied into assignments.",
  ],
  company: ["Unternehmen", "Company"],
  contact: ["Standardkontakt für Aufträge", "Default assignment contact"],
  noContact: ["Kein Standardkontakt", "No default contact"],
  addContact: ["Neuen Auftragskontakt anlegen", "Create assignment contact"],
  name: ["Name", "Name"],
  email: ["E-Mail", "Email"],
  phone: ["Telefon", "Phone"],
  classes: ["Klassen", "Classes"],
  empty: ["Noch keine Klassen vorhanden.", "No classes yet."],
  newClass: ["Klasse anlegen", "Create class"],
  editClass: ["Klasse bearbeiten", "Edit class"],
  className: ["Klassenname", "Class name"],
  meeting: ["Standard-Meetinglink", "Default meeting link"],
  noMeeting: ["Kein Meetinglink hinterlegt.", "No meeting link set."],
  invalidMeeting: [
    "Gib einen gültigen HTTPS-Link ein.",
    "Enter a valid HTTPS link.",
  ],
  saved: ["Gespeichert.", "Saved."],
  error: [
    "Änderungen konnten nicht gespeichert werden.",
    "Changes could not be saved.",
  ],
} as const;

function useText() {
  const { i18n } = useTranslation();
  return (key: keyof typeof messages) =>
    messages[key][i18n.language.startsWith("de") ? 0 : 1];
}

type Company = { id: string; name: string };
type SaveInput =
  | { kind: "class"; id: string | null; name: string; meetingUrl: string }
  | {
      kind: "contact";
      id: string | null;
      newContact?: { name: string; email: string; phone: string };
    };

export function CompanyDispatchSettings({
  actor,
  organisations,
}: {
  actor: string;
  organisations: Company[];
}) {
  const word = useText();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, select] = useState("");
  const organisation =
    organisations.find((entry) => entry.id === selected) ?? organisations[0];
  if (!organisation) return null;

  return (
    <details
      className="panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{word("heading")}</summary>
      {open && (
        <div className="form">
          {organisations.length > 1 && (
            <Field id={id} label={word("company")}>
              <select
                id={id}
                value={organisation.id}
                onChange={(event) => select(event.currentTarget.value)}
              >
                {organisations.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p>{word("intro")}</p>
          <CompanyDispatchEditor
            key={`${actor}:${organisation.id}`}
            actor={actor}
            organisationId={organisation.id}
          />
        </div>
      )}
    </details>
  );
}

function CompanyDispatchEditor({
  actor,
  organisationId,
}: {
  actor: string;
  organisationId: string;
}) {
  const word = useText();
  const { t } = useTranslation();
  const online = useOnline();
  const id = useId();
  const cache = useQueryClient();
  const directoryOptions = companyClassDirectoryQuery(actor, organisationId);
  const directory = useQuery(directoryOptions);
  const [selectedContact, selectContact] = useState<string>();
  const [addingContact, setAddingContact] = useState(false);
  const [classDraft, editClass] = useState<{
    id: string | null;
    name: string;
    meetingUrl: string;
  }>();
  const [invalidMeeting, setInvalidMeeting] = useState(false);
  const save = useMutation({
    mutationFn: async (input: SaveInput) => {
      requireOnline();
      const { data, error } =
        input.kind === "class"
          ? await db().rpc("save_company_dispatch_class", {
              p_organisation_id: organisationId,
              p_class_id: input.id,
              p_name: input.name,
              p_meeting_url: input.meetingUrl,
            })
          : await db().rpc("save_company_dispatch_settings", {
              p_organisation_id: organisationId,
              p_contact_id: input.id,
              ...(input.newContact ? { p_new_contact: input.newContact } : {}),
            });
      if (error) throw error;
      return companyClassDirectorySchema.parse(data);
    },
    onSuccess: async (data, input) => {
      await cache.cancelQueries({ queryKey: directoryOptions.queryKey });
      cache.setQueryData(directoryOptions.queryKey, data);
      if (input.kind === "class") {
        editClass(undefined);
      } else {
        selectContact(undefined);
        setAddingContact(false);
        if (input.newContact)
          void cache.invalidateQueries({
            queryKey: contactsQuery(actor, organisationId).queryKey,
          });
      }
    },
  });

  if (directory.isPending) return <Loading />;
  if (directory.isError)
    return <ErrorState retry={() => void directory.refetch()} />;
  const current = directory.data;
  const contactId = selectedContact ?? current.contact_id ?? "";
  const canSave = online && !save.isPending;

  function createContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    const form = new FormData(event.currentTarget);
    save.mutate({
      kind: "contact",
      id: null,
      newContact: {
        name: String(form.get("name") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        phone: String(form.get("phone") ?? "").trim(),
      },
    });
  }

  function submitClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classDraft || !canSave) return;
    const meetingUrl = classDraft.meetingUrl.trim();
    if (meetingUrl && !isMeetingUrl(meetingUrl)) {
      setInvalidMeeting(true);
      return;
    }
    save.mutate({
      kind: "class",
      id: classDraft.id,
      name: classDraft.name.trim(),
      meetingUrl,
    });
  }

  return (
    <div className="form">
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave && contactId !== (current.contact_id ?? ""))
            save.mutate({ kind: "contact", id: contactId || null });
        }}
      >
        <Field id={`${id}-contact`} label={word("contact")}>
          <select
            id={`${id}-contact`}
            value={contactId}
            onChange={(event) => selectContact(event.currentTarget.value)}
          >
            <option value="">{word("noContact")}</option>
            {current.contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
                {contact.email ? ` · ${contact.email}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-actions">
          <Button
            type="submit"
            disabled={!canSave || contactId === (current.contact_id ?? "")}
          >
            {t("save")}
          </Button>
          {!addingContact && (
            <Button
              type="button"
              variant="secondary"
              disabled={!canSave}
              onClick={() => {
                save.reset();
                setAddingContact(true);
              }}
            >
              {word("addContact")}
            </Button>
          )}
        </div>
      </form>
      {addingContact && (
        <form
          className="form"
          onSubmit={createContact}
          aria-label={word("addContact")}
        >
          <Field id={`${id}-contact-name`} label={word("name")}>
            <input
              id={`${id}-contact-name`}
              name="name"
              maxLength={120}
              required
            />
          </Field>
          <Field id={`${id}-contact-email`} label={word("email")}>
            <input
              id={`${id}-contact-email`}
              name="email"
              type="email"
              maxLength={254}
            />
          </Field>
          <Field id={`${id}-contact-phone`} label={word("phone")}>
            <input
              id={`${id}-contact-phone`}
              name="phone"
              type="tel"
              maxLength={50}
            />
          </Field>
          <div className="form-actions">
            <Button type="submit" disabled={!canSave}>
              {word("addContact")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!canSave}
              onClick={() => setAddingContact(false)}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
      <h3>{word("classes")}</h3>
      {current.classes.length ? (
        <ul className="form">
          {current.classes.map((entry) => (
            <li key={entry.id}>
              <div className="section-heading">
                <div>
                  <strong>{entry.name}</strong>
                  <p className="muted break-all">
                    {entry.meeting_url || word("noMeeting")}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={!canSave}
                  aria-label={`${word("editClass")}: ${entry.name}`}
                  onClick={() => {
                    save.reset();
                    setInvalidMeeting(false);
                    editClass({
                      id: entry.id,
                      name: entry.name,
                      meetingUrl: entry.meeting_url ?? "",
                    });
                  }}
                >
                  {word("editClass")}
                </Button>
              </div>
              <CompanyClassFeedback actor={actor} classId={entry.id} />
            </li>
          ))}
        </ul>
      ) : (
        <p>{word("empty")}</p>
      )}
      {classDraft ? (
        <form
          className="form"
          onSubmit={submitClass}
          aria-label={word(classDraft.id ? "editClass" : "newClass")}
        >
          <Field id={`${id}-class-name`} label={word("className")}>
            <input
              id={`${id}-class-name`}
              value={classDraft.name}
              maxLength={100}
              required
              onChange={(event) =>
                editClass({ ...classDraft, name: event.currentTarget.value })
              }
            />
          </Field>
          <Field id={`${id}-class-meeting`} label={word("meeting")}>
            <input
              id={`${id}-class-meeting`}
              value={classDraft.meetingUrl}
              type="url"
              maxLength={maxMeetingUrlLength}
              aria-invalid={invalidMeeting || undefined}
              onChange={(event) => {
                setInvalidMeeting(false);
                editClass({
                  ...classDraft,
                  meetingUrl: event.currentTarget.value,
                });
              }}
            />
          </Field>
          {invalidMeeting && (
            <Notice kind="error">{word("invalidMeeting")}</Notice>
          )}
          <div className="form-actions">
            <Button
              type="submit"
              disabled={!canSave || !classDraft.name.trim()}
            >
              {t("save")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!canSave}
              onClick={() => editClass(undefined)}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="form-actions">
          <Button
            disabled={!canSave}
            onClick={() => {
              save.reset();
              setInvalidMeeting(false);
              editClass({ id: null, name: "", meetingUrl: "" });
            }}
          >
            {word("newClass")}
          </Button>
        </div>
      )}
      {save.isError && <Notice kind="error">{word("error")}</Notice>}
      {save.isSuccess && <Notice>{word("saved")}</Notice>}
    </div>
  );
}
