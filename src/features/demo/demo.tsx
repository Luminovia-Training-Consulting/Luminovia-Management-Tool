/**
 * Public fictional practice workspace driven by the authored guide catalog. Business inputs and
 * outcomes live only in this component; the demo imports no backend client or account session.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Compass,
  FlaskConical,
  RotateCcw,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Preferences } from "../../components/preferences";
import { guideModules, guideText } from "../help/catalog";
import "./i18n";
import "./demo.css";

/** Change the educational perspective only; this selector never establishes a real role. */
type DemoRole = "lecturer" | "management" | "client" | "participant";
type Outcome = "success" | "filled" | "conflict" | "qualification" | "offline";
const demoPath = (path: string) => `/demo${path === "/" ? "" : path}`;
const sessions = ["2030-05-06T08:00:00Z", "2030-05-07T08:00:00Z"];

/** Render local practice state; only the shared visual-preference control uses persistent storage. */
export function DemoPage() {
  const { t, i18n } = useTranslation("demo");
  const location = useLocation();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const restoreLauncherFocus = useRef(false);
  // Resolve URLs only against authored catalog entries; unknown destinations use the first section.
  const queryModule = new URLSearchParams(location.search).get("module");
  const requestedPath = location.pathname.replace(/^\/demo/, "") || "/";
  const selected = guideModules.find((module) =>
    queryModule ? module.id === queryModule : module.path === requestedPath,
  );
  const module = selected ?? guideModules[0];
  const index = guideModules.indexOf(module);
  const path = module.path;
  const [role, setRole] = useState<DemoRole>("lecturer");
  const [tour, setTour] = useState(false);
  const [complete, setComplete] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("success");
  const [claimResult, setClaimResult] = useState<Outcome | null>(null);
  const [event, setEvent] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("Demo Alex");
  const [savedName, setSavedName] = useState("Demo Alex");
  const [scanned, setScanned] = useState(false);
  const [invoice, setInvoice] = useState(false);
  const [jobDraft, setJobDraft] = useState("");
  const [savedJob, setSavedJob] = useState("");
  const [publishedJob, setPublishedJob] = useState("");
  const [request, setRequest] = useState("");
  const [savedRequest, setSavedRequest] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [contentDrafts, setContentDrafts] = useState<Record<string, string>>(
    {},
  );
  const [contentPosts, setContentPosts] = useState<Record<string, string[]>>(
    {},
  );
  const [checked, setChecked] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{
    key: string;
    path: string;
  } | null>(null);
  // Scope feedback to its originating section so navigation cannot show an unrelated result.
  const report = (key: string) => setFeedback(key ? { key, path } : null);
  useEffect(() => {
    heading.current?.focus();
  }, [location.pathname, queryModule]);
  useEffect(() => {
    // Pause/finish remove their triggering button. Restore keyboard focus to
    // the surviving launcher after its new label/ref have been committed.
    if (!tour && restoreLauncherFocus.current) {
      restoreLauncherFocus.current = false;
      launcher.current?.focus();
    }
  }, [tour]);
  /** Restore launcher focus after pause/finish removes the active tour controls. */
  function stopTour(completed = false) {
    restoreLauncherFocus.current = true;
    setTour(false);
    if (completed) setComplete(true);
  }
  /** Clear every fictional workflow and tour state while keeping the current route and visual preferences. */
  function reset() {
    setClaimed(false);
    setOutcome("success");
    setClaimResult(null);
    setEvent(false);
    setMessages([]);
    setDraft("");
    setName("Demo Alex");
    setSavedName("Demo Alex");
    setScanned(false);
    setInvoice(false);
    setJobDraft("");
    setSavedJob("");
    setPublishedJob("");
    setRequest("");
    setSavedRequest("");
    setTermsAccepted(false);
    setContentDrafts({});
    setContentPosts({});
    setChecked([]);
    setTour(false);
    setComplete(false);
    setRole("lecturer");
    report("resetDone");
  }
  function visit(next: number) {
    navigate(demoPath(guideModules[next].path));
    report("");
  }
  const date = (iso: string) =>
    new Intl.DateTimeFormat(
      i18n.language.startsWith("en") ? "en-GB" : "de-DE",
      { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" },
    ).format(new Date(iso));
  const description = guideText(module.summary, i18n.language);
  // These flags describe simulated exercises only, never confirmed portal records or assignments.
  const practiceDone =
    path === "/jobs"
      ? claimed
      : path === "/calendar" || path === "/availability"
        ? event
        : path === "/chats"
          ? messages.length > 0
          : path === "/files"
            ? scanned
            : path === "/finance"
              ? invoice
              : path === "/admin"
                ? Boolean(publishedJob)
                : path === "/client"
                  ? Boolean(savedRequest)
                  : path === "/contracts"
                    ? termsAccepted
                    : path === "/wiki" || path === "/forum"
                      ? Boolean(contentPosts[path]?.length)
                      : checked.includes(path);
  return (
    <div className="demo-app">
      <a className="skip-link" href="#demo-main">
        {i18n.language.startsWith("en")
          ? "Skip to demo content"
          : "Zum Demo-Inhalt springen"}
      </a>
      <header className="demo-header">
        <Link className="demo-brand" to="/demo">
          <img src="/brand/luminovia-logo-mark-160.webp" alt="" />
          <span>
            Luminovia <small>PORTAL DEMO</small>
          </span>
        </Link>
        <div className="demo-header-actions">
          <Preferences />
          <Button asChild variant="secondary">
            <Link to="/help">{t("help")}</Link>
          </Button>
          <Link to="/login">{t("login")}</Link>
        </div>
      </header>
      <div className="demo-safety">
        <FlaskConical aria-hidden="true" size={22} />
        <div>
          <strong>{t("badge")}</strong>
          <p>{t("isolation")}</p>
        </div>
      </div>
      <div className="demo-layout">
        <aside className="demo-sidebar">
          <label htmlFor="demo-role">{t("role")}</label>
          <select
            id="demo-role"
            value={role}
            onChange={(e) => setRole(e.target.value as DemoRole)}
          >
            {(["lecturer", "management", "client", "participant"] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ),
            )}
          </select>
          <p className="demo-role-hint">{t("roleHint")}</p>
          <nav aria-label={t("navigation")}>
            {guideModules.map((item) => (
              <Link
                key={item.path}
                to={demoPath(item.path)}
                aria-current={item.path === path ? "page" : undefined}
              >
                {guideText(item.title, i18n.language)}
              </Link>
            ))}
          </nav>
        </aside>
        <main id="demo-main" className="demo-main">
          {!selected && <p role="alert">{t("invalid")}</p>}
          <section className="demo-intro">
            <div>
              <p className="eyebrow">{t("badge")}</p>
              <h1 ref={heading} tabIndex={-1}>
                {path === "/"
                  ? t("title")
                  : guideText(module.title, i18n.language)}
              </h1>
              <p>{path === "/" ? t("intro") : description}</p>
            </div>
            <Button variant="secondary" onClick={reset}>
              <RotateCcw aria-hidden="true" size={18} />
              {t("reset")}
            </Button>
          </section>
          <p className="demo-perspective">
            {t(`role${role[0].toUpperCase()}${role.slice(1)}`)}
          </p>
          <section className="demo-tour" aria-label={t("tour")}>
            <div className="demo-tour-top">
              <Compass aria-hidden="true" />
              <strong>{t("tour")}</strong>
              <span aria-live="polite">
                {t("progress", {
                  current: index + 1,
                  total: guideModules.length,
                })}
              </span>
            </div>
            {tour ? (
              <>
                <p>{description}</p>
                <div className="demo-controls">
                  <Button
                    variant="secondary"
                    disabled={index === 0}
                    onClick={() => visit(index - 1)}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    {t("previous")}
                  </Button>
                  <Button
                    onClick={() => {
                      if (index === guideModules.length - 1) {
                        stopTour(true);
                      } else visit(index + 1);
                    }}
                  >
                    {t(index === guideModules.length - 1 ? "finish" : "next")}
                    <ArrowRight size={16} aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" onClick={() => stopTour()}>
                    {t("pause")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p>{complete ? t("completed") : description}</p>
                <Button
                  ref={launcher}
                  onClick={() => {
                    heading.current?.focus();
                    setTour(true);
                    setComplete(false);
                    if (complete) visit(0);
                  }}
                >
                  {t(complete ? "restart" : "start")}
                </Button>
              </>
            )}
          </section>
          {path === "/" && (
            <div className="demo-stats">
              <div>
                <span>{t("reserved")}</span>
                <strong>{claimed ? 1 : 0}</strong>
              </div>
              <div>
                <span>{t("calendar")}</span>
                <strong>{(claimed ? 2 : 0) + (event ? 1 : 0)}</strong>
              </div>
              <div>
                <span>{t("messages")}</span>
                <strong>{messages.length}</strong>
              </div>
            </div>
          )}
          <div className="demo-content-grid">
            <section
              className="demo-practice"
              aria-labelledby="demo-practice-heading"
            >
              <div className="demo-section-heading">
                <FlaskConical aria-hidden="true" size={20} />
                <h2 id="demo-practice-heading">{t("practice")}</h2>
              </div>
              <span className="demo-sample-label">{t("sample")}</span>
              {path === "/jobs" ? (
                <>
                  {publishedJob && (
                    <div className="demo-published-job">
                      <h3>{publishedJob}</h3>
                      <p>{t("adminPublished")}</p>
                    </div>
                  )}
                  <h3>{t("course")}</h3>
                  <p>{t("fee")}</p>
                  <ul>
                    {sessions.map((session) => (
                      <li key={session}>
                        {date(session)}–15:00 · Europe/Berlin
                      </li>
                    ))}
                  </ul>
                  <p>{t("claimHint")}</p>
                  <label htmlFor="demo-outcome">{t("outcome")}</label>
                  <select
                    id="demo-outcome"
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value as Outcome)}
                  >
                    {(
                      [
                        "success",
                        "filled",
                        "conflict",
                        "qualification",
                        "offline",
                      ] as const
                    ).map((value) => (
                      <option value={value} key={value}>
                        {t(value)}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={() => {
                      setClaimResult(outcome);
                      if (outcome === "success") setClaimed(true);
                    }}
                    disabled={claimed}
                  >
                    {t("claim")}
                  </Button>
                  <p className="demo-status">
                    {t(claimed ? "reserved" : "available")}
                  </p>
                  {claimResult && (
                    <p role="status">
                      {t(
                        claimResult === "success"
                          ? "claimed"
                          : `${claimResult}Body`,
                      )}
                    </p>
                  )}
                </>
              ) : path === "/calendar" || path === "/availability" ? (
                <>
                  <h3>{t("calendar")}</h3>
                  {claimed ? (
                    <>
                      <p>{t("assignment")}</p>
                      <ul>
                        {sessions.map((session) => (
                          <li key={session}>
                            {date(session)}–15:00 · Europe/Berlin
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>{t("pendingAssignment")}</p>
                  )}
                  <p>{t(event ? "eventAdded" : "noEvent")}</p>
                  <Button disabled={event} onClick={() => setEvent(true)}>
                    {t("event")}
                  </Button>
                </>
              ) : path === "/chats" ? (
                <>
                  <h3>{t("chat")}</h3>
                  <p>{t("chatSample")}</p>
                  <ul className="demo-messages">
                    {messages.map((message, itemIndex) => (
                      <li key={itemIndex}>{message}</li>
                    ))}
                  </ul>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (draft.trim()) {
                        setMessages([...messages, draft.trim()]);
                        setDraft("");
                        report("sent");
                      }
                    }}
                  >
                    <label htmlFor="demo-message">{t("message")}</label>
                    <textarea
                      id="demo-message"
                      maxLength={280}
                      aria-describedby="demo-message-hint"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <p id="demo-message-hint">{t("messageHint")}</p>
                    <Button disabled={!draft.trim()} type="submit">
                      {t("send")}
                    </Button>
                  </form>
                </>
              ) : path === "/profile" ? (
                <>
                  <h3>{savedName}</h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (name.trim()) {
                        setSavedName(name.trim());
                        setChecked([...new Set([...checked, path])]);
                        report("profileSaved");
                      }
                    }}
                  >
                    <label htmlFor="demo-name">{t("name")}</label>
                    <input
                      id="demo-name"
                      maxLength={80}
                      value={name}
                      aria-describedby="demo-profile-hint"
                      onChange={(e) => setName(e.target.value)}
                    />
                    <p id="demo-profile-hint">{t("profileHint")}</p>
                    <Button disabled={!name.trim()} type="submit">
                      {t("saveProfile")}
                    </Button>
                  </form>
                </>
              ) : path === "/files" ? (
                <>
                  <h3>{t("file")}</h3>
                  <p role="status">{t(scanned ? "scanned" : "quarantine")}</p>
                  <Button disabled={scanned} onClick={() => setScanned(true)}>
                    {t("scan")}
                  </Button>
                </>
              ) : path === "/finance" ? (
                <>
                  <h3>{t("fee")}</h3>
                  <p>{t("financeHint")}</p>
                  <Button disabled={invoice} onClick={() => setInvoice(true)}>
                    {t("invoice")}
                  </Button>
                  {invoice && <p role="status">{t("invoiceSaved")}</p>}
                </>
              ) : path === "/admin" ? (
                <>
                  <h3>{t("course")}</h3>
                  <p>{t("claimHint")}</p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (jobDraft.trim()) {
                        setSavedJob(jobDraft.trim());
                        report("adminDraftSaved");
                      }
                    }}
                  >
                    <label htmlFor="demo-job-title">{t("adminTitle")}</label>
                    <input
                      id="demo-job-title"
                      maxLength={80}
                      value={jobDraft}
                      disabled={Boolean(publishedJob)}
                      onChange={(e) => {
                        setJobDraft(e.target.value);
                        setSavedJob("");
                      }}
                    />
                    <Button
                      type="submit"
                      disabled={!jobDraft.trim() || Boolean(publishedJob)}
                    >
                      {t("adminDraft")}
                    </Button>
                  </form>
                  <Button
                    disabled={!savedJob || Boolean(publishedJob)}
                    onClick={() => {
                      setPublishedJob(savedJob);
                      report("adminPublished");
                    }}
                  >
                    {t("adminPublish")}
                  </Button>
                  {publishedJob && (
                    <>
                      <h4>{publishedJob}</h4>
                      <p>{t("adminLocked")}</p>
                      <Link to="/demo/jobs">
                        {guideText(
                          guideModules.find((item) => item.path === "/jobs")!
                            .title,
                          i18n.language,
                        )}
                      </Link>
                    </>
                  )}
                </>
              ) : path === "/client" ? (
                <>
                  <h3>{t("organisation")}</h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (request.trim()) {
                        setSavedRequest(request.trim());
                        report("requestSaved");
                      }
                    }}
                  >
                    <label htmlFor="demo-request">{t("request")}</label>
                    <textarea
                      id="demo-request"
                      maxLength={280}
                      value={request}
                      onChange={(e) => setRequest(e.target.value)}
                    />
                    <Button type="submit" disabled={!request.trim()}>
                      {t("requestSend")}
                    </Button>
                  </form>
                  {savedRequest && <blockquote>{savedRequest}</blockquote>}
                </>
              ) : path === "/contracts" ? (
                <>
                  <h3>{t("sampleTerms")}</h3>
                  <p>{t("financeHint")}</p>
                  <Button
                    disabled={termsAccepted}
                    onClick={() => setTermsAccepted(true)}
                  >
                    {t("acceptTerms")}
                  </Button>
                  {termsAccepted && <p role="status">{t("termsAccepted")}</p>}
                </>
              ) : path === "/wiki" || path === "/forum" ? (
                <>
                  <h3>{t(path === "/wiki" ? "wiki" : "forum")}</h3>
                  <ul className="demo-messages">
                    {(contentPosts[path] ?? []).map((post, postIndex) => (
                      <li key={postIndex}>{post}</li>
                    ))}
                  </ul>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const text = contentDrafts[path]?.trim();
                      if (text) {
                        setContentPosts({
                          ...contentPosts,
                          [path]: [...(contentPosts[path] ?? []), text],
                        });
                        setContentDrafts({ ...contentDrafts, [path]: "" });
                        report("contentPublished");
                      }
                    }}
                  >
                    <label htmlFor="demo-content">{t("draftContent")}</label>
                    <textarea
                      id="demo-content"
                      maxLength={500}
                      aria-describedby="demo-content-hint"
                      value={contentDrafts[path] ?? ""}
                      onChange={(e) =>
                        setContentDrafts({
                          ...contentDrafts,
                          [path]: e.target.value,
                        })
                      }
                    />
                    <p id="demo-content-hint">{t("contentHint")}</p>
                    <Button
                      type="submit"
                      disabled={!contentDrafts[path]?.trim()}
                    >
                      {t("publishContent")}
                    </Button>
                  </form>
                </>
              ) : (
                <>
                  <h3>
                    {t(
                      path === "/contracts"
                        ? "sampleTerms"
                        : path === "/notifications" || path === "/settings"
                          ? "notification"
                          : path === "/people" ||
                              path === "/admin/people" ||
                              path === "/admin/accounts"
                            ? "profile"
                            : path === "/wiki"
                              ? "wiki"
                              : path === "/forum"
                                ? "forum"
                                : path === "/security"
                                  ? "security"
                                  : path === "/clients" || path === "/client"
                                    ? "organisation"
                                    : "course",
                    )}
                  </h3>
                  <p>{description}</p>
                  <Button
                    disabled={checked.includes(path)}
                    onClick={() => {
                      setChecked([...new Set([...checked, path])]);
                      report("checked");
                    }}
                  >
                    {t("check")}
                  </Button>
                </>
              )}
              <p className="demo-progress-label">
                {t("state")}: {t(practiceDone ? "done" : "empty")}
              </p>
              {feedback?.path === path && (
                <p role="status">{t(feedback.key)}</p>
              )}
            </section>
            <section
              className="demo-explanation"
              aria-labelledby="demo-steps-heading"
            >
              <div className="demo-section-heading">
                <BookOpen aria-hidden="true" size={20} />
                <h2 id="demo-steps-heading">{t("steps")}</h2>
              </div>
              <ol>
                {guideText(module.steps, i18n.language).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <h3>{guideText(module.problem, i18n.language)}</h3>
              <ul>
                {guideText(module.resolution, i18n.language).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              <Button asChild variant="secondary">
                <Link to={`/help?topic=${encodeURIComponent(module.id)}`}>
                  {t("help")}
                </Link>
              </Button>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
