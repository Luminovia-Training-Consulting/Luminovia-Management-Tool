import i18n from "../../lib/i18n";
const pairs: Record<string, [string, string]> = {
  title: ["Kontaktmöglichkeiten im Team", "Team contact options"],
  help: [
    "Du entscheidest, ob aktive Dozierende und Teammitglieder deine gespeicherte E-Mail-Adresse oder Telefonnummer im internen Profil sehen. Beide Angaben bleiben hier standardmäßig verborgen. Auftraggeber- und Teilnahmekonten erhalten sie nicht. Bestehende Berechtigungen für die Kontoverwaltung bleiben davon unberührt.",
    "Choose whether active lecturers and staff can see your saved email address or phone number on your internal profile. Both are hidden here by default. Client and participant accounts do not receive them. Existing account-administration permissions remain separate.",
  ],
  email: [
    "E-Mail-Adresse für das Team anzeigen",
    "Show email address to staff",
  ],
  phone: ["Telefonnummer für das Team anzeigen", "Show phone number to staff"],
  savedEmail: [
    "Gespeicherte E-Mail-Adresse: {{value}}",
    "Saved email address: {{value}}",
  ],
  savedPhone: [
    "Gespeicherte Telefonnummer: {{value}}",
    "Saved phone number: {{value}}",
  ],
  missing: ["Nicht hinterlegt", "Not provided"],
  role: [
    "Die Kontaktfreigabe ist für aktive Teamrollen verfügbar.",
    "Contact sharing is available to active staff roles.",
  ],
  save: ["Kontaktfreigabe speichern", "Save contact visibility"],
  saved: ["Kontaktfreigabe gespeichert.", "Contact visibility saved."],
  error: [
    "Die Kontaktfreigabe konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten.",
    "Contact visibility could not be saved. Your draft is preserved.",
  ],
  conflict: [
    "Die Kontaktfreigabe wurde inzwischen geändert. Lade den gespeicherten Stand neu.",
    "Contact visibility changed elsewhere. Reload the saved settings.",
  ],
  reload: ["Kontaktfreigabe neu laden", "Reload contact visibility"],
  contact: ["Kontakt", "Contact"],
  none: [
    "Keine Kontaktangaben für dein Konto freigegeben.",
    "No contact details shared with your account.",
  ],
  write: ["E-Mail schreiben", "Write email"],
  call: ["Anrufen", "Call"],
  loadError: [
    "Kontaktangaben konnten nicht geladen werden.",
    "Contact details could not be loaded.",
  ],
  retry: ["Erneut laden", "Retry"],
  loading: ["Kontaktangaben werden geladen …", "Loading contact details…"],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "contact",
    Object.fromEntries(
      Object.entries(pairs).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
