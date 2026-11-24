/**
 * Public, authored help with URL-selected articles and search across both languages. Reading,
 * filtering and recovery guidance require no backend data and send no support messages.
 */
import { portalInternalEdition } from "../../lib/installation-brand";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, Search } from "lucide-react";
import { SectionButton } from "../../components/section-card";
import { ApiNavigation } from "../developer-api/api-navigation";
import { Button } from "../../components/ui/button";
import { Preferences } from "../../components/preferences";
import { useAcademyBrand } from "../branding/academy-branding";
import { AcademyBrandImage } from "../branding/academy-logo-image";
import helpCatalogue from "@edition-help";
import { type GuideArea, type GuideModule, guideText } from "./guide";
import "./help.css";

const labels = {
  title: { de: "Hilfe & Anleitungen", en: "Help & guides" },
  subtitle: {
    de: "Finde Anleitungen für deine Arbeit im Portal und Lösungen für häufige Probleme.",
    en: "Find guides for working in the portal and solutions to common problems.",
  },
  search: { de: "Suche in der Hilfe", en: "Search help" },
  placeholder: {
    de: "Kurs, Passwort, Webhook",
    en: "Course, password, webhook",
  },
  login: { de: "Zum Portal", en: "Open portal" },
  topics: { de: "Anleitungen", en: "Guides" },
  area: { de: "Themenbereich", en: "Topic area" },
  allAreas: { de: "Alle Themen", en: "All topics" },
  overview: { de: "Zur Übersicht", en: "Back to overview" },
  problems: { de: "Probleme lösen", en: "Solve problems" },
  selected: { de: "Anleitung", en: "Guide" },
  steps: { de: "So gehst du vor", en: "What to do" },
  wrong: { de: "Wenn etwas nicht funktioniert", en: "If something goes wrong" },
  real: { de: "Bereich im Portal öffnen", en: "Open section in the portal" },
  empty: {
    de: "Keine passende Anleitung gefunden.",
    en: "No matching guide found.",
  },
  reset: { de: "Suche zurücksetzen", en: "Clear search" },
  count: { de: "Gefundene Anleitungen", en: "Matching guides" },
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
const areaLabels: Record<GuideArea, { de: string; en: string }> = {
  courses: { de: "Kurse & LMS", en: "Courses & LMS" },
  access: { de: "Anmeldung & Zugang", en: "Sign-in & access" },
  administration: { de: "Verwaltung", en: "Administration" },
  integrations: { de: "API & Webhooks", en: "API & webhooks" },
  portal: { de: "Portalnutzung", en: "Using the portal" },
};
const areas = (Object.keys(areaLabels) as GuideArea[]).filter((area) =>
  visibleHelpModules.some((module) => (module.area ?? "portal") === area),
);

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
  const brand = useAcademyBrand();
  const Content = embedded ? "section" : "main";
  const text = <T,>(value: { de: T; en: T }) => guideText(value, i18n.language);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const articleHeading = useRef<HTMLHeadingElement>(null);
  const topic = params.get("topic");
  const category = areas.find((area) => area === params.get("area")) ?? "";
  const selected = visibleHelpModules.find((module) => module.id === topic);
  const troubleshooting = topic === "troubleshooting";
  useEffect(() => {
    // URL navigation should reveal the chosen instructions to keyboard users too.
    // Reopening the same topic after a search creates a new history key as well.
    articleHeading.current?.focus();
  }, [location.key]);
  const needle = query.trim().toLocaleLowerCase();
  const results = visibleHelpModules.filter(
    (module) =>
      (!category || (module.area ?? "portal") === category) &&
      searchText(module).includes(needle),
  );

  function topicParams(id?: string) {
    const next = new URLSearchParams(params);
    if (id) next.set("topic", id);
    else next.delete("topic");
    return next;
  }

  function choose(id?: string) {
    setQuery("");
    setParams(topicParams(id));
  }

  function topicLink(id: string) {
    return { pathname: location.pathname, search: `?${topicParams(id)}` };
  }

  return (
    <div className={embedded ? "help-page help-embedded" : "help-page"}>
      <a className="skip-link" href="#help-main">
        {i18n.language.startsWith("de") ? "Zum Inhalt" : "Skip to content"}
      </a>
      {!embedded && (
        <header className="help-header">
          <Link className="help-brand" to="/help" aria-label={brand.name}>
            {portalInternalEdition ? (
              <>
                <img src={brand.mark} alt="" />
                <span>
                  {brand.shortName} <small>PORTAL</small>
                </span>
              </>
            ) : (
              <>
                <AcademyBrandImage fallback={brand.mark} alt="" />
                <span className="installation-brand-name">
                  {brand.shortName}
                </span>
              </>
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
          <label className="help-category">
            <span>{text(labels.area)}</span>
            <select
              value={category}
              onChange={(event) => {
                const next = topicParams();
                if (event.target.value) next.set("area", event.target.value);
                else next.delete("area");
                setParams(next);
              }}
            >
              <option value="">{text(labels.allAreas)}</option>
              {areas.map((area) => (
                <option key={area} value={area}>
                  {text(areaLabels[area])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ApiNavigation>
          {topic ? (
            <SectionButton
              title={text(labels.overview)}
              description={text({
                de: "Zur Suche und zu allen Anleitungen.",
                en: "Return to search and all guides.",
              })}
              onClick={() => {
                choose();
                searchInput.current?.focus();
              }}
            />
          ) : (
            <SectionButton
              title={text(labels.problems)}
              description={text({
                de: "Häufige Fehler Schritt für Schritt beheben.",
                en: "Troubleshoot common issues step by step.",
              })}
              onClick={() => choose("troubleshooting")}
            />
          )}
        </ApiNavigation>
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
              <Button asChild variant="secondary">
                <Link to={selected.path}>{text(labels.real)}</Link>
              </Button>
            </div>
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
                    <Link
                      to={topicLink(item.topic)}
                      onClick={() => setQuery("")}
                    >
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
                  to={topicLink(module.id)}
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
