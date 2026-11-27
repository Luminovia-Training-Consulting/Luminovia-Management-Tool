/** German/English interface labels; the author's reference and contact text remains untranslated. */
import i18n from "../../lib/i18n";

const de = {
  title: "Kontakt und Auftragsreferenz",
  introduction:
    "Ergänze bei Bedarf einen Webverweis und Kontaktangaben für diesen Auftrag.",
  edit: "Kontakt oder Webverweis bearbeiten",
  configureLink: "Kontakt oder Webverweis ergänzen",
  editDescription:
    "Ohne eigene Kontaktangaben übernimmt der Auftrag den Kurskontakt oder den Standardkontakt des Unternehmens.",
  reference: "Externe Auftragsreferenz",
  referenceUrl: "Weblink zum Auftrag",
  referenceLabel: "Bezeichnung des Weblinks",
  referenceDescription: "Beschreibung zur Auftragsreferenz",
  contact: "Kontakt für diesen Auftrag",
  contactName: "Ansprechpartner:in",
  contactEmail: "Kontakt-E-Mail",
  contactPhone: "Kontakt-Telefon",
  contactDescription: "Hinweise zum Kontakt",
  visibilityHint:
    "Für Dozierende gelten die Freigabezeiten unter Unternehmenssichtbarkeit in der Verwaltung.",
  hidden:
    "Die Kontaktangaben sind bis zur Freigabe der Unternehmensangaben ausgeblendet.",
  save: "Angaben speichern",
  saving: "Wird gespeichert …",
  saved: "Die Angaben wurden gespeichert.",
  cancel: "Abbrechen",
  loadError: "Kontakt und Auftragsreferenz konnten nicht geladen werden.",
  retry: "Erneut laden",
  error: "Die Angaben wurden nicht bestätigt. Dein Entwurf bleibt erhalten.",
  conflict:
    "Der Auftrag wurde zwischenzeitlich geändert. Lade den aktuellen Stand, bevor du erneut speicherst.",
  reload: "Aktuellen Stand übernehmen",
  reloadHint:
    "Dabei wird dein Entwurf durch den aktuellen Serverstand ersetzt.",
  reloadError:
    "Der aktuelle Stand konnte nicht geladen werden. Dein Entwurf bleibt erhalten.",
  invalid:
    "Bitte prüfe die markierten Angaben. Weblinks müssen HTTP oder HTTPS verwenden und dürfen keine Zugangsdaten enthalten.",
  offline:
    "Du bist offline. Zum Speichern und erneuten Laden ist eine Verbindung erforderlich.",
  permissionRequired: "Für diese Aktion fehlt dir die aktuelle Berechtigung.",
  readOnly:
    "Die Angaben dieses archivierten Auftrags können nicht bearbeitet werden.",
};
const en: Record<keyof typeof de, string> = {
  title: "Contact and job reference",
  introduction:
    "Optionally add a web reference and contact details for this job.",
  edit: "Edit contact or web reference",
  configureLink: "Add contact or web reference",
  editDescription:
    "When these contact fields are empty, the job uses the course contact or the company’s default contact.",
  reference: "External job reference",
  referenceUrl: "Job web link",
  referenceLabel: "Web link label",
  referenceDescription: "Job reference description",
  contact: "Contact for this job",
  contactName: "Contact person",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
  contactDescription: "Contact notes",
  visibilityHint:
    "The Customer visibility setting in Administration controls when lecturers see these details.",
  hidden:
    "Contact details are withheld until the company details are disclosed.",
  save: "Save details",
  saving: "Saving …",
  saved: "The details have been saved.",
  cancel: "Cancel",
  loadError: "The contact and job reference could not be loaded.",
  retry: "Load again",
  error: "The details were not confirmed. Your draft is retained.",
  conflict:
    "The job changed in the meantime. Load its current state before saving again.",
  reload: "Use current server state",
  reloadHint: "This replaces your draft with the current server state.",
  reloadError: "The current state could not be loaded. Your draft is retained.",
  invalid:
    "Check the marked fields. Web links must use HTTP or HTTPS and must not contain credentials.",
  offline: "You are offline. Saving and reloading require a connection.",
  permissionRequired: "You do not have the current permission for this action.",
  readOnly: "Details of this archived job cannot be edited.",
};
i18n.addResourceBundle("de", "jobBriefing", de);
i18n.addResourceBundle("en", "jobBriefing", en);
