/** Bilingual, explicitly fictional content for the administrator's navigation-only role preview. */
import i18n from "../lib/i18n";

const de = {
  live: "Live-Konto",
  viewMode: "Navigationsvorschau",
  modeManagement: "Verwaltung",
  modeLecturer: "Dozent:in",
  modeCompany: "Unternehmen",
  modeParticipant: "Teilnehmende",
  customise: "Ansichten auswählen",
  unavailableShort: "Vorschau pausiert",
  unavailable:
    "Die Vorschau ist pausiert. Wechsle zum Live-Konto oder warte auf die Bestätigung deiner Berechtigungen.",
  openDemo: "Diese Rolle in der Demo ausprobieren",
  previewTitle: "Beispielansicht: {{role}}",
  previewDescription:
    "Frei erfundene Beispiele. Konto, Berechtigungen und reale Datenzugriffe bleiben unverändert.",
  previewWarning:
    "Nur Navigationsvorschau: Keine Rollenänderung, kein Identitätswechsel und keine Geschäftsaktion.",
  sample: "Beispiel",
  currentSection: "Aktiver Beispielbereich",
  sectionSample:
    "Diese Bereichsvorschau enthält nur fiktive, rollenbezogene Beispieldaten.",
  managementCourses: "Kursdurchführung",
  managementCoursesBody: "Fiktive Kurse, Termine und zuständige Lehrkräfte.",
  managementJobs: "Auftragssteuerung",
  managementJobsBody: "Fiktive offene Plätze und bestätigte Zuordnungen.",
  managementClients: "Kunden / Unternehmen",
  managementClientsBody: "Fiktive Organisations- und Kontaktansicht.",
  lecturerCourses: "Meine zugewiesenen Kurse",
  lecturerCoursesBody: "Fiktiver Unterrichtsplan mit bestätigten Terminen.",
  lecturerJobs: "Offene Aufträge",
  lecturerJobsBody: "Fiktive Angebote mit Themen und Zeitfenstern.",
  lecturerInvoices: "Honorarübersicht",
  lecturerInvoicesBody: "Fiktive Werte in getrennten Originalwährungen.",
  companyCourses: "Eigene Kurse",
  companyCoursesBody: "Fiktive angefragte und geplante Unternehmenskurse.",
  companyParticipants: "Teilnehmende",
  companyParticipantsBody: "Fiktive Personenzahl und Kurszuordnungen.",
  companyInvoices: "Rechnungen",
  companyInvoicesBody: "Fiktive Rechnungs- und Zahlungsstatus.",
  academySchedule: "Unterrichtstermine",
  academyScheduleBody:
    "Beispieltermine mit Unterrichtszeiten und Kurszuordnungen.",
  lecturerLearning: "Kursmaterial und Anwesenheit",
  lecturerLearningBody:
    "Beispiele für die Unterrichtsvorbereitung, geteilte Materialien und das Sitzungsregister.",
  learnerCourses: "Meine Lernkurse",
  learnerCoursesBody:
    "Beispielkurse mit Begrüßung, Dozent:in und dem nächsten Unterrichtstermin.",
  learnerMaterials: "Freigegebenes Lernmaterial",
  learnerMaterialsBody:
    "Beispieldateien und Übungen für eingeschriebene Teilnehmende.",
  learnerProgress: "Mein Lernfortschritt",
  learnerProgressBody:
    "Beispielstatus für Übungen, Kursabschluss und Nachweis.",
};
const en: typeof de = {
  live: "Live account",
  viewMode: "Navigation preview",
  modeManagement: "Management",
  modeLecturer: "Lecturer",
  modeCompany: "Company",
  modeParticipant: "Participant",
  customise: "Choose visible views",
  unavailableShort: "Preview paused",
  unavailable:
    "Your preview is paused. Return to the live account or wait for your permissions to be confirmed.",
  openDemo: "Try this role in the demo",
  previewTitle: "Sample view: {{role}}",
  previewDescription:
    "Wholly fictional examples. The signed-in account, permissions and real data access are unchanged.",
  previewWarning:
    "Navigation preview only: no role change, impersonation or business action is performed.",
  sample: "Sample",
  currentSection: "Active sample section",
  sectionSample:
    "This section preview contains only fictional, role-scoped sample data.",
  managementCourses: "Course delivery",
  managementCoursesBody: "Fictional courses, sessions and assigned lecturers.",
  managementJobs: "Assignment management",
  managementJobsBody: "Fictional open positions and confirmed allocations.",
  managementClients: "Customers / Companies",
  managementClientsBody: "Fictional organization and contact overview.",
  lecturerCourses: "My assigned courses",
  lecturerCoursesBody: "Fictional teaching schedule with confirmed sessions.",
  lecturerJobs: "Open jobs",
  lecturerJobsBody: "Fictional offers with subjects and time windows.",
  lecturerInvoices: "Earnings overview",
  lecturerInvoicesBody: "Fictional amounts in separate original currencies.",
  companyCourses: "Owned courses",
  companyCoursesBody: "Fictional requested and planned company courses.",
  companyParticipants: "Participants",
  companyParticipantsBody: "Fictional headcount and course memberships.",
  companyInvoices: "Invoices",
  companyInvoicesBody: "Fictional invoice and payment states.",
  academySchedule: "Class schedule",
  academyScheduleBody:
    "Example sessions with class times and course assignments.",
  lecturerLearning: "Course materials and attendance",
  lecturerLearningBody:
    "Examples for lesson preparation, shared materials and the session register.",
  learnerCourses: "My learning courses",
  learnerCoursesBody:
    "Example courses with a welcome, lecturer and the next class.",
  learnerMaterials: "Shared learning materials",
  learnerMaterialsBody:
    "Example documents and exercises for enrolled participants.",
  learnerProgress: "My learning progress",
  learnerProgressBody:
    "Example progress for exercises, course completion and the completion record.",
};
i18n.addResourceBundle("de", "rolePreview", de);
i18n.addResourceBundle("en", "rolePreview", en);
