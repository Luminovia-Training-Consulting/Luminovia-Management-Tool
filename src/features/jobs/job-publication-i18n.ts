/** German and English labels for reviewed offer publication and invitations. */
import i18n from "../../lib/i18n";

const labels = {
  heading: [
    "Veröffentlichung und Einladungen planen",
    "Plan publication and invitations",
  ],
  audience: ["Sichtbarkeit", "Audience"],
  marketplace: ["Alle berechtigten Dozent:innen", "All eligible lecturers"],
  selected: ["Nur ausgewählte Dozent:innen", "Selected lecturers only"],
  priority: [
    "Auswahl zuerst, danach Marktplatz",
    "Selected lecturers first, then marketplace",
  ],
  scheduleLater: ["Zeitpunkt planen", "Schedule for later"],
  publishAt: ["Beginn der Veröffentlichung", "Publication starts"],
  priorityUntil: ["Öffentlich verfügbar ab", "Opens to marketplace at"],
  selectedUntil: ["Einladungen gültig bis", "Invitations expire at"],
  zone: ["Zeitzone des Auftrags: {{zone}}", "Assignment time zone: {{zone}}"],
  selectedLecturers: ["Ausgewählte Dozent:innen", "Selected lecturers"],
  search: ["Berechtigte Dozent:innen suchen", "Find eligible lecturers"],
  choose: ["Dozent:in auswählen", "Choose lecturer"],
  add: ["Hinzufügen", "Add"],
  remove: ["{{name}} entfernen", "Remove {{name}}"],
  noCandidates: ["Keine passenden Dozent:innen.", "No matching lecturers."],
  now: ["Jetzt", "Now"],
  review: ["Veröffentlichung prüfen", "Review publication"],
  confirm: ["Veröffentlichung bestätigen", "Confirm publication"],
  cancelReview: ["Weiter bearbeiten", "Continue editing"],
  cancelPlan: ["Planung aufheben", "Cancel publication plan"],
  cancelInvite: ["Einladung zurückziehen", "Cancel invitation"],
  scheduled: ["Geplant", "Scheduled"],
  active: ["Einladungsphase aktiv", "Invitation window active"],
  released: ["Freigegeben", "Open"],
  expired: ["Abgelaufen", "Expired"],
  blocked: ["Prüfung erforderlich", "Review required"],
  cancelled: ["Zurückgezogen", "Cancelled"],
  accepted: ["Angenommen", "Accepted"],
  available: ["Einladung aktiv", "Invited"],
  invalid: [
    "Prüfe Zeitzone, Zeitraum und Auswahl. Die Veröffentlichung muss vor Kursbeginn und Bewerbungsfrist liegen.",
    "Check the time zone, window and recipients. Publication must precede the first session and claim deadline.",
  ],
  stale: [
    "Der Auftrag hat sich geändert. Lade die Planung neu und prüfe die aktuellen Angaben.",
    "The assignment has changed. Reload the plan and review the current information.",
  ],
  failed: [
    "Die Änderung wurde nicht bestätigt.",
    "The change was not confirmed.",
  ],
  reload: ["Neu laden", "Reload"],
  saved: ["Veröffentlichungsplanung gespeichert.", "Publication plan saved."],
  help: [
    "Diese Freigabe betrifft den Lehrauftrag. Teilnehmendenzugriff wird separat freigegeben.",
    "This publishes the teaching offer. Participant access is published separately.",
  ],
} as const;

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "jobPublication",
    Object.fromEntries(
      Object.entries(labels).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
