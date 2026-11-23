/**
 * Explicit navigation guidance inside the live portal, without performing business mutations.
 * The shell keys this component by actor; current capabilities and readiness shape every render.
 */
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CircleHelp, Compass } from "lucide-react";
import { Button } from "../../components/ui/button";
import { guideText } from "./catalog";
import {
  initialTour,
  permittedTourModules,
  readTour,
  storeTour,
  type TourState,
} from "./tour-state";
import "./tour.css";

const copy = {
  de: {
    title: "Portal-Rundgang",
    resume: "Rundgang fortsetzen",
    pause: "Pausieren",
    close: "Schließen",
    next: "Weiter",
    back: "Zurück",
    finish: "Rundgang abschließen",
    open: "Diesen Bereich öffnen",
    section: "Bereich auswählen",
    help: "Hilfe zu diesem Bereich",
    done: "Rundgang abgeschlossen. Du kannst ihn jederzeit neu starten.",
    safe: "Du bist im echten Portal. Der Rundgang erklärt nur und führt keine Aktionen aus.",
    unavailable: "Der Rundgang wartet auf die aktuellen Zugriffsrechte.",
    loadError:
      "Die Zugriffsrechte konnten nicht geladen werden. Lade sie erneut, bevor du den Rundgang startest.",
    retry: "Zugriffsrechte erneut laden",
    count: "Schritt",
  },
  en: {
    title: "Portal tour",
    resume: "Resume tour",
    pause: "Pause",
    close: "Close",
    next: "Next",
    back: "Back",
    finish: "Finish tour",
    open: "Open this section",
    section: "Choose a section",
    help: "Help with this section",
    done: "Tour completed. You can restart it at any time.",
    safe: "You are in the live portal. The tour only explains and never performs actions.",
    unavailable: "The tour is waiting for current access permissions.",
    loadError:
      "Access permissions could not be loaded. Reload them before starting the tour.",
    retry: "Reload access permissions",
    count: "Step",
  },
};

/** Read progress on the actor-keyed mount; navigation occurs only after explicit tour controls are used. */
export function PortalTour({
  actor,
  roles,
  permissions,
  ready,
  failed = false,
  retrying = false,
  onRetry,
  children,
}: {
  actor: string;
  roles: readonly string[];
  permissions: readonly string[];
  ready: boolean;
  failed?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const { i18n } = useTranslation();
  const text = guideText(copy, i18n.language);
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<TourState>(() => readTour(actor));
  const heading = useRef<HTMLHeadingElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  // Restore focus after an explicit retry, pause or completion.
  // The launcher may mount on a later render when navigation commits.
  const retryRequested = useRef(false);
  // Recompute visible stops from current capabilities; stored progress never grants a destination.
  const modules = permittedTourModules(roles, permissions);
  const index = Math.max(
    0,
    modules.findIndex((module) => module.id === state.step),
  );
  const step = modules[index];
  const manualWelcome = /^\/welcome\/?$/.test(location.pathname);
  const active =
    ready && !manualWelcome && state.status === "active" && Boolean(step);
  const update = (next: TourState) => {
    setState(next);
    storeTour(actor, next);
  };
  // Update guidance progress and navigate only; destination pages retain their normal access checks.
  const visit = (position: number) => {
    const next = modules[position];
    if (!next) return;
    update({ status: "active", step: next.id });
    navigate(next.path);
  };
  useLayoutEffect(() => {
    if (active) {
      heading.current?.focus();
      return;
    }
    const button = launcher.current;
    if (!ready || !retryRequested.current || !button || button.disabled) return;
    button.focus();
    if (button.ownerDocument.activeElement === button) {
      retryRequested.current = false;
    }
  }, [active, ready, state.step, location.pathname]);
  useEffect(() => {
    if (!active) return;
    const onEscape = (event: KeyboardEvent) => {
      // Do not consume Escape belonging to a real form/dialog on this page.
      if (
        event.key !== "Escape" ||
        !heading.current?.parentElement?.contains(document.activeElement)
      )
        return;
      const paused: TourState = { status: "paused", step: state.step };
      setState(paused);
      storeTour(actor, paused);
      retryRequested.current = true;
      navigate("/settings");
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [active, actor, state.step, navigate]);
  if (!active && location.pathname !== "/settings") return <>{children}</>;
  return (
    <>
      {!active && children}
      <section className="portal-tour" aria-label={text.title}>
        <div className="portal-tour-entry">
          <Button
            ref={launcher}
            variant="secondary"
            disabled={!ready || !step}
            onClick={() => visit(state.status === "paused" ? index : 0)}
          >
            <Compass size={18} aria-hidden="true" />
            {state.status === "paused" ? text.resume : text.title}
          </Button>
          <Link to="/help" className="text-link">
            <CircleHelp size={18} aria-hidden="true" />
            {i18n.language.startsWith("de")
              ? "Hilfe & Anleitungen"
              : "Help & guides"}
          </Link>
        </div>
        {!ready &&
          (failed ? (
            <div role="alert">
              <p>{text.loadError}</p>
              {onRetry && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    retryRequested.current = true;
                    onRetry();
                  }}
                  disabled={retrying}
                >
                  {text.retry}
                </Button>
              )}
            </div>
          ) : (
            <p role="status">{text.unavailable}</p>
          ))}
        {state.status === "completed" && <p role="status">{text.done}</p>}
        {active && step && (
          <div className="portal-tour-content">
            <p className="fine-print">{text.safe}</p>
            <p aria-live="polite">
              {text.count} {index + 1} / {modules.length}
            </p>
            <progress
              value={index + 1}
              max={modules.length}
              aria-label={text.title}
            />
            <h2 tabIndex={-1} ref={heading}>
              {guideText(step.title, i18n.language)}
            </h2>
            <p>{guideText(step.summary, i18n.language)}</p>
            <ol>
              {guideText(step.steps, i18n.language).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
            <label className="portal-tour-jump">
              {text.section}
              <select
                value={step.id}
                onChange={(event) =>
                  visit(
                    modules.findIndex(
                      (module) => module.id === event.target.value,
                    ),
                  )
                }
              >
                {modules.map((module) => (
                  <option value={module.id} key={module.id}>
                    {guideText(module.title, i18n.language)}
                  </option>
                ))}
              </select>
            </label>
            <div className="portal-tour-controls">
              <Button
                variant="secondary"
                disabled={index === 0}
                onClick={() => visit(index - 1)}
              >
                {text.back}
              </Button>
              {location.pathname !== step.path && (
                <Button variant="secondary" onClick={() => navigate(step.path)}>
                  {text.open}
                </Button>
              )}
              <Button
                onClick={() => {
                  if (index + 1 === modules.length) {
                    update({ status: "completed", step: step.id });
                    retryRequested.current = true;
                    navigate("/settings");
                  } else visit(index + 1);
                }}
              >
                {index + 1 === modules.length ? text.finish : text.next}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  update({ status: "paused", step: step.id });
                  retryRequested.current = true;
                  navigate("/settings");
                }}
              >
                {text.pause}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  update(initialTour);
                  retryRequested.current = true;
                  navigate("/settings");
                }}
              >
                {text.close}
              </Button>
              <Link to={`/help?topic=${encodeURIComponent(step.id)}`}>
                {text.help}
              </Link>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
