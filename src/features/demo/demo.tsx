/**
 * Public fictional practice workspace driven by the authored guide catalog. Business inputs and
 * outcomes live only in this component; the demo imports no backend client or account session.
 */
import {useEffect, useMemo, useRef, useState} from "react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Compass,
  FileCheck2,
  FlaskConical,
  FolderOpen,
  GraduationCap,
  Home,
  type LucideIcon,
  Menu,
  MessageCircle,
  MessagesSquare,
  Receipt,
  RotateCcw,
  Settings2,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import {Button} from "../../components/ui/button";
import {PageHeading} from "../../components/common";
import {Preferences} from "../../components/preferences";
import {
  PortalNavigation,
  type PortalNavigationItem,
} from "../../components/portal-navigation";
import {guideModules, guideText} from "../help/catalog";
import {LearnerDemo} from "./learner-demo";
import {findFictionalCourse, learnerDemoModules} from "./learner-demo-data";
import "./i18n";
import "./demo.css";

/** Change the educational perspective only; this selector never establishes a real role. */
type DemoRole = "lecturer" | "management" | "admin" | "client" | "participant";
type Outcome = "success" | "filled" | "conflict" | "qualification" | "offline";
const demoPath = (path: string) => `/demo${path === "/" ? "" : path}`;
const sessions = ["2030-05-06T08:00:00Z", "2030-05-07T08:00:00Z"];
const demoIcons: Record<string, LucideIcon> = {
    "/": Home,
    "/auth/password": UserRound,
    "/jobs": BriefcaseBusiness,
    "/calendar": CalendarDays,
    "/availability": CalendarDays,
    "/chats": MessagesSquare,
    "/files": FolderOpen,
    "/contracts": FileCheck2,
    "/finance": Wallet,
    "/admin": Settings2,
    "/client": Building2,
    "/clients": Building2,
    "/people": Users,
    "/my-reviews": Receipt,
    "/wiki": BookOpen,
    "/forum": MessageCircle,
    "/notifications": Bell,
    "/settings": Settings2,
    "/profile": UserRound,
    "/courses": GraduationCap,
    "/learning": GraduationCap,
};

/** Select only fictional guide modules suitable for the chosen demo perspective. */
function demoModulesForRole(role: DemoRole) {
    if (role === "participant") return learnerDemoModules;
    return guideModules.filter((module) => {
        if (role === "management" || role === "admin") return true;
        if (module.permission || module.path.startsWith("/admin")) return false;
        if (module.roles?.length) {
            return role === "client"
                ? module.roles.includes("client")
                : module.roles.includes("lecturer") ||
                module.roles.includes("senior_lecturer");
        }
        if (role === "client")
            return !["/jobs", "/availability", "/people", "/my-reviews"].includes(
                module.path,
            );
        return !["/client", "/clients", "/my-reviews"].includes(module.path);
    });
}

/** Convert the authored help catalogue into a shared, auth-free portal nav projection. */
function demoNavigationItems(
    role: DemoRole,
    locale: string,
): PortalNavigationItem[] {
    return demoModulesForRole(role).map((module) => ({
        to: demoPath(module.path),
        label: guideText(module.title, locale),
        icon: demoIcons[module.path] ?? BookOpen,
        end: module.path === "/" || module.path === "/learning",
    }));
}

/** Return distinct, wholly fictional dashboard counts for the chosen perspective. */
function demoDashboardStats(
    role: DemoRole,
    claimed: boolean,
    event: boolean,
    messageCount: number,
    publishedJob: boolean,
) {
    if (role === "management")
        return [
            {label: "statOpenOffers", value: publishedJob ? 2 : 1},
            {label: "statConfirmedBlocks", value: claimed ? 3 : 2},
            {label: "statCourseRuns", value: 4},
        ];
    if (role === "admin")
        return [
            {label: "statCompanies", value: 3},
            {label: "statAccounts", value: 7},
            {label: "statAuditEvents", value: 12},
        ];
    if (role === "client")
        return [
            {label: "statOwnedCourses", value: 2},
            {label: "statParticipants", value: 12},
            {label: "statOpenInvoices", value: 1},
        ];
    return [
        {label: "reserved", value: claimed ? 1 : 0},
        {label: "calendar", value: (claimed ? 2 : 0) + (event ? 1 : 0)},
        {label: "messages", value: messageCount},
    ];
}

/** Render local practice state; only the shared visual-preference control uses persistent storage. */
export function DemoPage() {
    const {t, i18n} = useTranslation("demo");
    const {t: learner} = useTranslation("learnerDemo");
    const location = useLocation();
    const navigate = useNavigate();
    const heading = useRef<HTMLHeadingElement>(null);
    const launcher = useRef<HTMLButtonElement>(null);
    const mobileNavigation = useRef<HTMLDetailsElement>(null);
    const restoreLauncherFocus = useRef(false);
    const [role, setRole] = useState<DemoRole>(() => {
        const initialPath = location.pathname.replace(/^\/demo|\/$/g, "");
        if (initialPath === "/learning" || initialPath === "/my-reviews" || findFictionalCourse(initialPath))
            return "participant";
        if (location.pathname.startsWith("/demo/admin")) return "management";
        if (location.pathname.startsWith("/demo/client")) return "client";
        return "lecturer";
    });
    const visibleModules = useMemo(() => demoModulesForRole(role), [role]);
    const navigationItems = useMemo(
        () => demoNavigationItems(role, i18n.language),
        [i18n.language, role],
    );
    const mobileNavigationItems = useMemo(() => {
        const paths =
            role === "management" || role === "admin" || role === "lecturer"
                ? ["/", "/jobs", "/calendar", "/courses"]
                : role === "client"
                    ? ["/", "/calendar", "/courses", "/client"]
                    : ["/learning", "/my-reviews", "/notifications"];
        return navigationItems.filter((item) =>
            paths.map(demoPath).includes(item.to),
        );
    }, [navigationItems, role]);
    // Resolve URLs only against authored catalog entries; unknown destinations use the first section.
    const queryModule = new URLSearchParams(location.search).get("module");
    const requestedPath = location.pathname.replace(/^\/demo|\/$/g, "") || "/";
    const learnerCourse = role === "participant" ? findFictionalCourse(requestedPath) : undefined;
    const selected = visibleModules.find((item) =>
        queryModule ? item.id === queryModule : item.path === (learnerCourse ? "/learning" : requestedPath),
    );
    const module = selected ?? visibleModules[0] ?? guideModules[0];
    const index = visibleModules.indexOf(module);
    const path = module.path;
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
  const [courseFilter, setCourseFilter] = useState<"all" | "upcoming">("all");
    const [feedback, setFeedback] = useState<{
        key: string;
        path: string;
    } | null>(null);
    // Scope feedback to its originating section so navigation cannot show an unrelated result.
    const report = (key: string) => setFeedback(key ? {key, path} : null);

    /** Change only the local perspective; each real account permission remains untouched. */
    function changeRole(nextRole: DemoRole) {
        setRole(nextRole);
        if (nextRole === "participant") navigate("/demo/learning");
        setTour(false);
        setComplete(false);
        report("");
    }

    const selectionIsVisible = Boolean(selected);
  useEffect(() => {
    if (queryModule && selected) {
      navigate(demoPath(selected.path), { replace: true });
    }
  }, [navigate, queryModule, selected]);
    useEffect(() => {
        if (!selectionIsVisible)
            navigate(demoPath(visibleModules[0]?.path ?? "/"), {replace: true});
    }, [navigate, selectionIsVisible, visibleModules]);
    useEffect(() => {
        if (!learnerCourse || !location.hash) heading.current?.focus();
    }, [learnerCourse, location.hash, location.pathname, queryModule, role]);
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
    setCourseFilter("all");
        setTour(false);
        setComplete(false);
        setRole("lecturer");
        report("resetDone");
    }

    function visit(next: number) {
        navigate(demoPath(visibleModules[next].path));
        report("");
    }

    const date = (iso: string) =>
        new Intl.DateTimeFormat(
            i18n.language.startsWith("en") ? "en-GB" : "de-DE",
            {dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin"},
        ).format(new Date(iso));
    const description = guideText(module.summary, i18n.language);
    const customLearnerView = role === "participant" && path !== "/profile";
    // One exercise represents one complete block. Once claimed, its title and
    // accepted sessions stay fixed until an explicit reset starts a new round.
    const offerTitle = publishedJob || t("course");
    const publicationLocked = Boolean(publishedJob) || claimed;
    // These flags describe simulated exercises only, never confirmed portal records or assignments.
    const practiceDone =
        path === "/jobs"
            ? claimed
            : path === "/calendar" || path === "/availability"
                ? event
                : path === "/chats"
                    ? messages.length > 0
          : path === "/courses"
            ? courseFilter === "upcoming"
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
        <div className="app-shell demo-app" data-demo-role={role}>
            <a className="skip-link" href="#demo-main">
                {i18n.language.startsWith("en")
                    ? "Skip to demo content"
                    : "Zum Demo-Inhalt springen"}
            </a>
            <aside className="sidebar demo-sidebar" aria-label={t("navigation")}>
                <Link className="sidebar-brand" to="/demo">
                    <img src="/brand/luminovia-logo-mark-160.webp" alt=""/>
                    <span>
            Luminovia <small>Portal</small>
          </span>
                </Link>
                <div className="rainbow"/>
                <p className="sidebar-kicker">{t("badge")}</p>
                <PortalNavigation
                    items={role === "participant"
                        ? navigationItems.filter((item) => item.to !== "/demo/profile")
                        : navigationItems}
                    ariaLabel={t("navigation")}
                    onItemClick={() => report("")}
                />
                <div className="sidebar-bottom">
                    {role === "participant" && <Button asChild variant="secondary">
                        <Link to="/demo/profile">{guideText(learnerDemoModules[3].title, i18n.language)}</Link>
                    </Button>}
                    <p className="sidebar-note">{t("isolation")}</p>
                </div>
            </aside>
            <div className="workspace demo-workspace">
                <header className="topbar demo-topbar">
                    <Link className="demo-topbar-brand" to="/demo">
                        <img src="/brand/luminovia-logo-mark-160.webp" alt=""/>
                        <span>Luminovia</span>
                    </Link>
                    <div className="topbar-actions demo-topbar-actions">
                        <label className="demo-role-control" htmlFor="demo-role">
                            <span>{t("role")}</span>
                            <select
                                id="demo-role"
                                value={role}
                onChange={(event) =>
                  changeRole(event.currentTarget.value as DemoRole)
                }
                            >
                {(
                  [
                    "lecturer",
                    "management",
                    "admin",
                    "client",
                    "participant",
                  ] as const
                ).map((value) => (
                                        <option key={value} value={value}>
                                            {t(
                                                value === "client"
                                                    ? "roleCompany"
                                                    : value === "admin"
                                                        ? "roleAdmin"
                                                        : value,
                                            )}
                                        </option>
                ))}
                            </select>
                        </label>
                        <Preferences/>
                        <Button asChild variant="secondary">
              <Link className="demo-help-link" to="/help">
                {t("help")}
              </Link>
                        </Button>
            <Link className="demo-login-link" to="/login">
              {t("login")}
            </Link>
            <details
              className="mobile-more demo-mobile-more"
              ref={mobileNavigation}
            >
                            <summary aria-label={t("navigation")}>
                                <Menu size={20} aria-hidden="true"/>
                            </summary>
                            <div className="mobile-menu-panel">
                                <p className="demo-role-hint">{t("roleHint")}</p>
                                <PortalNavigation
                                    id="demo-mobile-navigation"
                                    className="demo-mobile-navigation"
                                    items={navigationItems}
                                    ariaLabel={t("navigation")}
                  onItemClick={() =>
                    mobileNavigation.current?.removeAttribute("open")
                  }
                                />
                            </div>
                        </details>
                    </div>
                </header>
                <main id="demo-main" className="main-content demo-main">
                    <div className="demo-safety" role="note">
                        <FlaskConical aria-hidden="true" size={20}/>
                        <span>{t("isolation")}</span>
                    </div>
                    {!selected && <p role="alert">{t("invalid")}</p>}
                    <PageHeading
                        eyebrow={t("badge")}
            title={
              learnerCourse ? t(learnerCourse.title)
                : path === "/" ? t("title") : guideText(module.title, i18n.language)
            }
                        description={learnerCourse ? learner("workspaceIntro") : path === "/" ? t("intro") : description}
                        headingRef={heading}
                        headingTabIndex={-1}
                        action={
                            <Button variant="secondary" onClick={reset}>
                                <RotateCcw aria-hidden="true" size={18}/>
                                {t("reset")}
                            </Button>
                        }
                    />
                    <p className="demo-perspective">
                        {t(`role${role[0].toUpperCase()}${role.slice(1)}`)}
                    </p>
                    <section className="demo-tour" aria-label={t("tour")}>
                        <div className="demo-tour-top">
                            <Compass aria-hidden="true"/>
                            <strong>{t("tour")}</strong>
                            <span aria-live="polite">
                {t("progress", {
                    current: index + 1,
                    total: visibleModules.length,
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
                                        <ArrowLeft size={16} aria-hidden="true"/>
                                        {t("previous")}
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            if (index === visibleModules.length - 1) {
                                                stopTour(true);
                                            } else visit(index + 1);
                                        }}
                                    >
                                        {t(index === visibleModules.length - 1 ? "finish" : "next")}
                                        <ArrowRight size={16} aria-hidden="true"/>
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
                        <div className="demo-stats kpi-grid">
              {demoDashboardStats(
                role,
                claimed,
                event,
                messages.length,
                Boolean(publishedJob),
              ).map((stat) => (
                                    <div key={stat.label}>
                                        <span>{t(stat.label)}</span>
                                        <strong>{stat.value}</strong>
                                    </div>
              ))}
                        </div>
                    )}
          {path === "/" && (
            <nav className="demo-shortcuts" aria-label={t("quickAccess")}>
              {navigationItems
                .filter((item) =>
                  ["/jobs", "/calendar", "/courses", "/chats", "/client"].some(
                    (route) => item.to === demoPath(route),
                  ),
                )
                .slice(0, 4)
                .map(({ to, label, icon: Icon }) => (
                  <Link key={to} to={to} className="demo-shortcut">
                    <Icon size={22} aria-hidden="true" />
                    <span>{label}</span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                ))}
            </nav>
          )}
                    {role === "participant" && <LearnerDemo path={path} course={learnerCourse}/>}
                    {!customLearnerView && <div className="demo-content-grid">
                        <section
                            className="panel demo-practice"
                            aria-labelledby="demo-practice-heading"
                        >
                            <div className="demo-section-heading">
                                <FlaskConical aria-hidden="true" size={20}/>
                                <h2 id="demo-practice-heading">{t("practice")}</h2>
                            </div>
                            <span className="demo-sample-label">{t("sample")}</span>
                            {path === "/jobs" ? (
                                <>
                                    <h3>{offerTitle}</h3>
                                    {publishedJob && <p>{t("adminPublished")}</p>}
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
                                            <h3>{offerTitle}</h3>
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
                                            disabled={publicationLocked}
                                            onChange={(e) => {
                                                setJobDraft(e.target.value);
                                                setSavedJob("");
                                            }}
                                        />
                                        <Button
                                            type="submit"
                                            disabled={!jobDraft.trim() || publicationLocked}
                                        >
                                            {t("adminDraft")}
                                        </Button>
                                    </form>
                                    <Button
                                        disabled={!savedJob || publicationLocked}
                                        onClick={() => {
                                            setPublishedJob(savedJob);
                                            report("adminPublished");
                                        }}
                                    >
                                        {t("adminPublish")}
                                    </Button>
                                    {claimed && <p>{t("adminClaimed")}</p>}
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
                                                setContentDrafts({...contentDrafts, [path]: ""});
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
              ) : path === "/courses" ? (
                <>
                  <div className="demo-course-toolbar">
                    <h3>{t("sampleCourses")}</h3>
                    <label htmlFor="demo-course-filter">
                      {t("courseFilter")}
                      <select
                        id="demo-course-filter"
                        value={courseFilter}
                        onChange={(event) =>
                          setCourseFilter(
                            event.currentTarget.value as "all" | "upcoming",
                          )
                        }
                      >
                        <option value="all">{t("filterAll")}</option>
                        <option value="upcoming">{t("filterUpcoming")}</option>
                      </select>
                    </label>
                  </div>
                  <div className="demo-course-list">
                    <article className="demo-course-card">
                      <span className="demo-sample-label">{t("sample")}</span>
                      <h4>{t("course")}</h4>
                      <p>
                        {t("sampleOrganisation")} · {date(sessions[0])}
                      </p>
                      <div className="demo-course-links">
                        <Link to="/demo/calendar">{t("sampleSchedule")}</Link>
                        <Link to="/demo/chats">{t("sampleChat")}</Link>
                        <Link to="/demo/files">{t("sampleFiles")}</Link>
                      </div>
                    </article>
                    {courseFilter === "all" && (
                      <article className="demo-course-card">
                        <span className="demo-sample-label">{t("sample")}</span>
                        <h4>{t("samplePastCourse")}</h4>
                        <p>
                          {t("sampleOrganisation")} · {t("samplePastDate")}
                        </p>
                        <div className="demo-course-links">
                          <Link to="/demo/files">{t("sampleFiles")}</Link>
                        </div>
                      </article>
                    )}
                  </div>
                </>
                            ) : (
                                <>
                                    <h3>
                                        {t(
                                            path === "/notifications" || path === "/settings"
                                                ? "notification"
                                                : path === "/people" ||
                                                path === "/admin/people" ||
                                                path === "/admin/accounts"
                                                    ? "profile"
                                                    : path === "/clients"
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
                            className="panel demo-explanation"
                            aria-labelledby="demo-steps-heading"
                        >
                            <div className="demo-section-heading">
                                <BookOpen aria-hidden="true" size={20}/>
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
                    </div>}
                </main>
            </div>
            <div className="mobile-nav demo-mobile-nav">
                <PortalNavigation
                    className="demo-mobile-primary-nav"
                    items={mobileNavigationItems}
                    ariaLabel={t("navigation")}
                    onItemClick={() => report("")}
                />
                <button
                    type="button"
                    className="demo-mobile-more-button"
                    aria-label={t("navigationMore")}
                    onClick={() => {
                        mobileNavigation.current?.setAttribute("open", "");
                        mobileNavigation.current?.querySelector("summary")?.focus();
                    }}
                >
                    <Menu size={20} aria-hidden="true"/>
                    <span>{t(role === "participant" ? "learnerMore" : "navigationMore")}</span>
                </button>
            </div>
        </div>
    );
}