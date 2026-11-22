import i18n from "../../lib/i18n";

const de = {
  waitlist: "Warteliste",
  waitlistUnavailable: "Derzeit nicht verfügbarer Auftrag",
  waitlistHelp:
    "Die Warteliste meldet dir eine erneute Veröffentlichung. Sie reserviert keinen Platz. Die verbindliche Übernahme wird weiterhin online in Reihenfolge erfolgreicher Buchungen geprüft.",
  join: "Auf Warteliste setzen",
  leave: "Warteliste verlassen",
  joined: "Du stehst auf der Warteliste.",
  available:
    "Der Auftrag ist wieder offen. Prüfe ihn und übernimm ihn bei Interesse verbindlich.",
  open: "Auftrag öffnen",
  error:
    "Die Änderung wurde nicht bestätigt. Lade den aktuellen Stand und versuche es erneut.",
};
const en: Record<keyof typeof de, string> = {
  waitlist: "Waitlist",
  waitlistUnavailable: "Currently unavailable job",
  waitlistHelp:
    "The waitlist alerts you when an offer is published again. It reserves no place. Taking the assignment still requires online validation in successful booking order.",
  join: "Join waitlist",
  leave: "Leave waitlist",
  joined: "You are on the waitlist.",
  available:
    "This offer is open again. Review it and claim it if you want the assignment.",
  open: "Open job",
  error:
    "The change was not confirmed. Refresh the current state and try again.",
};
i18n.addResourceBundle("de", "jobExtra", de);
i18n.addResourceBundle("en", "jobExtra", en);
