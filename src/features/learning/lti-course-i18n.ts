import { registerLearningTranslations } from "./register-learning-translations";

registerLearningTranslations({
  ltiAuthorize: ["Lernwerkzeug wird geöffnet", "Opening learning tool"],
  ltiAdd: ["Lernwerkzeug registrieren", "Register learning tool"],
  ltiEdit: ["Registrierung bearbeiten", "Edit registration"],
  ltiField_title: ["Name des Lernwerkzeugs", "Learning tool name"],
  ltiField_client_id: ["LTI-Client-ID", "LTI client ID"],
  ltiAdvantage: ["LTI-Advantage-Dienste", "LTI Advantage services"],
  ltiServices: ["Werkzeugberechtigungen", "Tool permissions"],
  ltiPublicKey: [
    "Öffentlicher RSA-Schlüssel des Werkzeugs (JWK)",
    "Tool public RSA key (JWK)",
  ],
  ltiRoster: [
    "Teilnahme und Kursrollen teilen (NRPS)",
    "Share course membership and roles (NRPS)",
  ],
  ltiRosterPrivacy: [
    "Das Werkzeug sieht pseudonyme Kennungen und aktuelle Kursrollen. Namen und E-Mail-Adressen werden nicht weitergegeben.",
    "The tool receives pseudonymous identifiers and current course roles. Names and email addresses stay in the portal.",
  ],
  ltiGrades: ["Externe Bewertungen (AGS)", "External grades (AGS)"],
  ltiGradesHelp: [
    "Das Werkzeug kann Bewertungsspalten verwalten und Bewertungen an diesen Kurs senden. Externe Bewertungen haben eine eigene Ansicht.",
    "The tool can manage grade columns and send grades for this course. External grades have their own view.",
  ],
  ltiGradesEnable: ["Notendienst freigeben", "Enable grade services"],
  ltiGradesDisable: ["Notendienst deaktivieren", "Disable grade services"],
  ltiGrade_FullyGraded: ["Bewertet", "Graded"],
  ltiGrade_Pending: ["Bewertung ausstehend", "Grading pending"],
  ltiGrade_PendingManual: [
    "Manuelle Bewertung ausstehend",
    "Manual grading pending",
  ],
  ltiGrade_Failed: ["Bewertung fehlgeschlagen", "Grading failed"],
  ltiGrade_NotReady: ["Bewertung steht noch aus", "Grading not ready"],
  ltiGradesEmpty: [
    "Keine externen Bewertungen vorhanden.",
    "No external grades are available.",
  ],
  ltiGradesMaximum: ["{{score}} von {{maximum}}", "{{score}} of {{maximum}}"],
  ltiGradesMore: ["Weitere Spalten laden", "Load more columns"],
  ltiGradesBack: ["Zur ersten Seite", "Back to first page"],
  ltiGradesCount: [
    "Verfügbare Bewertungen: {{count}}",
    "Grades available: {{count}}",
  ],
  ltiGradesFirst: [
    "Die ersten 100 Einträge werden angezeigt.",
    "Showing the first 100 entries.",
  ],
  ltiAdvantageError: [
    "Die Einstellungen konnten nicht gespeichert werden. Prüfe den öffentlichen Schlüssel und lade die Registrierung neu.",
    "Settings could not be saved. Check the public key and reload the registration.",
  ],
  ltiConfigureSelector: [
    "Werkzeugauswahl einrichten",
    "Configure the tool picker",
  ],
  ltiSelectorUri: [
    "HTTPS-Adresse für die Materialauswahl",
    "HTTPS content picker URL",
  ],
  ltiSelectorUriHelp: [
    "Lass das Feld frei, um die Materialauswahl zu deaktivieren. Freigegebene Kurslinks bleiben verfügbar.",
    "Clear the URL to disable the picker. Published course links stay available.",
  ],
  ltiSelectResource: [
    "Material aus Werkzeug auswählen",
    "Choose content from tool",
  ],
  ltiReviewSelection: [
    "Gewähltes Lernmaterial prüfen",
    "Review selected learning material",
  ],
  ltiNoSelection: [
    "Das Werkzeug hat kein Lernmaterial zurückgegeben.",
    "The tool did not return any learning material.",
  ],
  ltiPublishLink: [
    "Material für den Kurs freigeben",
    "Publish material to the course",
  ],
  ltiSelectedGradeColumn: [
    "Notenspalte {{label}} · maximal {{maximum}} Punkte",
    "Grade column {{label}} · maximum {{maximum}} points",
  ],
  ltiLinkPublished: [
    "Das Lernmaterial ist im Kurs verfügbar.",
    "The learning material is available in the course.",
  ],
  ltiReturnToTools: ["Zurück zu den Kurswerkzeugen", "Return to course tools"],
  ltiLaunchResource: ["{{title}} öffnen", "Launch {{title}}"],
  ltiWithdrawResource: ["{{title}} ausblenden", "Hide {{title}}"],
  ltiWithdrawLink: ["Link ausblenden", "Hide link"],
  ltiDynamicTitle: [
    "Werkzeug dynamisch registrieren",
    "Register a tool dynamically",
  ],
  ltiDynamicProvider: [
    "Registrierungs-URL des Anbieters",
    "Provider registration URL",
  ],
  ltiDynamicJwks: [
    "Öffentliche JWKS-URL des Anbieters",
    "Provider public JWKS URL",
  ],
  ltiPrepareRegistration: ["Registrierung vorbereiten", "Prepare registration"],
  ltiOpenProviderRegistration: [
    "Registrierung beim Anbieter öffnen",
    "Open registration with the provider",
  ],
  ltiReloadConfigurations: ["Werkzeuge aktualisieren", "Refresh tools"],
  ltiDynamicReviewHelp: [
    "Kehre nach der Registrierung hierher zurück und aktualisiere die Liste. Prüfe das neue Werkzeug und gib es dann für diesen Kurs frei.",
    "Return here after registration and refresh the list. Review the new tool and then enable it for this course.",
  ],
  ltiDeploymentId: ["LTI-Deployment-ID", "LTI deployment ID"],
  ltiField_login_uri: ["Anmelde-URL des Werkzeugs", "Tool login URL"],
  ltiField_redirect_uri: [
    "Registrierte Rückgabe-URL",
    "Registered redirect URL",
  ],
  ltiField_target_uri: ["Ziel-URL des Kurslinks", "Resource link target URL"],
  ltiEnabled: ["Für diesen Kurs freigeben", "Enable for this course"],
  ltiSave: ["Registrierung speichern", "Save registration"],
  ltiLaunch: ["Externes Lernwerkzeug öffnen", "Open external learning tool"],
  ltiEmpty: [
    "Für diesen Kurs sind keine Lernwerkzeuge verfügbar.",
    "There are no learning tools available for this course.",
  ],
  ltiFailed: [
    "Der Vorgang konnte nicht abgeschlossen werden. Prüfe Berechtigung und Konfiguration. Starte den Kurslink bei Bedarf erneut.",
    "The request could not be completed. Check access and configuration. If needed, restart the course link.",
  ],
});
