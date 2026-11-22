import i18n from "../../lib/i18n";

const en = {
  report: "Report sick for a teaching day",
  help: "Choose the teaching day. Its upcoming sessions will immediately reopen as an urgent offer. Your other teaching days stay assigned to you.",
  day: "Teaching day",
  confirm: "Confirm sick day",
  cancel: "Cancel",
  failed:
    "The release could not be confirmed. Check your assignment and try again.",
  financialReview:
    "An invoice already exists or is being prepared for this assignment. Contact the course management team about this day.",
  released:
    "Sick day recorded. The available sessions are now listed with the open jobs.",
  urgent: "Urgent cover",
};

const de: Record<keyof typeof en, string> = {
  report: "Für einen Unterrichtstag krankmelden",
  help: "Wähle den Unterrichtstag aus. Die noch bevorstehenden Termine dieses Tages erscheinen sofort als Notfall in der Auftragsliste. Deine anderen Unterrichtstage bleiben dir zugewiesen.",
  day: "Unterrichtstag",
  confirm: "Krankmeldung bestätigen",
  cancel: "Abbrechen",
  failed:
    "Die Freigabe konnte nicht bestätigt werden. Prüfe deinen Auftrag und versuche es erneut.",
  financialReview:
    "Für diesen Auftrag gibt es bereits eine Abrechnung oder einen Abrechnungsvorgang. Wende dich für diesen Termin bitte an die Kursverwaltung.",
  released:
    "Krankmeldung erfasst. Die freigegebenen Termine stehen jetzt in der Auftragsliste.",
  urgent: "Notfall",
};

i18n.addResourceBundle("en", "sickDay", en);
i18n.addResourceBundle("de", "sickDay", de);
