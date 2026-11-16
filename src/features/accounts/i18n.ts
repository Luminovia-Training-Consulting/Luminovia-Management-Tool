/**
 * DE/EN UI resources for the accounts namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";
// Static UI resources use the namespace's shared interpolation and pluralization contract.
// Authored content is separate from these i18next interface strings.
const de = {
  title: "Konten & Zugänge",
  invited:
    "Die Einladung wurde versandt und der Zugang mit der gewählten Rolle angelegt.",
  alreadyInvited:
    "Die Einladung wurde bereits versandt. Es wurde keine weitere E-Mail gesendet.",
  manageProfile: "Profil, Nachweise und Kontostatus verwalten",
  hint: "Eigene Konten, nachvollziehbare Rollen und klar zugeordnete Auftraggeber.",
  search: "Konten suchen",
  roles: "Rollen bearbeiten",
  save: "Rollen speichern",
  confirm: "Rollen für {{name}} ändern?",
  confirmHint:
    "Die Änderungen gelten sofort für neue API-Anfragen. Bestehende Aufträge und Honorare bleiben erhalten.",
  saved: "Rollen wurden gespeichert.",
  denied:
    "Für die Kontoverwaltung sind Verwaltungsrechte und eine bestätigte Mehrfaktor-Anmeldung erforderlich.",
  error:
    "Die Änderung konnte nicht bestätigt werden. Bitte Berechtigungen und Verbindung prüfen.",
  self: "Eigener Zugang",
  owner: "Inhaberin / Plattformleitung",
  admin: "Administration",
  management: "Management",
  senior_lecturer: "Senior-Dozent:in",
  lecturer: "Dozent:in",
  client: "Auftraggeber:in",
  participant: "Kursteilnehmer:in",
  role: "Kontorolle",
  organisation: "Auftraggeber-Organisation",
  organisationHint:
    "Dieser Zugang sieht nur Daten seiner zugeordneten Organisation.",
  choose: "Organisation wählen",
  clientLink: "Organisation zuordnen",
  clientUnlink: "Organisationszugriff entziehen",
  clientLinked: "Organisationszugriff wurde aktualisiert.",
  invite: "Konto einladen",
  inviteHint:
    "Jede Person erhält einen eigenen Zugang und setzt ihr eigenes Passwort. Einladungen werden nur nach Serverbestätigung als gesendet angezeigt.",
  previous: "Zurück",
  next: "Weiter",
  count: "{{count}} Konten",
  roleHint:
    "Administration und Plattformleitung können alle fachlichen Funktionen verwalten. Private Chats und persönliche Termine behalten ihre Zugriffsgrenzen.",
  api: "API-Referenz",
  apiHint:
    "Anmeldung erfolgt über Supabase Auth. Konten, Rollen und Einladungen sind über die versionierte Account-API nutzbar; weitere Fachfunktionen über die dokumentierten Datenbank-RPCs.",
  active: "Aktiv",
  inactive: "Gesperrt",
};
const en: typeof de = {
  title: "Accounts & access",
  invited:
    "The invitation was sent and access was created with the selected role.",
  alreadyInvited:
    "The invitation was already sent. No additional email was sent.",
  manageProfile: "Manage profile, evidence and account status",
  hint: "Individual accounts, audited roles and clearly assigned clients.",
  search: "Search accounts",
  roles: "Edit roles",
  save: "Save roles",
  confirm: "Change roles for {{name}}?",
  confirmHint:
    "Changes apply immediately to new API requests. Existing assignments and agreed fees remain intact.",
  saved: "Roles saved.",
  denied:
    "Account administration requires management capability and verified multi-factor authentication.",
  error:
    "The change could not be confirmed. Check your permissions and connection.",
  self: "Your account",
  owner: "Owner / platform lead",
  admin: "Administration",
  management: "Management",
  senior_lecturer: "Senior lecturer",
  lecturer: "Lecturer",
  client: "Client",
  participant: "Course participant",
  role: "Account role",
  organisation: "Client organisation",
  organisationHint:
    "This account only sees records belonging to its assigned organisation.",
  choose: "Choose organisation",
  clientLink: "Assign organisation",
  clientUnlink: "Revoke organisation access",
  clientLinked: "Organisation access updated.",
  invite: "Invite account",
  inviteHint:
    "Each person receives an individual account and sets their own password. An invitation is shown as sent only after server confirmation.",
  previous: "Previous",
  next: "Next",
  count: "{{count}} accounts",
  roleHint:
    "Administration and platform owners can manage all business functions. Private chats and personal events retain their resource access boundaries.",
  api: "API reference",
  apiHint:
    "Sign in through Supabase Auth. Accounts, roles and invitations are available through the versioned Account API; other domain features use the documented database RPCs.",
  active: "Active",
  inactive: "Suspended",
};
i18n.addResourceBundle("de", "accounts", de);
i18n.addResourceBundle("en", "accounts", en);
