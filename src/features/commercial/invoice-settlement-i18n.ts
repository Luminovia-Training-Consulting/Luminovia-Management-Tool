/** Text for the finance-only cancellation and delivery worksheet. */
import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  title: ["Abrechnung berechnen", "Calculate settlement"],
  paymentDates: ["Zahlungsfristen berechnen", "Calculate payment deadlines"],
  paymentDatesScope: [
    "Verwende diese Fristen, wenn der allgemeine Rahmenvertrag für den Auftrag gilt. Gib die Daten in der vereinbarten Auftragszeitzone ein. Berechne jeden Kundenzahlungseingang separat. Die Daten werden nicht gespeichert.",
    "Use these deadlines when the standard framework governs the assignment. Enter calendar dates in the agreed assignment time zone. Calculate each customer receipt separately. These dates are not saved.",
  ],
  firstDelivered: [
    "Erste tatsächlich erbrachte Einheit",
    "First service unit actually delivered",
  ],
  lastAgreed: [
    "Letzte vereinbarte Einheit laut Auftrag",
    "Last agreed service unit in the assignment",
  ],
  customerReceipt: [
    "Eingang der Kundenzahlung für Absage oder unterrichtsfreien Tag",
    "Customer payment received for cancellation or a non-teaching day",
  ],
  correctInvoice: [
    "Eingang der korrekten Rechnung bei unberechtigter Kurzfristabsage",
    "Correct invoice received for unauthorised short-notice cancellation",
  ],
  paymentDatesOrder: [
    "Die letzte vereinbarte Einheit liegt vor der ersten erbrachten Einheit. Prüfe die Daten.",
    "The last agreed unit precedes the first delivered unit. Check the dates.",
  ],
  deadline_final: ["Schlusszahlung bis", "Final payment by"],
  deadline_interim: ["Abschlagszahlung bis", "Interim payment by"],
  deadline_customer: [
    "Kundenfinanzierte Vergütung bis",
    "Customer-funded payment by",
  ],
  deadline_shortNotice: [
    "Entschädigung für Kurzfristabsage bis",
    "Short-notice cancellation payment by",
  ],
  scope: [
    "Nutze den angenommenen Auftrag und die geprüften Belege. Erfasse einen Unterrichtstag nur einmal in der Zeitzone des Auftrags. Erfasse separat vereinbarte Prüfungsleistungen mit ihrer eigenen Referenz.",
    "Use the accepted assignment and verified evidence. Enter each teaching day once in the assignment time zone. Enter separately agreed assessment services with their own reference.",
  ],
  zone: ["Zeitzone des Auftrags", "Assignment time zone"],
  unit: ["Vergütungseinheit {{count}}", "Payable unit {{count}}"],
  kind: ["Leistung", "Service"],
  teaching: ["Unterrichtstag", "Teaching day"],
  assessment: [
    "Separat vereinbarte Prüfungsleistung",
    "Separately agreed assessment",
  ],
  nonTeaching: [
    "Vereinbarter unterrichtsfreier Kurstag",
    "Agreed non-teaching course day",
  ],
  day: ["Datum der Leistung", "Service date"],
  assessmentReference: [
    "Referenz der Prüfungsleistung",
    "Assessment reference",
  ],
  reason: ["Ergebnis der Prüfung", "Reviewed outcome"],
  choose: ["Bitte auswählen", "Choose an outcome"],
  delivered: [
    "Vereinbarte Einheit vollständig erbracht",
    "Agreed unit fully delivered",
  ],
  timely: [
    "Wirksam und fristgerecht abgesagt",
    "Valid and timely cancellation",
  ],
  shortNotice: [
    "Kurzfristig durch Luminovia ohne anwendbare Ausnahme abgesagt",
    "Short-notice Luminovia cancellation without an applicable exception",
  ],
  customer: [
    "Eigenständige Absage des Kunden",
    "Independent customer cancellation",
  ],
  customerNonTeaching: [
    "Kundenvergütung für den unterrichtsfreien Tag prüfen",
    "Review customer payment for the non-teaching day",
  ],
  excused: [
    "Entschuldigter Ausfall ohne zugeordnete Kundenzahlung",
    "Excused absence with no associated customer payment",
  ],
  manual: [
    "Teilweise erbrachte Einheit, Einzelvereinbarung oder Streitfall",
    "Partly delivered unit, individual agreement or dispute",
  ],
  agreedFee: [
    "Vereinbartes Honorar je Einheit",
    "Agreed lecturer fee per unit",
  ],
  credited: [
    "Bereits für diese Einheit berücksichtigter Betrag",
    "Amount already accounted for this unit",
  ],
  creditHint: [
    "Ziehe jeden Betrag nur einmal ab, auch wenn er bereits abgerechnet und bezahlt wurde.",
    "Deduct each amount once, even if it was both invoiced and paid.",
  ],
  scheduled: [
    "Vereinbarter Beginn mit UTC-Offset",
    "Agreed start with UTC offset",
  ],
  receivedNotice: [
    "Zugang der Mitteilung mit UTC-Offset",
    "Notice received with UTC offset",
  ],
  originalCustomerFee: [
    "Vereinbartes Kundenhonorar für diese Einheit",
    "Agreed customer fee for this unit",
  ],
  receivedCustomerCompensation: [
    "Tatsächlich erhaltene Stornozahlung für diese Einheit",
    "Cancellation payment actually received for this unit",
  ],
  receivedNonTeachingCompensation: [
    "Tatsächlich erhaltene Kundenzahlung für den unterrichtsfreien Tag",
    "Customer payment actually received for the non-teaching day",
  ],
  customerHint: [
    "Gib den kumulierten Zahlungseingang für dieselbe ausgefallene Einheit in der Währung des Kundenhonorars an. Ziehe Unterrichtszahlungen und Kostenersatz ab. Bei 0 Zahlungseingang kannst du das Kundenhonorar leer lassen.",
    "Enter cumulative receipts for the same cancelled unit in the currency of the agreed customer fee. Exclude teaching payments and expense reimbursements. With a zero receipt, you may leave the agreed customer fee blank.",
  ],
  nonTeachingHint: [
    "Erfasse den kumulierten Eingang für diesen Tag in der Währung des Kundenhonorars. Bei 0 Zahlungseingang kannst du das Kundenhonorar leer lassen. Unterricht, Prüfungen und bereits zugeordnete Stornozahlungen bleiben separat.",
    "Enter cumulative receipts for this day in the currency of the agreed customer fee. With a zero receipt, you may leave the agreed customer fee blank. Keep teaching, assessment and previously allocated cancellation payments separate.",
  ],
  offsetHint: [
    "ISO-Format, etwa 2030-04-01T09:30:00+02:00",
    "ISO format, for example 2030-04-01T09:30:00+02:00",
  ],
  remove: ["Einheit {{count}} entfernen", "Remove unit {{count}}"],
  add: ["Einheit hinzufügen", "Add unit"],
  check: ["Berechnen", "Calculate"],
  rowIssue: ["Einheit {{count}}. {{issue}}", "Unit {{count}}. {{issue}}"],
  zoneInvalid: [
    "Gib die vereinbarte IANA-Zeitzone ein.",
    "Enter the agreed IANA time zone.",
  ],
  unitsInvalid: [
    "Erfasse mindestens eine Einheit.",
    "Enter at least one unit.",
  ],
  dayInvalid: [
    "Gib ein gültiges Leistungsdatum ein.",
    "Enter a valid service date.",
  ],
  duplicateUnit: [
    "Diese Einheit wurde bereits erfasst.",
    "This unit is already listed.",
  ],
  manualRequired: [
    "Prüfe die Einzelvereinbarung oder ergänze die fehlende Zuordnung. In diesem Fall gibt es keine automatische Berechnung.",
    "Review the individual agreement or complete the missing classification. This case requires manual review.",
  ],
  amountInvalid: [
    "Gib ein positives Honorar und einen Betrag für die bereits berücksichtigten Zahlungen ein. Verwende höchstens zwei Nachkommastellen.",
    "Enter a positive agreed fee and the amount already accounted for. Use at most two decimal places.",
  ],
  noticeInvalid: [
    "Prüfe Beginn, Leistungsdatum und Zugang der Mitteilung. Beide Zeitpunkte brauchen einen UTC-Offset.",
    "Check the start, service date and notice receipt. Both times need a UTC offset.",
  ],
  noticeMismatch: [
    "Zeitpunkte und gewählter Grund passen nicht zur Frist von 168 Stunden.",
    "The timestamps and selected outcome do not match the 168-hour notice period.",
  ],
  customerAmountsInvalid: [
    "Prüfe das vereinbarte Kundenhonorar und den zugeordneten Zahlungseingang. Abweichende Zahlungen erfordern eine Einzelprüfung.",
    "Check the agreed customer fee and the matching receipt. Exceptions require manual review.",
  ],
  excessCredit: [
    "Der bereits berücksichtigte Betrag übersteigt die Berechnung. Prüfe diese Einheit separat.",
    "The amount already accounted for exceeds the calculated amount. Review this unit separately.",
  ],
  deliveredTotal: ["Erbrachte Leistungen", "Delivered services"],
  cancellationTotal: ["Stornovergütung", "Cancellation compensation"],
  nonTeachingTotal: [
    "Vergütung für unterrichtsfreie Tage",
    "Non-teaching day compensation",
  ],
  creditTotal: ["Bereits berücksichtigt", "Already accounted for"],
  openTotal: [
    "Offener Betrag laut Berechnung",
    "Outstanding amount from calculation",
  ],
  confirm: [
    "Ich habe den Vertrag, die Leistungen und die zugeordneten Belege geprüft.",
    "I have checked the contract, the services and the associated evidence.",
  ],
  attach: [
    "Beträge in die Prüfnotiz übernehmen",
    "Include amounts in the review note",
  ],
  attached: [
    "Die Beträge werden mit der Prüfnotiz geteilt.",
    "The amounts will be shared in the review note.",
  ],
  detach: [
    "Beträge aus der Prüfnotiz entfernen",
    "Remove amounts from the review note",
  ],
  sharedNote: [
    "Die dozierende Person sieht diese Prüfnotiz. Halte Kundenhonorare und interne Angaben hier vertraulich.",
    "The lecturer can see this review note. Keep customer fees and internal information out of it.",
  ],
  noteTooLong: [
    "Kürze die Prüfnotiz, damit die Beträge mitgespeichert werden können.",
    "Shorten the review note to include the amounts.",
  ],
};

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    language,
    "invoiceSettlement",
    Object.fromEntries(
      Object.entries(pairs).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
}
