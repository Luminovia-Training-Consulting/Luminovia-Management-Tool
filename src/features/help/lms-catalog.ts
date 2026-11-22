import type { GuideModule } from "./guide";

const lmsHelpGuides: GuideModule[] = [
  {
    id: "lms-learning",
    path: "/learning",
    area: "courses",
    practicePath: "/learning?role=participant",
    title: {
      de: "Meine Kurse und Lernmaterialien",
      en: "My courses and learning materials",
    },
    summary: {
      de: "Nimm eine Einladung an und finde Unterricht, Materialien und Kursnachrichten.",
      en: "Accept an invitation and find classes, materials and course messages.",
    },
    steps: {
      de: [
        "Öffne Meine Kurse oder den Lernbereich. Bestätige eine offene Unternehmenseinladung mit dem Konto, an das sie gerichtet ist.",
        "Öffne einen eingeschriebenen Kurs. Die Übersicht zeigt die Begrüßung, die Termine und einen freigegebenen Meetinglink.",
        "Lade unter Kursmaterialien die freigegebene Fassung herunter. Nutze den Kurschat für Nachrichten und Anhänge. Prüfungen und Lernaktivitäten erscheinen nach ihrer Freigabe.",
      ],
      en: [
        "Open My courses or Learning workspace. Accept a pending company invitation with the account it was addressed to.",
        "Open a course you are enrolled in. The overview shows the welcome, sessions and a published meeting link.",
        "Download the shared version in Course materials. Use Course chat for messages and attachments. Exams and learning activities appear after release.",
      ],
    },
    problem: {
      de: "Mein Kurs oder meine Datei fehlt.",
      en: "My course or file is missing.",
    },
    resolution: {
      de: [
        "Bitte die Kurskoordination, die Einschreibung für genau diesen Kurs zu prüfen. Die Einladung zum Unternehmen allein meldet dich noch nicht für einen Kurs an.",
        "Bitte die Lehrperson bei fehlenden Dateien, die Freigabe für Teilnehmende und den Prüfstatus der Datei zu kontrollieren.",
      ],
      en: [
        "Ask the course coordinator to check your enrolment for that course. A company invitation alone does not enrol you in a course.",
        "For missing files, ask the instructor to check learner visibility and the file's scanning status.",
      ],
    },
    keywords: [
      "LMS",
      "learner",
      "enrolment",
      "Einschreibung",
      "Meetinglink",
      "Kurschat",
    ],
  },
  {
    id: "lms-teaching",
    path: "/courses",
    area: "courses",
    practicePath: "/courses?role=lecturer",
    title: {
      de: "Unterricht im Kursraum vorbereiten",
      en: "Prepare a course as an instructor",
    },
    summary: {
      de: "Veröffentliche Kursinformationen und Materialien und erfasse die Anwesenheit je Termin.",
      en: "Publish course details and materials, then record attendance by session.",
    },
    steps: {
      de: [
        "Öffne in der Kursübersicht den dir zugewiesenen Kurs. Prüfe die Termine, veröffentliche die Begrüßung und hinterlege bei Bedarf den Meetinglink.",
        "Lade die Unterlagen hoch. Sobald die Sicherheitsprüfung abgeschlossen ist, gib die richtige Fassung für die gewünschte Gruppe frei.",
        "Wähle in der Anwesenheitsliste den Termin und speichere die Einträge. Veröffentlichte Prüfungsaufgaben und Quiz erscheinen bei eingeschriebenen Teilnehmenden. Lösungsschlüssel sind dem Kursteam vorbehalten.",
      ],
      en: [
        "Open the assigned course from the course list. Check the sessions, publish a welcome and add a meeting link if needed.",
        "Upload your materials. After security scanning, share the correct version with the intended group.",
        "Select the session in the attendance register and save its entries. Published exam papers and quizzes appear for enrolled learners. Answer keys are restricted to authorised course staff.",
      ],
    },
    problem: {
      de: "Eine Freigabe oder Änderung fehlt.",
      en: "A release or change is missing.",
    },
    resolution: {
      de: [
        "Prüfe, ob du aktuell dem Kurs zugewiesen bist und ob die Änderung vom Portal bestätigt wurde.",
        "Lade bei einer Versionsmeldung zunächst den aktuellen Stand. Prüfe beim Probedownload die Sichtbarkeit und die ausgewählte Fassung.",
      ],
      en: [
        "Check that you are currently assigned to the course and that the portal confirmed the change.",
        "After a version conflict, reload the current state. When verifying a download, check the audience and selected version.",
      ],
    },
    keywords: [
      "LMS",
      "Dozent",
      "instructor",
      "Unterricht",
      "attendance",
      "Anwesenheit",
      "Klausur",
      "Quiz",
    ],
  },
  {
    id: "lms-enrolment",
    path: "/client",
    area: "courses",
    practicePath: "/client?role=client",
    title: {
      de: "Teilnehmende einladen und einschreiben",
      en: "Invite and enrol participants",
    },
    summary: {
      de: "Ordne Personen deinem Unternehmen und den passenden geplanten Kursen zu.",
      en: "Associate people with your company and enrol them in the right upcoming courses.",
    },
    steps: {
      de: [
        "Öffne die Teilnehmendenliste deines Unternehmens. Lade eine Person per E-Mail ein oder frage die Verknüpfung per User-ID an.",
        "Warte auf die Annahme. Öffne anschließend den Personeneintrag und wähle die vorgesehenen veröffentlichten Kurse.",
        "Bestätige die Einschreibung und prüfe die Kursliste und den Verlauf im Personeneintrag.",
      ],
      en: [
        "Open your company's participant roster. Invite someone by email or request an association using their user ID.",
        "Wait for them to accept. Then open their participant record and choose the intended published courses.",
        "Confirm enrolment and verify the resulting course list and history in the participant record.",
      ],
    },
    problem: {
      de: "Eine Person oder ein Kurs lässt sich nicht auswählen.",
      en: "A person or course cannot be selected.",
    },
    resolution: {
      de: [
        "Prüfe die bestätigte Unternehmensverknüpfung und ob Premium LMS für das Unternehmen aktiv ist.",
        "Kontrolliere die Kursfreigabe und die Gruppengröße. Aktualisiere bei einem Konflikt die Auswahl und bestätige erneut.",
      ],
      en: [
        "Check the confirmed company association and whether Premium LMS is enabled for the company.",
        "Check that the course is published and has room. After a conflict, refresh the selection and confirm again.",
      ],
    },
    keywords: [
      "LMS",
      "Einladung",
      "participant",
      "enrolment",
      "Einschreibung",
      "Kapazität",
      "User-ID",
    ],
  },
  {
    id: "premium-lms",
    path: "/admin/clients",
    area: "administration",
    practicePath: false,
    title: {
      de: "Premium LMS für ein Unternehmen aktivieren",
      en: "Enable Premium LMS for a company",
    },
    summary: {
      de: "Admins schalten den Lernbereich gezielt pro Unternehmen frei.",
      en: "Administrators enable the learning workspace for each company.",
    },
    steps: {
      de: [
        "Öffne als Admin Verwaltung → Kunden / Unternehmen und wähle das aktive Unternehmen.",
        "Wähle Premium aktivieren, prüfe die Auswirkungen und bestätige den Wechsel. Kontrolliere anschließend den Status Premium LMS EIN.",
        "Öffne die Teilnehmendenliste oder den betroffenen Kurs und prüfe die freigegebenen Aktionen mit dem vorgesehenen Konto.",
      ],
      en: [
        "As an admin, open Administration → Customers / Companies and select the active company.",
        "Choose Enable Premium, review the effect and confirm the change. Check that the resulting status is Premium LMS ON.",
        "Open the participant roster or affected course and verify the available actions with the intended account.",
      ],
    },
    problem: {
      de: "Der Schalter oder der Lernbereich ist nicht verfügbar.",
      en: "The switch or learning workspace is unavailable.",
    },
    resolution: {
      de: [
        "Prüfe die Rolle Admin und ob das Unternehmen aktiv ist. Bei einem Konflikt lade den aktuellen Status, bevor du erneut bestätigst.",
        "Bei deaktiviertem Premium LMS wird der Lernzugriff gesperrt. Die Verwaltung kann den gespeicherten Datenstand des Unternehmens prüfen.",
      ],
      en: [
        "Check the admin role and whether the company is active. After a conflict, reload the current setting before confirming again.",
        "Disabling Premium LMS blocks learning access. Administration can review the company's retained data.",
      ],
    },
    keywords: [
      "Lizenz",
      "Premium LMS",
      "entitlement",
      "toggle",
      "Schalter",
      "Freischaltung",
      "Org",
    ],
  },
  {
    id: "course-integrations",
    path: "/admin/clients",
    area: "integrations",
    practicePath: false,
    title: {
      de: "API-Schlüssel und Kurs-Webhooks einrichten",
      en: "Set up API keys and course webhooks",
    },
    summary: {
      de: "Verbinde ein Unternehmen mit einem Dienst für Kursabfragen und signierte Ereignisse.",
      en: "Connect a company to a service for course queries and signed events.",
    },
    steps: {
      de: [
        "Öffne mit einem Admin- oder Owner-Konto das Unternehmen unter Verwaltung → Kunden / Unternehmen. Erstelle unter API-Integrationen einen benannten Schlüssel mit Ablaufdatum.",
        "Wähle genau eine Berechtigung für den Kurskatalog, die Einschreibung bestätigter Teilnehmender oder zusammengefasste Kurszahlen. Einschreibung und Bericht setzen aktives Premium LMS für das Unternehmen voraus.",
        "Kopiere den einmal angezeigten Schlüssel in den Geheimnisspeicher des empfangenden Servers. Entnimm dem OpenAPI-Dokument die Basis-URL und den zur Berechtigung passenden Aufruf.",
        "Richte mit dem Betreiber zuerst den HTTPS-Empfänger und seinen Alias ein. Wähle unter Unternehmens-Webhooks den aktiven Integrationsschlüssel und Kursereignisse aus, lege das Abonnement an und hinterlege den Signaturschlüssel sicher beim Empfänger.",
        "Prüfe im Zustellverlauf einen bestätigten Test. Empfänger prüfen Signatur und Zeitstempel und verarbeiten bereits bekannte Ereignis-IDs nur einmal.",
      ],
      en: [
        "With an admin or owner account, open the company under Administration → Customers / Companies. Create a named, expiring key under API integrations.",
        "Choose one permission for the course index, enrolment of confirmed participants or aggregate course counts. Enrolment and reporting require Premium LMS for the company.",
        "Copy the one-time credential into the consuming server's secret store. Use the base URL and operation from the OpenAPI document for the selected permission.",
        "Have the operator configure the HTTPS receiver and its alias first. Under Company webhooks, select the active integration key and course events, add a subscription and store its signing key securely on the receiver.",
        "Verify a confirmed test in delivery history. Receivers verify the signature and timestamp and process each event ID once.",
      ],
    },
    problem: {
      de: "Ein Abruf oder eine Zustellung schlägt fehl.",
      en: "A request or delivery fails.",
    },
    resolution: {
      de: [
        "Prüfe Unternehmensauswahl, aktiven Schlüssel und Ablaufdatum. Nach einem Schlüsselwechsel muss der empfangende Dienst den neuen Wert verwenden.",
        "Prüfe beim Webhook den Zustellverlauf und lass Alias, HTTPS-Adresse und Signaturkonfiguration beim Empfänger abgleichen. Verwende für Kursabfragen den API-Schlüssel und für die Signaturprüfung das Webhook-Geheimnis.",
      ],
      en: [
        "Check the selected company, active key and expiration date. After rotating the key, update the consuming server.",
        "For webhooks, check delivery history and ask the operator to verify the receiver alias, HTTPS address and signature configuration. Use the API key for course lookups and the webhook secret for signature verification.",
      ],
    },
    keywords: [
      "API",
      "OpenAPI",
      "Swagger",
      "Webhook",
      "receiver",
      "Empfänger",
      "HMAC",
      "JSON",
      "Integrationsschlüssel",
    ],
  },
];

export default lmsHelpGuides;
