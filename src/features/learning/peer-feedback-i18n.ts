/** Course peer activity labels and guidance, in German and English. */
import i18n from "../../lib/i18n";

const labels = {
  peerTitle: ["Peerfeedback", "Peer feedback"],
  peerOffline: [
    "Peerfeedback ist online verfügbar.",
    "Peer feedback is available online.",
  ],
  peerPrompt: ["Aufgabenstellung für den Austausch", "Prompt for the exchange"],
  peerOpen: ["Runde öffnen", "Open round"],
  peerOpenNext: ["Neue Feedbackrunde", "New feedback round"],
  peerSelectRound: ["Feedbackrunde", "Feedback round"],
  peerRoundOption: [
    "Runde {{number}} · {{stage}} · {{prompt}}",
    "Round {{number}} · {{stage}} · {{prompt}}",
  ],
  peerRound_collecting: ["Beiträge", "Collecting entries"],
  peerRound_reviewing: ["Rückmeldungen", "Reviewing"],
  peerRound_released: ["Veröffentlicht", "Released"],
  peerNoRound: [
    "Für diesen Kurs ist keine Feedbackrunde geöffnet.",
    "This course has no open feedback round.",
  ],
  peerPrivacy: [
    "Die Teilnahme ist freiwillig. Schreibe ohne Namen und andere persönliche Angaben. Das Lehrteam prüft die Texte vor der Weitergabe. Die Rückmeldungen fließen nicht in die Note ein.",
    "Participation is optional. Omit names and other identifying details. Course staff review text before sharing. Feedback does not affect grades.",
  ],
  peerEntry: ["Dein Beitrag", "Your submission"],
  peerSaveEntry: [
    "Beitrag speichern und teilnehmen",
    "Save entry and participate",
  ],
  peerWithdraw: ["Beitrag zurückziehen", "Withdraw entry"],
  peerPendingEntry: ["Beitrag wartet auf Prüfung.", "Entry awaits moderation."],
  peerApprovedEntry: ["Beitrag geprüft.", "Entry approved."],
  peerApproveEntry: ["Beitrag freigeben", "Approve entry"],
  peerStart: ["Peerzuordnung starten", "Start peer matching"],
  peerStartHelp: [
    "Mindestens drei freigegebene Beiträge sind erforderlich. Nur diese Beiträge nehmen am Austausch teil.",
    "At least three approved entries are required. Only approved entries join the exchange.",
  ],
  peerAssignment: ["Anonymer Beitrag zum Prüfen", "Anonymous entry to review"],
  peerNoAssignment: [
    "Dir wurde kein Beitrag zugeordnet.",
    "No entry was assigned to you.",
  ],
  peerWriteFeedback: ["Deine Rückmeldung", "Your feedback"],
  peerSubmitFeedback: [
    "Rückmeldung zur Prüfung abgeben",
    "Submit feedback for moderation",
  ],
  peerApproveFeedback: ["Rückmeldung freigeben", "Approve feedback"],
  peerRelease: [
    "Geprüfte Rückmeldungen veröffentlichen",
    "Release approved feedback",
  ],
  peerReleaseHelp: [
    "Nur bereits freigegebene Rückmeldungen werden veröffentlicht.",
    "Only approved feedback is released.",
  ],
  peerNoFeedback: [
    "Es liegt keine freigegebene Rückmeldung vor.",
    "There is no released feedback.",
  ],
  peerReceived: ["Erhaltene Rückmeldung", "Received feedback"],
  peerDispute: ["Anliegen zur Rückmeldung", "Concern about the feedback"],
  peerReportFeedback: [
    "Rückmeldung zur Prüfung melden",
    "Report feedback for review",
  ],
  peerReportPending: [
    "Das Lehrteam prüft deine Meldung.",
    "Course staff are reviewing your report.",
  ],
  peerResolution: ["Antwort des Lehrteams", "Response from course staff"],
  peerResolve: ["Prüfung abschließen", "Resolve report"],
  peerKeep: ["Rückmeldung weiterhin anzeigen", "Keep feedback visible"],
  peerConflict: [
    "Der Stand der Feedbackrunde hat sich geändert. Lade die aktuelle Ansicht.",
    "The round changed. Reload the current view.",
  ],
  peerReload: ["Ansicht neu laden", "Reload view"],
} as const;

for (const [index, locale] of ["de", "en"].entries())
  i18n.addResourceBundle(
    locale,
    "learning",
    Object.fromEntries(
      Object.entries(labels).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
