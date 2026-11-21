/** Bilingual copy for the fictional Premium learner journey. */
import i18n from "../../lib/i18n";

const pairs = {
  workspaceIntro: [
    "Dein Zugang zu den freigegebenen Inhalten dieses fiktiven Kurses.",
    "Your access to the materials shared in this fictional course.",
  ],
  upcoming: ["Bevorstehend", "Upcoming"],
  completed: ["Abgeschlossen", "Completed"],
  overview: ["Übersicht & Termine", "Overview & schedule"],
  materials: ["Materialien", "Materials"],
  exam: ["Klausur", "Exam"],
  chat: ["Kurschat", "Course chat"],
  learning: ["Lernaktivitäten", "Learning activities"],
  sectionNavigation: ["Kursbereiche", "Course sections"],
  welcome: ["Willkommen im Kurs", "Welcome to the course"],
  welcomeLinux: [
    "Wir arbeiten mit grundlegenden Shell-Befehlen und üben den Umgang mit Dateien.",
    "We work with basic shell commands and practise handling files.",
  ],
  welcomeNetwork: [
    "Wir haben die Grundlagen von IP-Adressen und Netzverbindungen geübt.",
    "We practised the basics of IP addresses and network connections.",
  ],
  dates: ["Kurstermine", "Course sessions"],
  contact: ["Kurskontakt", "Course contact"],
  contactName: ["Robin Beispiel", "Robin Example"],
  mode: ["Online · Europe/Berlin", "Online · Europe/Berlin"],
  openWorkspace: ["Kurs öffnen", "Open course"],
  back: ["Zu meinen Kursen", "Back to my courses"],
  resourceLinux: [
    "Shell-Befehle für den Einstieg",
    "Shell commands for beginners",
  ],
  resourceNetwork: [
    "IP-Adressierung im Überblick",
    "IP addressing at a glance",
  ],
  resourceLinuxBody: [
    "Mit pwd prüfst du das aktuelle Verzeichnis. Mit ls listest du seine Inhalte auf.",
    "Use pwd to show the current directory. Use ls to list its contents.",
  ],
  resourceNetworkBody: [
    "Eine IPv4-Adresse besteht aus vier Oktetten. Die Präfixlänge gibt an, welcher Anteil zur Netzwerkadresse gehört.",
    "An IPv4 address has four octets. The prefix length tells you which bits belong to the network address.",
  ],
  openMaterial: ["Beispielmaterial ansehen", "View sample material"],
  examPreview: ["Beispielaufgabe ansehen", "View a sample question"],
  examBody: [
    "Wie findest du heraus, in welchem Verzeichnis du gerade arbeitest?",
    "How do you find the directory you are working in?",
  ],
  chatPrompt: [
    "Willkommen! Fragen zu den Beispielen kannst du hier sammeln.",
    "Welcome! Use this course chat to gather questions about the examples.",
  ],
  chatMessage: ["Fiktive Kursnachricht", "Fictional course message"],
  chatSend: ["Nachricht in Demo hinzufügen", "Add message in demo"],
  quiz: ["Übungsquiz", "Practice quiz"],
  question: [
    "Welcher Befehl zeigt das aktuelle Verzeichnis an?",
    "Which command shows the current directory?",
  ],
  networkQuestion: [
    "Wie viele Oktette hat eine IPv4-Adresse?",
    "How many octets are in an IPv4 address?",
  ],
  quizCheck: ["Antwort prüfen", "Check answer"],
  passed: ["Richtig.", "Correct."],
  retry: [
    "Prüfe das Beispielmaterial und versuche es erneut.",
    "Review the sample material and try again.",
  ],
  completion: ["Teilnahmenachweis", "Completion record"],
  completionAfterCourse: [
    "Der Nachweis ist nach Kursende verfügbar.",
    "The record is available after the course ends.",
  ],
  completionAfterQuiz: [
    "Bestehe zuerst das Übungsquiz.",
    "Complete the practice quiz first.",
  ],
  issueCompletion: ["Beispielnachweis anzeigen", "Show sample record"],
  completionResult: [
    "Fiktiver Teilnahmenachweis · Netzwerkeinstieg",
    "Fictional completion record · Network basics",
  ],
  rating: ["Bewertung (1 bis 5)", "Rating (1 to 5)"],
  comment: ["Fiktiver Kommentar", "Fictional comment"],
  reviewSave: ["Bewertung in Demo speichern", "Save review in demo"],
  reviewStored: [
    "Bewertung in dieser Demo gespeichert.",
    "Review saved in this demo.",
  ],
  reviewWithdraw: ["Demo-Bewertung zurückziehen", "Withdraw demo review"],
  reviewsHelp: [
    "Bewerte einen abgeschlossenen Kurs.",
    "Review a completed course.",
  ],
  notice: [
    "Neues Material für Linux Grundlagen",
    "New material for Linux basics",
  ],
  inboxHelp: [
    "Hier findest du fiktive Hinweise zu deinen Kursen.",
    "Find fictional updates about your courses here.",
  ],
  unread: ["Ungelesen", "Unread"],
  read: ["Gelesen", "Read"],
  markRead: ["Als gelesen markieren", "Mark as read"],
};

for (const [locale, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    locale,
    "learnerDemo",
    Object.fromEntries(
      Object.entries(pairs).map(([key, values]) => [key, values[index]]),
    ),
  );
}
