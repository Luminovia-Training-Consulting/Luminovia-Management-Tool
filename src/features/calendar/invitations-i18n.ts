import i18n from "../../lib/i18n";

const de = {
  invitations: "Kalendereinladungen",
  manage: "Einladungen verwalten",
  description: "Lade Portalmitglieder zu diesem veröffentlichten Termin ein.",
  versionHelp:
    "Wenn du den Termin änderst oder zurückziehst, sind die bisherigen Einladungen nicht mehr gültig.",
  recipient: "Luminovia-ID der eingeladenen Person",
  invite: "Einladen",
  withdraw: "Einladung zurückziehen",
  noInvitations: "Du hast keine Einladungen zu bevorstehenden Terminen.",
  more: "Weitere Einladungen laden",
  inviteSent: "Einladung im Portal erstellt.",
  withdrawn: "Einladung zurückgezogen.",
  revoked: "Zurückgezogen",
  pending: "Antwort offen",
  accepted: "Zugesagt",
  tentative: "Vorläufig zugesagt",
  declined: "Abgesagt",
  respond_accepted: "Zusagen",
  respond_tentative: "Vorläufig zusagen",
  respond_declined: "Absagen",
  responseSaved: "Antwort gespeichert.",
  invalid: "Gib eine vollständige Luminovia-ID ein.",
  error: "Die Änderung konnte nicht bestätigt werden.",
  conflict:
    "Der Termin oder die Einladung wurde geändert. Prüfe den aktuellen Stand.",
  offline:
    "Verbinde dich mit dem Internet, um Einladungen zu sehen und zu beantworten.",
};

const en: typeof de = {
  invitations: "Calendar invitations",
  manage: "Manage invitations",
  description: "Invite portal members to this published event.",
  versionHelp:
    "Changes to the event or its publication invalidate existing invitations.",
  recipient: "Recipient’s Luminovia ID",
  invite: "Invite",
  withdraw: "Withdraw invitation",
  noInvitations: "You have no invitations to upcoming events.",
  more: "Load more invitations",
  inviteSent: "Invitation created in the portal.",
  withdrawn: "Invitation withdrawn.",
  revoked: "Withdrawn",
  pending: "Awaiting response",
  accepted: "Accepted",
  tentative: "Tentative",
  declined: "Declined",
  respond_accepted: "Accept",
  respond_tentative: "Tentatively accept",
  respond_declined: "Decline",
  responseSaved: "Response saved.",
  invalid: "Enter a complete Luminovia ID.",
  error: "The change could not be confirmed.",
  conflict: "The event or invitation changed. Check the current state.",
  offline: "Connect to the internet to see and respond to invitations.",
};

i18n.addResourceBundle("de", "calendarInvitations", de);
i18n.addResourceBundle("en", "calendarInvitations", en);
