import i18n from "../../lib/i18n";

const en = {
  heading: "Withdraw from assignment",
  help: "With at least seven days (168 hours) before the first session, you can withdraw directly. With less notice, Administration or Management must approve your reasoned request. Until approval, all sessions remain assigned to you.",
  withdraw: "Withdraw from this assignment",
  request: "Request withdrawal",
  directHelp:
    "This releases your complete teaching block after server confirmation. The offer returns to draft; Management can reopen it. Accepted fees, terms and history remain stored.",
  requestHelp:
    "Explain why you want to withdraw. Your assignment remains binding until Administration or Management approves. You will receive the decision in your inbox.",
  boundary:
    "The server checks the deadline again on submission. If fewer than seven days remain, a reason is required and your request needs approval.",
  reason: "Reason",
  optionalReason: "Reason (optional with at least seven days’ notice)",
  confirm: "Confirm withdrawal",
  submit: "Submit request",
  approve: "Approve withdrawal",
  reject: "Reject request",
  approveHelp:
    "Approval releases every session of this assignment. Accepted commercial history remains stored. Started or invoiced work needs separate review.",
  rejectHelp:
    "The assignment remains confirmed. Explain your decision so the lecturer can read it here.",
  decisionReason: "Decision note",
  pending: "Awaiting review — assignment remains confirmed",
  approved: "Withdrawal approved",
  rejected: "Request rejected",
  withdrawn: "Withdrawal confirmed",
  superseded: "Request closed — assignment has changed",
  failed:
    "The action was not confirmed. Reload the current state or retry; your assignment has not been released by this message.",
  chatOriginBlocked:
    "This assignment remains confirmed. A course chat manager must use “Resolve access basis” to confirm whether the existing membership is independent or depends on an assignment or enrolment before the withdrawal can be completed.",
  refresh: "Reload withdrawal status",
  empty: "No withdrawal requests for this assignment.",
  offline: "Reconnect to request or review a withdrawal.",
};
const de: Record<keyof typeof en, string> = {
  heading: "Vom Auftrag zurücktreten",
  help: "Ab sieben Tagen (168 Stunden) vor dem ersten Termin kannst du direkt zurücktreten. Bei weniger Vorlauf muss Administration oder Management deinen begründeten Antrag genehmigen. Bis dahin bleiben dir alle Termine zugewiesen.",
  withdraw: "Von diesem Auftrag zurücktreten",
  request: "Rücktritt beantragen",
  directHelp:
    "Nach der Serverbestätigung wird dein gesamter Unterrichtsblock freigegeben. Der Auftrag geht zurück in den Entwurf; das Management kann ihn erneut öffnen. Akzeptierte Honorare, Bedingungen und Historie bleiben gespeichert.",
  requestHelp:
    "Begründe, warum du zurücktreten möchtest. Deine Zuweisung bleibt verbindlich, bis Administration oder Management zustimmt. Die Entscheidung erhältst du im Posteingang.",
  boundary:
    "Der Server prüft die Frist beim Absenden erneut. Sind es dann weniger als sieben Tage, ist eine Begründung erforderlich und dein Antrag muss genehmigt werden.",
  reason: "Begründung",
  optionalReason: "Begründung (ab sieben Tagen Vorlauf optional)",
  confirm: "Rücktritt bestätigen",
  submit: "Antrag absenden",
  approve: "Rücktritt genehmigen",
  reject: "Antrag ablehnen",
  approveHelp:
    "Die Genehmigung gibt alle Termine dieser Zuweisung frei. Die akzeptierte Geschäftshistorie bleibt gespeichert. Bereits begonnene oder abgerechnete Arbeit benötigt eine gesonderte Prüfung.",
  rejectHelp:
    "Die Zuweisung bleibt bestätigt. Begründe deine Entscheidung, damit der Dozent sie hier nachlesen kann.",
  decisionReason: "Entscheidungsbegründung",
  pending: "In Prüfung — Zuweisung bleibt bestätigt",
  approved: "Rücktritt genehmigt",
  rejected: "Antrag abgelehnt",
  withdrawn: "Rücktritt bestätigt",
  superseded: "Antrag geschlossen — Zuweisung wurde geändert",
  failed:
    "Die Aktion wurde nicht bestätigt. Lade den aktuellen Stand oder versuche es erneut; diese Meldung bestätigt keine Freigabe deiner Zuweisung.",
  chatOriginBlocked:
    "Die Zuweisung bleibt bestätigt. Eine für den Kurs-Chat verantwortliche Person muss unter „Zugangsgrund klären“ bestätigen, ob die bestehende Mitgliedschaft unabhängig ist oder von einem Auftrag beziehungsweise einer Einschreibung abhängt.",
  refresh: "Rücktrittsstatus neu laden",
  empty: "Keine Rücktrittsanträge für diesen Auftrag.",
  offline:
    "Verbinde dich mit dem Internet, um einen Rücktritt zu beantragen oder zu prüfen.",
};
i18n.addResourceBundle("en", "withdrawal", en);
i18n.addResourceBundle("de", "withdrawal", de);
