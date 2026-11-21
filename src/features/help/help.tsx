/**
 * Public, authored help with URL-selected articles and search across both languages. Reading,
 * filtering and recovery guidance require no backend data and send no support messages.
 */
import {
  installationBrand,
  portalInternalEdition,
} from "../../lib/installation-brand";
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
import helpCatalogue from "@edition-help";
import { type GuideModule, guideText } from "./guide";
import "./help.css";

const labels = {
  title: { de: "Hilfe & Anleitungen", en: "Help & guides" },
  subtitle: {
    de: "Verstehe die Abläufe, probiere sie mit Beispieldaten aus und finde den nächsten sinnvollen Schritt bei Problemen.",
    en: "Understand workflows, try them with sample data and find the next practical step when something goes wrong.",
  },
  search: { de: "Suche in der Hilfe", en: "Search help" },
  placeholder: {
    de: "Zum Beispiel: Übernahme, Passwort, Upload …",
    en: "For example: claim, password, upload …",
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
const { modules: visibleHelpModules, recovery: visibleRecovery } =
  helpCatalogue;

/** Search titles, steps and recovery text in both authored languages regardless of the selected UI language. */
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

/** Resolve public catalog topics from the URL and keep search/filter state local to this page. */
export function HelpCenter({ embedded = false }: { embedded?: boolean }) {
  const { i18n } = useTranslation();
  const Content = embedded ? "section" : "main";
  const text = <T,>(value: { de: T; en: T }) => guideText(value, i18n.language);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const articleHeading = useRef<HTMLHeadingElement>(null);
  const topic = params.get("topic");
  const selected = visibleHelpModules.find((module) => module.id === topic);
  const troubleshooting = topic === "troubleshooting";
  useEffect(() => {
    // URL navigation should reveal the chosen instructions to keyboard users too.
    // Reopening the same topic after a search creates a new history key as well.
    articleHeading.current?.focus();
  }, [location.key]);
  const needle = query.trim().toLocaleLowerCase();
  const results = visibleHelpModules.filter((module) =>
    searchText(module).includes(needle),
  );

  function choose(id?: string) {
    setQuery("");
    const next = new URLSearchParams(params);
    if (id) next.set("topic", id);
    else next.delete("topic");
    setParams(next);
  }

  return (
    <div className={embedded ? "help-page help-embedded" : "help-page"}>
      <a className="skip-link" href="#help-main">
        {i18n.language.startsWith("de") ? "Zum Inhalt" : "Skip to content"}
      </a>
      {!embedded && (
        <header className="help-header">
          <Link
            className="help-brand"
            to="/help"
            aria-label={installationBrand.name}
          >
            <img src={installationBrand.mark} alt="" />
            {portalInternalEdition ? (
              <span>
                {installationBrand.shortName} <small>PORTAL</small>
              </span>
            ) : (
              <span className="installation-brand-name">
                {installationBrand.shortName}
              </span>
            )}
          </Link>
          <div className="help-header-actions">
            <Preferences />
            <Link to="/login">{text(labels.login)}</Link>
          </div>
        </header>
      )}
      <Content id="help-main" className="help-main" tabIndex={-1}>
        <section className="help-hero" aria-labelledby="help-title">
          <div className="eyebrow">{installationBrand.name}</div>
          <h1 id="help-title">{text(labels.title)}</h1>
          <p>
            {text(
              portalInternalEdition
                ? labels.subtitle
                : {
                    de: "Anleitungen für Kurse, Stundenplan, Prüfungen und die Akademieverwaltung.",
                    en: "Guides for courses, timetables, exams and academy administration.",
                  },
            )}
          </p>
          <div className="help-actions">
            <Button asChild variant="secondary">
              <Link to="/api/docs">
                {i18n.language.startsWith("de")
                  ? "API-Dokumentation"
                  : "API documentation"}
              </Link>
            </Button>
            {!portalInternalEdition && (
              <Button asChild variant="ghost">
                <a href="/api/openapi.json" download>
                  OpenAPI JSON
                </a>
              </Button>
            )}
            {portalInternalEdition && (
              <Button asChild>
                <Link to="/demo">
                  {text(labels.demo)}
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </Button>
            )}
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
              placeholder={text(
                portalInternalEdition
                  ? labels.placeholder
                  : {
                      de: "Kurs, Prüfung, Stundenplan …",
                      en: "Course, exam, timetable …",
                    },
              )}
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
              {portalInternalEdition && (
                <Button asChild>
                  <Link
                    to={`/demo${selected.path === "/" ? "" : selected.path}`}
                  >
                    {text(labels.practice)}
                  </Link>
                </Button>
              )}
              <Button asChild variant="secondary">
                <Link to={selected.path}>{text(labels.real)}</Link>
              </Button>
            </div>
            {portalInternalEdition && (
              <p className="help-fine-print">{text(labels.access)}</p>
            )}
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
              {visibleRecovery
                .filter(({ topic }) =>
                  visibleHelpModules.some(({ id }) => id === topic),
                )
                .map((item) => (
                  <article key={item.title.en}>
                    <h3>{text(item.title)}</h3>
                    <p>{text(item.body)}</p>
                    <Link to={`/help?topic=${item.topic}`}>
                      {text(
                        visibleHelpModules.find(
                          (module) => module.id === item.topic,
                        )!.title,
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
                  ? "Notiere den Bereich, den Zeitpunkt mit Zeitzone, die ausgeführte Aktion und die sichtbare Fehlermeldung. Beschreibe, was du erwartet hast und was tatsächlich geschah. Entferne private Daten aus Screenshots. Teile keine Passwörter, Schlüssel, privaten Nachrichten oder Vertragsinhalte. Diese Hilfe sendet keine Nachricht; wende dich über euren vereinbarten Kontaktweg an die zuständige Verwaltung."
                  : "Note the section, time with time zone, action and visible error message. Describe what you expected and what happened. Remove private data from screenshots. Never share passwords, keys, private messages or contract contents. This help page sends no message; contact the responsible administrator through your agreed support channel."}
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
      </Content>
    </div>
  );
}
