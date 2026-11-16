import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  LifeBuoy,
  Search,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Preferences } from "../../components/preferences";
import { guideModules, guideText, type GuideModule } from "./catalog";
import "./help.css";

const labels = {
  title: { de: "Hilfe & Anleitungen", en: "Help & guides" },
  subtitle: {
    de: "Verstehe die Abläufe, probiere sie mit Beispieldaten aus und finde den nächsten sinnvollen Schritt bei Problemen.",
    en: "Understand workflows, try them with sample data and find the next practical step when something goes wrong.",
  },
  search: { de: "Suche in der Hilfe", en: "Search help" },
  placeholder: {
    de: "Zum Beispiel: Übernahme, MFA, Upload …",
    en: "For example: claim, MFA, upload …",
  },
  demo: { de: "Demo ausprobieren", en: "Try the demo" },
  login: { de: "Zum Portal", en: "Open portal" },
  topics: { de: "Alle Bereiche", en: "All sections" },
  problems: { de: "Probleme lösen", en: "Solve problems" },
  selected: { de: "Anleitung", en: "Guide" },
  steps: { de: "So gehst du vor", en: "What to do" },
  wrong: { de: "Wenn etwas nicht funktioniert", en: "If something goes wrong" },
  practice: {
    de: "Diesen Bereich in der Demo üben",
    en: "Practise this section in the demo",
  },
  real: { de: "Bereich im Portal öffnen", en: "Open section in the portal" },
  access: {
    de: "Im Portal gelten deine tatsächlichen Berechtigungen. Die Demo verwendet ausschließlich fiktive Daten.",
    en: "Your actual permissions apply in the portal. The demo uses fictional data only.",
  },
  empty: {
    de: "Keine passende Anleitung gefunden.",
    en: "No matching guide found.",
  },
  reset: { de: "Suche zurücksetzen", en: "Clear search" },
  count: { de: "Gefundene Bereiche", en: "Matching sections" },
  unknown: {
    de: "Diese Anleitung gibt es nicht. Wähle unten einen Bereich oder die Problemlösung.",
    en: "This guide does not exist. Choose a section below or open troubleshooting.",
  },
  troubleshooting: {
    de: "Probleme Schritt für Schritt lösen",
    en: "Solve problems step by step",
  },
};
const recovery = [
  {
    title: { de: "Verbindung oder Laden", en: "Connection or loading" },
    body: {
      de: "Prüfe zuerst deine Internetverbindung. Lade den betroffenen Bereich erneut. Offline kannst du keine Aufträge übernehmen, Nachrichten senden oder Dateien hochladen. Eine lokale Anzeige bestätigt keine Speicherung.",
      en: "Check your internet connection first. Reload the affected section. You cannot claim jobs, send messages or upload files offline. A local display does not confirm a saved change.",
    },
    topic: "jobs",
  },
  {
    title: {
      de: "Speichern oder Übernahme unklar",
      en: "Unclear save or claim result",
    },
    body: {
      de: "Prüfe den aktuellen Datensatz und zugehörige Bestätigungen, bevor du eine Aktion wiederholst. Bei einer Versionsmeldung lade den aktuellen Stand und gleiche deine Änderungen ab. Erfolgreiche Aufträge gelten für den gesamten Terminblock.",
      en: "Check the current record and related confirmations before repeating an action. After a version conflict, reload the current state and reconcile your changes. A successful assignment covers the entire session block.",
    },
    topic: "jobs",
  },
  {
    title: { de: "Zugriff verweigert", en: "Access denied" },
    body: {
      de: "Prüfe das angemeldete Konto und gegebenenfalls die aktuelle MFA-Bestätigung. Bitte die zuständige Verwaltung um Prüfung deiner Berechtigung. Private Termine, Direktnachrichten und Vertragsunterlagen werden nicht durch einen allgemeinen Admin-Zugang freigegeben.",
      en: "Check the signed-in account and current MFA verification where required. Ask the responsible administrator to review your permission. Private events, direct messages and contract documents are not shared through blanket administrator access.",
    },
    topic: "security",
  },
  {
    title: { de: "Datei noch nicht verfügbar", en: "File not yet available" },
    body: {
      de: "Prüfe Größenlimit, zulässigen Dateityp und Prüfstatus. Warte auf die Sicherheitsprüfung. Öffne einen abgelaufenen Download erneut aus dem Portal; umgehe keine Quarantäne oder Berechtigungsprüfung.",
      en: "Check the size limit, allowed file type and scanning status. Wait for security scanning. Reopen an expired download from the portal; never bypass quarantine or permission checks.",
    },
    topic: "files",
  },
  {
    title: {
      de: "App-Aktualisierung oder Darstellung",
      en: "App update or appearance",
    },
    body: {
      de: "Sichere noch nicht gespeicherte Eingaben, bevor du die angebotene App-Aktualisierung ausführst oder neu lädst. Prüfe Sprache und Darstellung in der Kopfzeile. Die PWA-Installation hängt von Browser und Gerät ab; private Inhalte sind kein Offline-Archiv.",
      en: "Preserve unsaved input before applying an offered app update or reloading. Check language and appearance in the header. PWA installation depends on your browser and device; private content is not an offline archive.",
    },
    topic: "settings",
  },
];
function searchText(module: GuideModule) {
  return [
    module.title.de,
    module.title.en,
    module.summary.de,
    module.summary.en,
    module.problem.de,
    module.problem.en,
    ...module.resolution.de,
    ...module.resolution.en,
    ...module.steps.de,
    ...module.steps.en,
    ...module.keywords,
  ]
    .join(" ")
    .toLocaleLowerCase();
}
export function HelpCenter() {
  const { i18n } = useTranslation();
  const text = <T,>(value: { de: T; en: T }) => guideText(value, i18n.language);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const articleHeading = useRef<HTMLHeadingElement>(null);
  const topic = params.get("topic");
  const selected = guideModules.find((module) => module.id === topic);
  const troubleshooting = topic === "troubleshooting";
  useEffect(() => {
    // URL navigation should reveal the chosen instructions to keyboard users too.
    // Reopening the same topic after a search creates a new history key as well.
    articleHeading.current?.focus();
  }, [location.key]);
  const needle = query.trim().toLocaleLowerCase();
  const results = guideModules.filter((module) =>
    searchText(module).includes(needle),
  );
  function choose(id?: string) {
    setQuery("");
    setParams(id ? { topic: id } : {});
  }
  return (
    <div className="help-page">
      <a className="skip-link" href="#help-main">
        {i18n.language.startsWith("de") ? "Zum Inhalt" : "Skip to content"}
      </a>
      <header className="help-header">
        <Link className="help-brand" to="/help" aria-label="Luminovia Portal">
          <img src="/brand/luminovia-logo-mark-160.webp" alt="" />
          <span>
            Luminovia <small>PORTAL</small>
          </span>
        </Link>
        <div className="help-header-actions">
          <Preferences />
          <Link to="/login">{text(labels.login)}</Link>
        </div>
      </header>
      <main id="help-main" className="help-main" tabIndex={-1}>
        <section className="help-hero" aria-labelledby="help-title">
          <div className="eyebrow">LUMINOVIA PORTAL</div>
          <h1 id="help-title">{text(labels.title)}</h1>
          <p>{text(labels.subtitle)}</p>
          <div className="help-actions">
            <Button asChild>
              <Link to="/demo">
                {text(labels.demo)}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </Button>
            <Button
              variant="secondary"
              onClick={() => choose("troubleshooting")}
            >
              <LifeBuoy size={18} aria-hidden="true" />
              {text(labels.problems)}
            </Button>
          </div>
        </section>
        <div className="help-tools">
          <label className="help-search" htmlFor="help-search">
            <span>
              <Search size={18} aria-hidden="true" />
              {text(labels.search)}
            </span>
            <input
              id="help-search"
              ref={searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text(labels.placeholder)}
            />
          </label>
          <Button variant="ghost" onClick={() => choose()}>
            <ArrowLeft size={17} aria-hidden="true" />
            {text(labels.topics)}
          </Button>
        </div>
        {topic && !selected && !troubleshooting && (
          <p role="status" className="help-info">
            {text(labels.unknown)}
          </p>
        )}
        {selected && !needle && (
          <article
            className="help-article"
            aria-labelledby="help-article-title"
          >
            <span className="eyebrow">{text(labels.selected)}</span>
            <h2 id="help-article-title" ref={articleHeading} tabIndex={-1}>
              {text(selected.title)}
            </h2>
            <p>{text(selected.summary)}</p>
            <h3>{text(labels.steps)}</h3>
            <ol>
              {text(selected.steps).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <section
              className="help-problem"
              aria-labelledby="help-problem-title"
            >
              <h3 id="help-problem-title">{text(labels.wrong)}</h3>
              <p>
                <strong>{text(selected.problem)}</strong>
              </p>
              <ol>
                {text(selected.resolution).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
            <div className="help-actions">
              <Button asChild>
                <Link to={`/demo${selected.path === "/" ? "" : selected.path}`}>
                  {text(labels.practice)}
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to={selected.path}>{text(labels.real)}</Link>
              </Button>
            </div>
            <p className="help-fine-print">{text(labels.access)}</p>
          </article>
        )}
        {troubleshooting && !needle && (
          <section
            className="help-recovery"
            aria-labelledby="help-recovery-title"
          >
            <h2 id="help-recovery-title" ref={articleHeading} tabIndex={-1}>
              {text(labels.troubleshooting)}
            </h2>
            <div className="help-recovery-grid">
              {recovery.map((item) => (
                <article key={item.title.en}>
                  <h3>{text(item.title)}</h3>
                  <p>{text(item.body)}</p>
                  <Link to={`/help?topic=${item.topic}`}>
                    {text(
                      guideModules.find((module) => module.id === item.topic)!
                        .title,
                    )}
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </article>
              ))}
            </div>
            <aside className="help-support">
              <h3>
                {i18n.language.startsWith("de")
                  ? "Eine Rückfrage vorbereiten"
                  : "Prepare a support request"}
              </h3>
              <p>
                {i18n.language.startsWith("de")
                  ? "Notiere den Bereich, den Zeitpunkt mit Zeitzone, die ausgeführte Aktion und die sichtbare Fehlermeldung. Beschreibe, was du erwartet hast und was tatsächlich geschah. Entferne private Daten aus Screenshots. Teile keine Passwörter, MFA-Codes, Schlüssel, privaten Nachrichten oder Vertragsinhalte. Diese Hilfe sendet keine Nachricht; wende dich über euren vereinbarten Kontaktweg an die zuständige Verwaltung."
                  : "Note the section, time with time zone, action and visible error message. Describe what you expected and what happened. Remove private data from screenshots. Never share passwords, MFA codes, keys, private messages or contract contents. This help page sends no message; contact the responsible administrator through your agreed support channel."}
              </p>
            </aside>
          </section>
        )}
        <section aria-labelledby="help-sections-title">
          <h2 id="help-sections-title">{text(labels.topics)}</h2>
          <p className="help-result-count" role="status">
            {text(labels.count)}: {results.length}
          </p>
          {results.length ? (
            <div className="help-grid">
              {results.map((module, index) => (
                <Link
                  className={`help-card help-accent-${index % 7}`}
                  key={module.id}
                  to={`/help?topic=${module.id}`}
                  onClick={() => setQuery("")}
                >
                  <BookOpen size={21} aria-hidden="true" />
                  <h3>{text(module.title)}</h3>
                  <p>{text(module.summary)}</p>
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="help-empty">
              <p>{text(labels.empty)}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  searchInput.current?.focus();
                }}
              >
                {text(labels.reset)}
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
