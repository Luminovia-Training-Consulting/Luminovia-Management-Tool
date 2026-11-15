import i18n from "../../lib/i18n";
const en = {
  title: "Comments & teaching notes",
  help: "Discuss this resource with the teaching team. Client and learner accounts do not see this discussion. Comments do not change the accepted assignment terms.",
  denied: "This discussion is restricted to the authorised teaching team.",
  empty: "No comments yet. Add a question or a useful teaching note.",
  body: "Your comment",
  send: "Post comment",
  sending: "Posting…",
  posted: "Your comment was saved.",
  edit: "Edit comment",
  withdraw: "Withdraw comment",
  withdrawTitle: "Withdraw your comment?",
  withdrawHelp:
    "The discussion keeps a withdrawal marker. Ordinary readers will no longer see your comment text.",
  withdrawn: "Comment withdrawn",
  save: "Save comment",
  cancel: "Cancel",
  saved: "Comment updated.",
  hidden: "Hidden by moderation",
  hide: "Hide comment",
  restore: "Restore comment",
  moderation: "Moderate comment",
  moderationHelp:
    "A reason and verified management MFA are required. Moderation remains in the audit history.",
  reason: "Moderation reason",
  moderated: "Moderation saved.",
  edited: "Edited",
  older: "Load older comments",
  archived:
    "This resource is archived. Existing comments remain readable; new comments and edits are closed.",
  error: "The comment could not be saved or loaded. Please try again.",
  conflict:
    "This comment changed in another session. Reload the comments and review the latest version before saving again.",
  rateLimit:
    "Too many comments in a short time. Please wait before posting again.",
  refresh: "Reload comments",
};
const de: typeof en = {
  title: "Kommentare & Unterrichtsnotizen",
  help: "Tausche dich mit dem Lehrteam über diesen Eintrag aus. Auftraggeber- und Lernkonten sehen diese Diskussion nicht. Kommentare ändern keine angenommenen Auftragsbedingungen.",
  denied: "Diese Diskussion ist dem berechtigten Lehrteam vorbehalten.",
  empty:
    "Noch keine Kommentare. Ergänze eine Frage oder eine hilfreiche Unterrichtsnotiz.",
  body: "Dein Kommentar",
  send: "Kommentar veröffentlichen",
  sending: "Wird veröffentlicht…",
  posted: "Dein Kommentar wurde gespeichert.",
  edit: "Kommentar bearbeiten",
  withdraw: "Kommentar zurückziehen",
  withdrawTitle: "Deinen Kommentar zurückziehen?",
  withdrawHelp:
    "Die Diskussion behält einen Rückzugshinweis. Andere Lesende sehen deinen Kommentartext anschließend nicht mehr.",
  withdrawn: "Kommentar zurückgezogen",
  save: "Kommentar speichern",
  cancel: "Abbrechen",
  saved: "Kommentar aktualisiert.",
  hidden: "Durch Moderation ausgeblendet",
  hide: "Kommentar ausblenden",
  restore: "Kommentar wiederherstellen",
  moderation: "Kommentar moderieren",
  moderationHelp:
    "Ein Grund und eine bestätigte Verwaltungs-MFA sind erforderlich. Die Moderation bleibt im Prüfprotokoll erhalten.",
  reason: "Moderationsgrund",
  moderated: "Moderation gespeichert.",
  edited: "Bearbeitet",
  older: "Ältere Kommentare laden",
  archived:
    "Dieser Eintrag ist archiviert. Vorhandene Kommentare bleiben lesbar; neue Kommentare und Änderungen sind geschlossen.",
  error:
    "Der Kommentar konnte nicht gespeichert oder geladen werden. Bitte versuche es erneut.",
  conflict:
    "Dieser Kommentar wurde in einer anderen Sitzung geändert. Lade die Kommentare neu und prüfe die aktuelle Version vor dem erneuten Speichern.",
  rateLimit:
    "Zu viele Kommentare in kurzer Zeit. Bitte warte vor dem nächsten Beitrag.",
  refresh: "Kommentare neu laden",
};
i18n.addResourceBundle("de", "comments", de, true, true);
i18n.addResourceBundle("en", "comments", en, true, true);
