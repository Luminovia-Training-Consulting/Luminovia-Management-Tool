/**
 * DE/EN UI resources for the people namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";
// Static UI resources use the namespace's shared interpolation and pluralization contract.
// Authored content is separate from these i18next interface strings.
const de = {
  people: "Menschen & Profile",
  directoryHelp:
    "Themen, Erfahrungen und Bewertungen kennenlernen. Private Kontaktdaten und Honorare bleiben geschützt.",
  search: "Person suchen",
  labelFilter: "Label filtern",
  topicFilter: "Thema filtern",
  allTopics: "Alle Themen",
  allLabels: "Alle Labels",
  empty: "Keine passenden Profile gefunden.",
  open: "Profil öffnen",
  details: "Öffentliche Profilangaben",
  detailsHelp:
    "Diese Angaben sind für berechtigte Mitglieder sichtbar. Labels sind deine eigenen Beschreibungen und keine geprüften Qualifikationen oder Rollen.",
  country: "Land",
  languages: "Sprachen (mit Komma trennen)",
  labels: "Eigene Labels (mit Komma trennen)",
  experience: "Lehrerfahrung",
  save: "Speichern",
  saved: "Gespeichert",
  pending: "Wird gespeichert …",
  error:
    "Die Änderung wurde nicht gespeichert. Bitte Angaben und Berechtigung prüfen.",
  courses: "Kursverlauf",
  upcoming: "Kommende Kurse",
  current: "Aktuelle Kurse",
  past: "Vergangene Kurse",
  noCourses: "Keine Kurse in diesem Zeitraum.",
  state: "Zeitraum",
  allStates: "Alle Zeiträume",
  expertise: "Themen & Kenntnisse",
  verified: "Geprüft",
  selfDeclared: "Selbst angegeben",
  noTopics: "Noch keine Themen angegeben.",
  ratings: "Teilnehmendenbewertungen",
  noReviews: "Noch keine freigegebenen Bewertungen.",
  recentReviews:
    "Die Liste zeigt die 100 neuesten Bewertungen. Bewertende Personen bleiben anonym.",
  rating: "Bewertung",
  ratingValue: "{{value}} von 5",
  ratingCount: "{{count}} Bewertungen",
  participant: "Kursteilnehmende Person",
  self: "Deine Bewertung",
  hidden: "Durch Moderation ausgeblendet",
  moderation: "Bewertung moderieren",
  hide: "Ausblenden",
  restore: "Wieder freigeben",
  reason: "Begründung",
  moderationHelp:
    "Die Änderung wird mit Begründung protokolliert. Der ursprüngliche Beitrag bleibt geschützt gespeichert.",
  reviewTasks: "Meine Kursbewertungen",
  reviewHelp:
    "Du kannst tatsächlich abgeschlossene Kurse nach bestätigter Teilnahme bewerten. Der Name der bewertenden Person wird anderen Mitgliedern nicht angezeigt.",
  noReviewTasks:
    "Aktuell sind keine abgeschlossenen Kurse zur Bewertung freigegeben.",
  comment: "Deine Rückmeldung",
  submit: "Bewertung speichern",
  deleteReview: "Eigene Bewertung zurückziehen",
  deleteHelp:
    "Die Rückmeldung wird aus dem Profil entfernt. Diese Änderung kann über eine neue Bewertung rückgängig gemacht werden.",
  enrolments: "Kursteilnehmende verwalten",
  enrolmentHelp:
    "Nur Management und Administration können Personen zuordnen und eine tatsächliche abgeschlossene Teilnahme bestätigen.",
  participantSelect: "Person auswählen",
  choose: "Bitte auswählen",
  enrolled: "Zugeordnet",
  completed: "Teilnahme abgeschlossen",
  removed: "Zugang entzogen",
  status: "Teilnahmestatus",
  update: "Zuordnung speichern",
  noEnrolments: "Noch keine Personen zugeordnet.",
  permission:
    "Für die Teilnehmendenverwaltung sind eine Verwaltungsberechtigung und bestätigte MFA erforderlich.",
  message: "Nachricht schreiben",
  back: "Zur Übersicht",
  noBio: "Noch keine Beschreibung hinterlegt.",
  conflict:
    "Die Bewertung wurde zwischenzeitlich geändert. Bitte neu laden und deine Angaben erneut prüfen.",
  loading: "Wird geladen …",
};
const en: typeof de = {
  people: "People & profiles",
  directoryHelp:
    "Discover topics, experience and reviews. Private contact details and fees stay protected.",
  search: "Search people",
  labelFilter: "Filter label",
  topicFilter: "Filter topic",
  allTopics: "All topics",
  allLabels: "All labels",
  empty: "No matching profiles.",
  open: "Open profile",
  details: "Public profile details",
  detailsHelp:
    "These details are visible to authorised members. Labels are your own descriptions, not verified qualifications or roles.",
  country: "Country",
  languages: "Languages (comma separated)",
  labels: "Your labels (comma separated)",
  experience: "Teaching experience",
  save: "Save",
  saved: "Saved",
  pending: "Saving …",
  error: "The change was not saved. Check your details and permissions.",
  courses: "Course history",
  upcoming: "Upcoming courses",
  current: "Current courses",
  past: "Past courses",
  noCourses: "No courses in this period.",
  state: "Period",
  allStates: "All periods",
  expertise: "Topics & expertise",
  verified: "Verified",
  selfDeclared: "Self declared",
  noTopics: "No topics yet.",
  ratings: "Participant reviews",
  noReviews: "No published reviews yet.",
  recentReviews:
    "The list shows the 100 latest reviews. Reviewers remain anonymous.",
  rating: "Rating",
  ratingValue: "{{value}} out of 5",
  ratingCount: "{{count}} reviews",
  participant: "Course participant",
  self: "Your review",
  hidden: "Hidden by moderation",
  moderation: "Moderate review",
  hide: "Hide",
  restore: "Publish again",
  reason: "Reason",
  moderationHelp:
    "The change and its reason are audited. The original contribution remains protected.",
  reviewTasks: "My course reviews",
  reviewHelp:
    "Review completed courses after your attendance has been confirmed. Other members do not see the reviewer's name.",
  noReviewTasks: "No completed courses are currently available for review.",
  comment: "Your feedback",
  submit: "Save review",
  deleteReview: "Withdraw your review",
  deleteHelp:
    "The feedback is removed from the profile. You can restore it by submitting a new review.",
  enrolments: "Manage course participants",
  enrolmentHelp:
    "Only management and administrators can enrol people and confirm actual completed attendance.",
  participantSelect: "Select person",
  choose: "Please select",
  enrolled: "Enrolled",
  completed: "Attendance completed",
  removed: "Access revoked",
  status: "Attendance status",
  update: "Save enrolment",
  noEnrolments: "No participants enrolled yet.",
  permission:
    "Participant management requires a management capability and verified MFA.",
  message: "Send message",
  back: "Back to directory",
  noBio: "No biography yet.",
  conflict:
    "This review changed while you were editing. Reload and check your changes.",
  loading: "Loading …",
};
i18n.addResourceBundle("de", "people", de);
i18n.addResourceBundle("en", "people", en);
