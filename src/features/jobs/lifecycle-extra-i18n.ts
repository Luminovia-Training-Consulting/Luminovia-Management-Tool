import i18n from "../../lib/i18n";
const de = {
  waitlist: "Warteliste",
  waitlistHelp:
    "Die Warteliste meldet dir eine erneute Veröffentlichung. Sie reserviert keinen Platz. Die verbindliche Übernahme wird weiterhin online in Reihenfolge erfolgreicher Buchungen geprüft.",
  join: "Auf Warteliste setzen",
  leave: "Warteliste verlassen",
  joined: "Du stehst auf der Warteliste.",
  available:
    "Der Auftrag ist wieder offen. Prüfe ihn und übernimm ihn bei Interesse verbindlich.",
  open: "Auftrag öffnen",
  handover: "Vertretung organisieren",
  handoverHelp:
    "Die bisherige Zuweisung bleibt bis zur verbindlichen Zustimmung einer qualifizierten, verfügbaren Vertretung bestehen. Der gesamte zukünftige, noch nicht abgerechnete Unterrichtsblock wird gemeinsam übertragen. Angenommene Honorare und Historie bleiben erhalten.",
  find: "Vertretung suchen",
  candidates: "Qualifizierte verfügbare Lehrkräfte",
  search: "Lehrkraft suchen",
  target: "Vertretung auswählen",
  reason: "Grund der Vertretungsanfrage",
  propose: "Vertretung anfragen",
  proposed:
    "Die Vertretungsanfrage wurde gespeichert. Deine Zuweisung besteht weiterhin.",
  noCandidates:
    "Für diesen Block ist derzeit keine weitere qualifizierte Lehrkraft verfügbar.",
  inbox: "Deine Vertretungsanfragen",
  history: "Vertretungsanfragen zu diesem Auftrag",
  from: "Angefragt von {{name}}",
  to: "Vertretung: {{name}}",
  expires: "Antwort möglich bis {{date}}",
  quote: "Verbindlich angebotene Konditionen",
  quotePrivate:
    "Die persönlichen Konditionen sind nur für die angefragte Vertretung sichtbar.",
  cancelled:
    "Die bestätigte Vertretung wurde inzwischen abgesagt. Es wurden keine Termine erneut reserviert.",
  total: "Gesamthonorar",
  rate: "Vergütungseinheit",
  contract: "Ein gültiger eigener Rahmenvertrag ist erforderlich.",
  consent:
    "Ich akzeptiere diese Konditionen und sämtliche angezeigten Termine als zusammenhängenden Unterrichtsblock.",
  accept: "Vertretung verbindlich übernehmen",
  decline: "Vertretung ablehnen",
  withdraw: "Anfrage zurückziehen",
  refresh: "Aktuellen Stand laden",
  pending: "Antwort ausstehend",
  accepted: "Vertretung bestätigt",
  declined: "Abgelehnt",
  withdrawn: "Zurückgezogen",
  superseded: "Durch Stornierung aufgehoben",
  expired: "Abgelaufen",
  confirmed:
    "Die Vertretung ist verbindlich bestätigt. Alle Termine wurden gemeinsam übertragen.",
  unavailable:
    "Diese Anfrage ist nicht mehr verfügbar. Lade den aktuellen Stand.",
  conflict:
    "Der gesamte Block passt nicht mehr in deinen Kalender oder deine Verfügbarkeit. Es wurden keine Termine übertragen.",
  not_eligible:
    "Die erforderliche Qualifikation liegt derzeit nicht gültig vor.",
  prerequisite_missing:
    "Ein gültiger eigener Rahmenvertrag für den gesamten Block fehlt.",
  terms_changed:
    "Die angebotenen Details haben sich geändert. Es wurde nichts übertragen; eine neue Anfrage ist erforderlich.",
  financial_review:
    "Diese Zuweisung benötigt eine gesonderte finanzielle Prüfung.",
  idempotency_conflict:
    "Die Anfrage konnte nicht eindeutig zugeordnet werden. Lade den aktuellen Stand.",
  error:
    "Die Änderung wurde nicht bestätigt. Lade den aktuellen Stand und versuche es erneut.",
};
const en: Record<keyof typeof de, string> = {
  waitlist: "Waitlist",
  waitlistHelp:
    "The waitlist alerts you when an offer is published again. It reserves no place. Taking the assignment still requires online validation in successful booking order.",
  join: "Join waitlist",
  leave: "Leave waitlist",
  joined: "You are on the waitlist.",
  available:
    "This offer is open again. Review it and claim it if you want the assignment.",
  open: "Open job",
  handover: "Arrange a substitute",
  handoverHelp:
    "The existing assignment remains until a qualified, available substitute explicitly accepts. The entire future, uninvoiced teaching block transfers together. Accepted compensation and history are retained.",
  find: "Find a substitute",
  candidates: "Qualified available lecturers",
  search: "Search lecturers",
  target: "Choose a substitute",
  reason: "Reason for the substitution request",
  propose: "Request substitution",
  proposed:
    "The substitution request was saved. Your assignment remains in place.",
  noCandidates:
    "No other qualified lecturer is currently available for this block.",
  inbox: "Your substitution requests",
  history: "Substitution requests for this job",
  from: "Requested by {{name}}",
  to: "Substitute: {{name}}",
  expires: "Respond by {{date}}",
  quote: "Concrete assignment terms",
  quotePrivate:
    "Personal compensation is visible only to the proposed replacement.",
  cancelled:
    "The confirmed replacement has since been cancelled. No sessions were reserved again.",
  total: "Total compensation",
  rate: "Rate unit",
  contract: "A valid personal framework agreement is required.",
  consent:
    "I accept these terms and all displayed sessions as one complete teaching block.",
  accept: "Accept substitution now",
  decline: "Decline substitution",
  withdraw: "Withdraw request",
  refresh: "Refresh current state",
  pending: "Awaiting response",
  accepted: "Substitution confirmed",
  declined: "Declined",
  withdrawn: "Withdrawn",
  superseded: "Closed by cancellation",
  expired: "Expired",
  confirmed:
    "The substitution is confirmed. All sessions transferred together.",
  unavailable:
    "This request is no longer available. Refresh the current state.",
  conflict:
    "The whole block no longer fits your calendar or availability. No sessions transferred.",
  not_eligible: "Your required qualification is not currently valid.",
  prerequisite_missing:
    "A valid personal framework agreement covering the whole block is missing.",
  terms_changed:
    "The offered details changed. Nothing transferred; a new request is required.",
  financial_review: "This assignment needs a separate financial review.",
  idempotency_conflict:
    "This operation could not be matched safely. Refresh the current state.",
  error:
    "The change was not confirmed. Refresh the current state and try again.",
};
i18n.addResourceBundle("de", "jobExtra", de);
i18n.addResourceBundle("en", "jobExtra", en);
