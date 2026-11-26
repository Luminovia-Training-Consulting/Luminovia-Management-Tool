/** German and English pool authoring and learner start controls. */
import i18n from "../../lib/i18n";

const labels = {
  quizPoolUse: ["Fragen pro Versuch ziehen", "Draw questions for each attempt"],
  quizPoolHelp: [
    "Ein Pool braucht mindestens zwei Fragen aus der Fragenbank. Die Auswahl pro Versuch ist kleiner als der Pool.",
    "A pool requires at least two bank questions. Each attempt draws a subset of the pool.",
  ],
  quizPoolDrawCount: ["Fragen pro Versuch", "Questions per attempt"],
  quizPoolStart: [
    "Fragen ziehen und Versuch starten",
    "Draw questions and start attempt",
  ],
  quizPoolStartHelp: [
    "Der Server zieht {{count}} Fragen. Deine Auswahl bleibt beim Neuladen und Fortsetzen erhalten.",
    "The server draws {{count}} questions. Your selection stays the same when you reload or resume.",
  ],
  quizPoolStartConflict: [
    "Die Quizfassung oder der Versuch wurde geändert. Lade die aktuelle Ansicht.",
    "The quiz revision or attempt changed. Reload the current view.",
  ],
} as const;

for (const [index, locale] of ["de", "en"].entries()) {
  i18n.addResourceBundle(
    locale,
    "learning",
    Object.fromEntries(
      Object.entries(labels).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
}
