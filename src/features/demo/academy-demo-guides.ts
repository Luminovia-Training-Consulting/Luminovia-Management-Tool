/** Fictional Academy tour destinations that do not import the internal portal guide. */
import type { GuideModule } from "../help/guide";

type DemoGuide = Pick<
  GuideModule,
  "id" | "path" | "title" | "summary" | "steps"
>;

const guides: DemoGuide[] = [
  {
    id: "home",
    path: "/",
    title: { de: "Übersicht", en: "Overview" },
    summary: {
      de: "Wähle eine Rolle und erkunde ihren Kursbereich.",
      en: "Choose a role and explore its course area.",
    },
    steps: {
      de: ["Wähle die Ansicht in der Kopfzeile und öffne einen Beispielkurs."],
      en: ["Choose a view in the header and open a sample course."],
    },
  },
  {
    id: "courses",
    path: "/courses",
    title: { de: "Kurse", en: "Courses" },
    summary: {
      de: "Verwalte fiktive Termine, Kursmaterial, Teilnahme und Prüfungen.",
      en: "Manage fictional sessions, course materials, enrolment and exams.",
    },
    steps: {
      de: ["Öffne einen Kurs und wähle den gewünschten Arbeitsbereich."],
      en: ["Open a course and select the workspace area you want to practise."],
    },
  },
  {
    id: "learning",
    path: "/learning",
    title: { de: "Meine Kurse", en: "My courses" },
    summary: {
      de: "Öffne deine Lernmaterialien und sieh nach, welche Aufgaben anstehen.",
      en: "Open your course materials and check what learning activities are due.",
    },
    steps: {
      de: ["Wechsle zur Ansicht für Teilnehmende und öffne einen Kurs."],
      en: ["Switch to the participant view and open a course."],
    },
  },
  {
    id: "calendar",
    path: "/calendar",
    title: { de: "Kalender", en: "Calendar" },
    summary: {
      de: "Sieh die fiktiven Kurstermine und ergänze einen Testtermin.",
      en: "Review the fictional sessions and add a practice event.",
    },
    steps: {
      de: ["Prüfe die Termine in deiner Ansicht und teste die Terminfunktion."],
      en: [
        "Check the dates for your current view and try the calendar action.",
      ],
    },
  },
  {
    id: "chats",
    path: "/chats",
    title: { de: "Nachrichten", en: "Messages" },
    summary: {
      de: "Probiere den Kurschat mit einer Testnachricht aus.",
      en: "Try course chat by composing a practice message.",
    },
    steps: {
      de: ["Schreibe eine fiktive Nachricht und prüfe, wie sie erscheint."],
      en: ["Write a fictional message and check how it appears."],
    },
  },
  {
    id: "files",
    path: "/files",
    title: { de: "Dateien", en: "Files" },
    summary: {
      de: "Übe die Dateiprüfung mit bereitgestellten Beispieldaten.",
      en: "Practise document checks using the supplied example records.",
    },
    steps: {
      de: ["Wähle ein Beispieldokument und prüfe den angezeigten Status."],
      en: ["Choose a sample document and check its displayed status."],
    },
  },
  {
    id: "notifications",
    path: "/notifications",
    title: { de: "Benachrichtigungen", en: "Notifications" },
    summary: {
      de: "Prüfe Hinweise auf Änderungen und neue Lernmaterialien.",
      en: "Review notices about course changes and new learning materials.",
    },
    steps: {
      de: [
        "Öffne die Hinweise und prüfe, welche Aktionen dir angeboten werden.",
      ],
      en: ["Open the notices and check which actions are available to you."],
    },
  },
  {
    id: "profile",
    path: "/profile",
    title: { de: "Mein Profil", en: "My profile" },
    summary: {
      de: "Ändere den fiktiven Anzeigenamen und speichere deine Eingabe.",
      en: "Edit the fictional display name and save your entry.",
    },
    steps: {
      de: ["Gib einen Testnamen ein und prüfe die dargestellte Profilkarte."],
      en: ["Enter a practice name and check the displayed profile card."],
    },
  },
  {
    id: "settings",
    path: "/settings",
    title: { de: "Einstellungen", en: "Settings" },
    summary: {
      de: "Passe Sprache und Darstellung der Demo an.",
      en: "Adjust the demo language and appearance.",
    },
    steps: {
      de: ["Teste den Sprach- und Designwechsel in der Kopfzeile."],
      en: ["Try changing language and appearance in the header."],
    },
  },
  {
    id: "my-reviews",
    path: "/my-reviews",
    title: { de: "Meine Kursrückmeldungen", en: "My course feedback" },
    summary: {
      de: "Prüfe, wie Rückmeldungen für Teilnehmende angezeigt werden.",
      en: "See how course feedback is presented to participants.",
    },
    steps: {
      de: ["Öffne die Kursrückmeldungen in der Ansicht für Teilnehmende."],
      en: ["Open course feedback in the participant view."],
    },
  },
  {
    id: "admin-accounts",
    path: "/admin/accounts",
    title: { de: "Konten und Rollen", en: "Accounts and roles" },
    summary: {
      de: "Erkunde die Kontenübersicht und die verfügbaren Rollenansichten.",
      en: "Explore the account overview and the available role views.",
    },
    steps: {
      de: [
        "Wähle die Admin-Ansicht, um die fiktive Kontenübersicht zu öffnen.",
      ],
      en: ["Choose the admin view to open the fictional account overview."],
    },
  },
];

const modules: GuideModule[] = guides.map((guide) => ({
  ...guide,
  problem: {
    de: "Ein Kurs oder eine Aktion fehlt in dieser Ansicht.",
    en: "A course or action is missing from this view.",
  },
  resolution: {
    de: ["Wähle die passende Übungsrolle und öffne den Bereich erneut."],
    en: ["Choose the relevant practice role and reopen this area."],
  },
  keywords: [],
}));

export default modules;
