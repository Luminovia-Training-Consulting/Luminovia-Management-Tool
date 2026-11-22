/** Bilingual copy for the fictional Premium learner journey. */
import i18n from "../../lib/i18n";

const pairs = {
  academyGuide: [
    "Öffne einen Beispielkurs und wechsle die Demo-Rolle, um dieselben Kursdaten aus einer anderen Perspektive zu prüfen.",
    "Open a sample course and switch demo roles to review the same course from another perspective.",
  ],
  staffWorkspaceIntro: [
    "Probe Kursfreigaben, Anwesenheit und Zusammenarbeit. Prüfe anschließend die Sicht der Teilnehmenden.",
    "Practise course sharing, attendance and collaboration. Then check the participant view.",
  ],
  backStaff: ["Zur Kursübersicht", "Back to all courses"],
  delivery: ["Kursinformation & Meeting", "Course information & meeting"],
  publishWelcome: ["Begrüßung veröffentlichen", "Publish welcome"],
  shareMeeting: ["Beispiel-Meeting freigeben", "Share sample meeting"],
  unshareMeeting: ["Meeting-Freigabe aufheben", "Remove meeting access"],
  joinMeeting: ["Beispiel-Meeting öffnen", "Open sample meeting"],
  leaveMeeting: ["Beispiel-Meeting verlassen", "Leave sample meeting"],
  meetingJoined: [
    "Beispiel-Meeting geöffnet. Kamera und Mikrofon bleiben aus.",
    "Sample meeting opened. Camera and microphone stay off.",
  ],
  labSheet: ["Arbeitsblatt zur Wiederholung", "Revision worksheet"],
  labSheetBody: [
    "Notiere zwei Beispiele aus diesem Kurs und erkläre sie deiner Lerngruppe.",
    "Write down two examples from this course and explain them to your study group.",
  ],
  shareMaterial: ["Beispielmaterial freigeben", "Share sample material"],
  unshareMaterial: ["Material-Freigabe aufheben", "Remove material access"],
  submissions: ["Dateiabgaben", "File submissions"],
  submissionsOpen: [
    "Beispielabgaben sind geöffnet.",
    "Sample submissions are open.",
  ],
  submissionsClosed: [
    "Beispielabgaben sind geschlossen.",
    "Sample submissions are closed.",
  ],
  openSubmissions: ["Beispielabgaben öffnen", "Open sample submissions"],
  closeSubmissions: ["Beispielabgaben schließen", "Close sample submissions"],
  submitSample: ["Beispieldatei abgeben", "Submit sample file"],
  withdrawSample: ["Beispielabgabe zurückziehen", "Withdraw sample submission"],
  submittedSample: [
    "Fiktive Kursabgabe von Demo Alex",
    "Fictional course submission by Demo Alex",
  ],
  submittedSampleBody: [
    "Beispielantwort: Mit pwd prüfe ich das aktuelle Verzeichnis.",
    "Sample answer: I use pwd to check the current directory.",
  ],
  examRequired: ["Klausur erforderlich", "Exam required"],
  publishExam: ["Beispielklausur freigeben", "Publish sample exam"],
  withdrawExam: ["Klausur-Freigabe aufheben", "Withdraw sample exam"],
  examNotPublished: [
    "Die Klausur ist angekündigt. Die Aufgaben sind noch nicht freigegeben.",
    "The exam is planned. The questions are not available yet.",
  ],
  enabled: ["Erforderlich", "Required"],
  disabled: ["Aus", "Off"],
  attendance: ["Anwesenheitsliste", "Attendance register"],
  unmarked: ["Offen", "Unmarked"],
  present: ["Anwesend", "Present"],
  absent: ["Abwesend", "Absent"],
  excused: ["Entschuldigt", "Excused"],
  enrolment: ["Einladungen & Einschreibung", "Invitations & enrolment"],
  learners: ["Teilnehmende", "Participants"],
  selectInvitee: ["Fiktive Person", "Fictional person"],
  chooseLearner: ["Person wählen", "Select a person"],
  inviteLearner: [
    "Einladung in der Demo vormerken",
    "Record invitation in demo",
  ],
  enrolLearner: ["{{name}} einschreiben", "Enrol {{name}}"],
  classLabel: ["Schulklasse", "School class"],
  saveClass: ["Klasse zuordnen", "Assign class"],
  localChangeSaved: ["In der Demo gespeichert.", "Saved in this demo."],
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
