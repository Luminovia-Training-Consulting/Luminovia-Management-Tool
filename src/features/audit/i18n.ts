/**
 * DE/EN UI resources for the adminAudit namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";
// Static UI resources use the namespace's shared interpolation and pluralization contract.
// Authored content is separate from these i18next interface strings.
const de = {
  title: "Administrationsprotokoll",
  description:
    "Nachvollziehbare Verwaltungsaktionen – lesbar, durchsuchbar und zeitlich begrenzt.",
  privacy:
    "Diese Ansicht zeigt nur freigegebene Verwaltungsereignisse. Private Profile, Kalender, Verfügbarkeiten, Chats, Dokumente, Verträge und Rechnungsinhalte sowie Detaildaten werden nicht einbezogen.",
  denied:
    "Das Protokoll erfordert die aktuelle Berechtigung audit.read und bestätigte Mehrfaktor-Authentifizierung.",
  from: "Von",
  to: "Bis einschließlich",
  zone: "Zeitzone",
  action: "Aktion",
  all: "Alle freigegebenen Aktionen",
  search: "Im Protokoll suchen",
  searchHint:
    "Anzeigename, Aktionskennung oder Ressourcenkennung; keine privaten Inhalte.",
  apply: "Filter anwenden",
  refresh: "Aktualisieren",
  previous: "Neuere Seite",
  next: "Ältere Seite",
  empty: "Keine passenden Verwaltungsereignisse im gewählten Zeitraum.",
  rangeError:
    "Wähle einen gültigen Zeitraum mit höchstens 93 Kalendertagen und einer gültigen IANA-Zeitzone.",
  page: "Seite {{page}} · {{count}} Ereignisse",
  window: "Anzeige in {{zone}} · höchstens 40 Ereignisse je Seite",
  resource: "Ressourcenkennung",
  noResource: "Keine Ressourcenkennung",
  actor: "Ausgeführt von",
  unknownActor: "Ohne Anzeigename",
  offline:
    "Zum Laden und Aktualisieren des Protokolls ist eine Onlineverbindung erforderlich.",
  groups: {
    account: "Kontorollen",
    user: "Kontostatus",
    invitation: "Einladungen",
    qualification: "Qualifikationen",
    client: "Auftraggeber",
    organisation: "Organisationen",
    course: "Kurse",
    job: "Aufträge",
    claim: "Zuweisungen",
    taxonomy: "Themenkatalog",
  },
};
const en = {
  title: "Administration audit trail",
  description:
    "Traceable administrative actions with searchable, bounded history.",
  privacy:
    "This view includes reviewed administrative events only. Private profiles, calendars, availability, chats, documents, contracts, invoice content and event details are excluded.",
  denied:
    "The audit trail requires the current audit.read capability and verified multi-factor authentication.",
  from: "From",
  to: "Through",
  zone: "Time zone",
  action: "Action",
  all: "All reviewed actions",
  search: "Search audit trail",
  searchHint:
    "Display name, action identifier or resource identifier; no private content.",
  apply: "Apply filters",
  refresh: "Refresh",
  previous: "Newer page",
  next: "Older page",
  empty: "No matching administrative events in the selected window.",
  rangeError:
    "Choose a valid window of at most 93 calendar days and a valid IANA time zone.",
  page: "Page {{page}} · {{count}} events",
  window: "Displayed in {{zone}} · at most 40 events per page",
  resource: "Resource identifier",
  noResource: "No resource identifier",
  actor: "Performed by",
  unknownActor: "No display name",
  offline:
    "An online connection is required to load or refresh the audit trail.",
  groups: {
    account: "Account roles",
    user: "Account status",
    invitation: "Invitations",
    qualification: "Qualifications",
    client: "Clients",
    organisation: "Organisations",
    course: "Courses",
    job: "Jobs",
    claim: "Assignments",
    taxonomy: "Topic catalogue",
  },
};
i18n.addResourceBundle("de", "adminAudit", de);
i18n.addResourceBundle("en", "adminAudit", en);
