/**
 * DE/EN UI resources for the accounts namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";
// Static UI resources use the namespace's shared interpolation and pluralization contract.
// Authored content is separate from these i18next interface strings.
const de = {
  conversionOrganisation:
    "Wähle die Organisation für das Unternehmenskonto. Rollen und Organisationszugriff werden gemeinsam gespeichert.",
  createTitle: "Benutzerkonto erstellen",
  creating: "Konto wird erstellt …",
  createHint:
    "Lege einen eigenen Zugang mit Rolle und Startpasswort an. Das Passwort benötigt mindestens 8 Zeichen, Groß- und Kleinbuchstaben, eine Zahl und ein Sonderzeichen. Es wird keine E-Mail versendet. Teile das Startpasswort persönlich mit; die Person kann es anschließend ändern.",
  initialPassword: "Startpasswort (mindestens 8 Zeichen)",
  createError:
    "Das Konto wurde nicht bestätigt. Prüfe Berechtigung, Organisation und ob diese E-Mail-Adresse bereits vergeben ist.",
  created: "Benutzerkonto wurde erstellt.",
  openCreated: "Benutzerkonto öffnen",
  publicProfileUnavailable:
    "Das öffentliche Profil ist derzeit nicht verfügbar. Die berechtigte Kontoverwaltung bleibt möglich.",
  profileLanguage: "Anzeigesprache",
  profileSaveFailed:
    "Profil konnte nicht gespeichert werden. Prüfe die Eingaben oder lade das Profil bei zwischenzeitlichen Änderungen erneut.",
  editProfile: "Profil bearbeiten",
  editAccess: "Rollen und Zugriffe bearbeiten",
  manageEvidence: "Qualifikationen und Nachweise",
  statusHint:
    "Die Änderung wird erst nach Serverbestätigung wirksam. Aufträge und vereinbarte Honorare bleiben erhalten.",
  confirmStatus: "Kontostatus bestätigen",
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
    "Für die Kontoverwaltung sind aktuelle Verwaltungsrechte erforderlich.",
  error:
    "Die Änderung konnte nicht bestätigt werden. Bitte Berechtigungen und Verbindung prüfen.",
  self: "Eigener Zugang",
  owner: "Inhaberin / Plattformleitung",
  admin: "Administration",
  management: "Management",
  senior_lecturer: "Senior-Dozent:in",
  lecturer: "Dozent:in",
  client: "Unternehmen",
  participant: "Kursteilnehmer:in",
  guest: "Gast",
  role: "Kontorolle",
  organisation: "Auftraggeber-Organisation",
  organisationHint:
    "Dieser Zugang sieht nur Daten seiner zugeordneten Organisation.",
  organisationAdmin:
    "Die Administration ordnet diesem Konto anschließend eine Organisation zu.",
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
    "Du kannst die für dein Konto freigegebenen Rollen vergeben. Administration kann weitere Administrationskonten anlegen und verwalten; die Plattformleitung und der eigene Zugang bleiben geschützt. Private Chats und persönliche Termine behalten ihre Zugriffsgrenzen.",
  protected:
    "Dieser Zugang ist vor Rollenänderungen durch dein Konto geschützt.",
  api: "API-Referenz",
  apiHint:
    "Anmeldung erfolgt über Supabase Auth. Konten, Rollen und Einladungen sind über die versionierte Account-API nutzbar; weitere Fachfunktionen über die dokumentierten Datenbank-RPCs.",
  active: "Aktiv",
  userId: "Luminovia User ID",
  inactive: "Gesperrt",
};
const en: typeof de = {
  conversionOrganisation:
    "Choose this company account’s organisation. Its role and organisation access are saved together.",
  createTitle: "Create user account",
  creating: "Creating account …",
  createHint:
    "Create an individual login with a role and initial password. Passwords need at least 8 characters, uppercase and lowercase letters, a number, and a symbol. No email is sent. Share the initial password personally; the person can change it afterwards.",
  initialPassword: "Initial password (at least 8 characters)",
  createError:
    "Account creation was not confirmed. Check your permission, organisation and whether this email address is already registered.",
  created: "User account created.",
  openCreated: "Open user account",
  publicProfileUnavailable:
    "The public profile is currently unavailable. Authorized account management remains available.",
  profileLanguage: "Display language",
  profileSaveFailed:
    "The profile could not be saved. Check the entries or reload if another change was made in the meantime.",
  editProfile: "Edit profile",
  editAccess: "Edit roles and access",
  manageEvidence: "Qualifications and evidence",
  statusHint:
    "The change takes effect only after server confirmation. Assignments and agreed fees are retained.",
  confirmStatus: "Confirm account status",
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
  denied: "Account administration requires current management capability.",
  error:
    "The change could not be confirmed. Check your permissions and connection.",
  self: "Your account",
  owner: "Owner / platform lead",
  admin: "Administration",
  management: "Management",
  senior_lecturer: "Senior lecturer",
  lecturer: "Lecturer",
  client: "Company",
  participant: "Course participant",
  guest: "Guest",
  role: "Account role",
  organisation: "Client organisation",
  organisationHint:
    "This account only sees records belonging to its assigned organisation.",
  organisationAdmin:
    "Administration will assign an organisation to this account afterwards.",
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
    "You can assign the roles permitted for your account. Administrators can create and manage other administrative accounts; platform ownership and your own account remain protected. Private chats and personal events retain their resource access boundaries.",
  protected: "This account is protected from role changes by your account.",
  api: "API reference",
  apiHint:
    "Sign in through Supabase Auth. Accounts, roles and invitations are available through the versioned Account API; other domain features use the documented database RPCs.",
  active: "Active",
  userId: "Luminovia User ID",
  inactive: "Suspended",
};
i18n.addResourceBundle("de", "accounts", de);
i18n.addResourceBundle("en", "accounts", en);
