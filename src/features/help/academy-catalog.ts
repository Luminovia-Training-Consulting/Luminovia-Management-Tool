import type { GuideModule } from "./guide";

export const academyGuides: GuideModule[] = [
  {
    id: "academy-sign-in",
    path: "/login",
    title: { de: "Anmeldung und Zugang", en: "Sign-in and access" },
    summary: {
      de: "Öffne deine Akademie mit deinem eigenen Konto.",
      en: "Open your academy with your own account.",
    },
    steps: {
      de: [
        "Melde dich mit deiner E-Mail-Adresse oder deinem Benutzernamen an.",
        "Wähle Sprache und Darstellung in der Kopfzeile.",
      ],
      en: [
        "Sign in with your email address or username.",
        "Choose your language and appearance in the header.",
      ],
    },
    problem: {
      de: "Dein Zugang funktioniert nicht.",
      en: "You cannot sign in.",
    },
    resolution: {
      de: [
        "Nutze die Passwort-Wiederherstellung auf der Anmeldeseite. Bitte die Akademieverwaltung, deinen Zugang zu prüfen, falls du keine Nachricht erhältst.",
      ],
      en: [
        "Use password recovery on the sign-in page. If no message arrives, ask academy administration to check your access.",
      ],
    },
    keywords: [
      "Passwort",
      "password",
      "login",
      "Sprache",
      "language",
      "Dunkel",
      "dark",
    ],
  },
  {
    id: "academy-classes",
    path: "/learning",
    title: {
      de: "Kurse, Lernmaterial und Nachrichten",
      en: "Courses, learning materials and messages",
    },
    summary: {
      de: "Finde freigegebene Kurse, Lernunterlagen und den Kurschat.",
      en: "Find your courses, shared learning materials and course chat.",
    },
    steps: {
      de: [
        "Öffne den gewünschten Kurs und prüfe die Kursinformationen sowie den Meetinglink.",
        "Lade die freigegebene Fassung aus den Kursunterlagen herunter. Bestätige den Erhalt, wenn du sie geöffnet hast.",
        "Öffne den Kurschat für Nachrichten und gescannte Anhänge. Die Glocke zeigt neue Meldungen für deine Kurse.",
      ],
      en: [
        "Open your course to find its details and meeting link.",
        "Download the shared version in course materials and acknowledge receipt after opening it.",
        "Use course chat for messages and scanned attachments. The bell shows new notices for your courses.",
      ],
    },
    problem: {
      de: "Ein Kurs oder eine Datei fehlt.",
      en: "A course or file is missing.",
    },
    resolution: {
      de: [
        "Prüfe, ob deine Anmeldung für diesen Kurs bestätigt wurde. Bitte bei fehlenden Unterlagen die Lehrperson, den Freigabestatus zu prüfen.",
      ],
      en: [
        "Check whether your enrolment is confirmed. For missing materials, ask the instructor to check their sharing status.",
      ],
    },
    keywords: [
      "Kurschat",
      "attachment",
      "Meeting",
      "Upload",
      "Benachrichtigung",
      "notification",
    ],
  },
  {
    id: "academy-schedule",
    path: "/timetable",
    title: { de: "Stundenplan und Zeitzonen", en: "Timetable and time zones" },
    summary: {
      de: "Prüfe Termine in der Zeitzone des jeweiligen Kurses.",
      en: "Review sessions in each course’s time zone.",
    },
    steps: {
      de: [
        "Öffne den Stundenplan über die Kopfzeile.",
        "Wähle einen Zeitraum von bis zu 31 Tagen und öffne den Kurs über den Termintitel.",
      ],
      en: [
        "Open Timetable from the header.",
        "Select up to 31 days and open the course from its session listing.",
      ],
    },
    problem: {
      de: "Eine Uhrzeit passt nicht zu deiner Ortszeit.",
      en: "A time differs from your local clock.",
    },
    resolution: {
      de: [
        "Vergleiche die angezeigte Kurszeitzone und den UTC-Offset, besonders am Tag einer Zeitumstellung.",
      ],
      en: [
        "Check the course’s time zone and UTC offset, especially on daylight-saving transition days.",
      ],
    },
    keywords: ["Termin", "calendar", "schedule", "time zone", "Zeitzone"],
  },
  {
    id: "academy-assessments",
    path: "/learning",
    title: {
      de: "Prüfungen, Anwesenheit und Abschluss",
      en: "Exams, attendance and completion",
    },
    summary: {
      de: "Bearbeite Lernaktivitäten und rufe deinen eigenen Nachweis ab.",
      en: "Complete your learning activities and access your own completion record.",
    },
    steps: {
      de: [
        "Öffne im Kurs die freigegebene Prüfungsaufgabe oder das veröffentlichte Quiz.",
        "Die Lehrperson erfasst die Anwesenheit je Termin. Berechtigte Kursmitarbeitende können die Liste als CSV oder PDF exportieren.",
        "Beantrage das Abschlussdokument in den Lernaktivitäten, sobald Einschreibung, bestätigte Anwesenheit und ein erforderliches Quiz abgeschlossen sind.",
      ],
      en: [
        "Open the released student exam paper or the published quiz in the course.",
        "The instructor records attendance per session. Authorised course staff can export a register as CSV or PDF.",
        "Request your completion document in Learning activities once enrolment, verified attendance and any required published quiz are complete.",
      ],
    },
    problem: {
      de: "Ein Prüfungsdokument oder Nachweis ist gesperrt.",
      en: "An exam or completion document is unavailable.",
    },
    resolution: {
      de: [
        "Prüfe die Freigabe und die Abschlussvoraussetzungen. Lösungsschlüssel bleiben dem berechtigten Kursteam vorbehalten.",
      ],
      en: [
        "Check the release and completion requirements. Only authorised course staff can access answer keys.",
      ],
    },
    keywords: [
      "Lösungsschlüssel",
      "answer key",
      "quiz",
      "Anwesenheit",
      "certificate",
      "Abschluss",
    ],
  },
  {
    id: "academy-manage-courses",
    path: "/administration",
    title: {
      de: "Akademie verwalten und Kurse freigeben",
      en: "Manage the academy and publish a course",
    },
    summary: {
      de: "Lege lokale Konten und Kurse an und bestätige Anmeldungen.",
      en: "Create local accounts and courses, and confirm enrolments.",
    },
    steps: {
      de: [
        "Lege Organisationseinheiten sowie Konten für interne Lehrkräfte und Teilnehmende in der Akademieverwaltung an. Die Schulungskoordination betreut Teilnehmende ihrer zugewiesenen Einheit.",
        "Erstelle einen Kursentwurf mit Vorlage, Zeitzone und Terminen. Weise eine Lehrperson zu und bestätige bei der Freigabe die Gruppengröße.",
        "Öffne den freigegebenen Kurs und melde die aktiven Teilnehmenden an. Hinterlege bei Bedarf einen Meetinglink und veröffentliche die Willkommensinformation.",
      ],
      en: [
        "Create organisational units and accounts for internal instructors and learners in academy administration. Training coordinators support learners in their assigned unit.",
        "Create a course draft with its template, time zone and sessions. Assign an instructor and confirm the group size when publishing.",
        "Open the published course and enrol active learners. Add a meeting link if needed and publish the welcome information.",
      ],
    },
    problem: {
      de: "Der Server hat eine Änderung abgewiesen.",
      en: "The server declined a change.",
    },
    resolution: {
      de: [
        "Lade den aktuellen Kursstand. Prüfe die Lehrperson und vorhandene Anmeldungen und bestätige die Änderung erneut.",
      ],
      en: [
        "Reload the course, check the current instructor and enrolments, then review and confirm the change again.",
      ],
    },
    keywords: [
      "Lehrperson",
      "teacher",
      "Einladung",
      "invitation",
      "Entwurf",
      "draft",
      "publish",
      "Verwaltung",
    ],
  },
];

export default {
  modules: academyGuides,
  recovery: academyGuides.map(({ id, problem, resolution }) => ({
    title: problem,
    body: { de: resolution.de.join(" "), en: resolution.en.join(" ") },
    topic: id,
  })),
};
