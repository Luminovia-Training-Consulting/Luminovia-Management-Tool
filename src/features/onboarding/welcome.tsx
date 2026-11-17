import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Compass } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { permissionsQuery, userRolesQuery } from "../../lib/queries";
import { useAuth } from "../auth/auth-context";
import {
  saveWelcomeProgress,
  welcomeKey,
  welcomeProgressSchema,
  welcomeQuery,
  type WelcomeProgress,
  type WelcomeStep,
} from "./api";
import { welcomeSteps } from "./steps";
import "./i18n";
import "./welcome.css";

export function WelcomeGuideEntry({ placement = "/" }: { placement?: string }) {
  const { pathname } = useLocation();
  return pathname === placement ? <WelcomeGuide compact /> : null;
}
export function WelcomeGuidePage() {
  return <WelcomeGuide />;
}
function WelcomeGuide({ compact = false }: { compact?: boolean }) {
  const { session } = useAuth();
  const actor = session!.user.id;
  const { t } = useTranslation("welcome");
  const online = useOnline();
  const client = useQueryClient();
  const headingId = useId();
  const progress = useQuery(welcomeQuery(actor));
  const roles = useQuery(userRolesQuery(actor));
  const permissions = useQuery(permissionsQuery(actor));
  const mutation = useMutation({
    mutationFn: ({
      current,
      step,
      status,
    }: {
      current: WelcomeProgress;
      step: WelcomeStep;
      status: WelcomeProgress["status"];
    }) => saveWelcomeProgress(current, step, status),
    onSuccess: (saved) => client.setQueryData(welcomeKey(actor), saved),
  });
  if (progress.isPending || roles.isPending || permissions.isPending)
    return compact ? null : <Loading />;
  if (progress.isError || roles.isError || permissions.isError)
    return (
      <section className="welcome-guide welcome-error" aria-label={t("nav")}>
        <Notice kind="error">{t("loadError")}</Notice>
        <Button
          variant="secondary"
          onClick={() => {
            void progress.refetch();
            void roles.refetch();
            void permissions.refetch();
          }}
        >
          {t("reload")}
        </Button>
      </section>
    );
  // Query response validation also protects presentation when an unexpected cache value arrives.
  const current = welcomeProgressSchema.safeParse(progress.data);
  if (
    !current.success ||
    !Array.isArray(roles.data) ||
    !Array.isArray(permissions.data)
  )
    return null;
  const state = current.data;
  if (compact && (state.status === "completed" || state.status === "skipped"))
    return null;
  const steps = welcomeSteps(roles.data, permissions.data);
  const index = Math.max(
    0,
    steps.findIndex((step) => step.id === state.step),
  );
  const step = steps[index];
  const save = (
    id: WelcomeStep,
    status: WelcomeProgress["status"] = "active",
  ) => mutation.mutate({ current: state, step: id, status });
  const disabled = !online || mutation.isPending;
  const active = state.status === "active";
  const finished = state.status === "completed" || state.status === "skipped";
  return (
    <section
      className={`welcome-guide ${compact ? "welcome-guide-inline" : ""}`}
      aria-labelledby={headingId}
    >
      <div className="welcome-heading">
        <Compass aria-hidden="true" size={28} />
        <div>
          {compact ? (
            <h2 id={headingId}>{t("title")}</h2>
          ) : (
            <h1 id={headingId}>{t("title")}</h1>
          )}
          <p>{t("subtitle")}</p>
        </div>
      </div>
      {!online && <Notice>{t("offline")}</Notice>}
      {mutation.isError && (
        <div>
          <Notice kind="error">{t("error")}</Notice>
          <Button
            variant="secondary"
            disabled={!online || progress.isFetching}
            onClick={() => {
              mutation.reset();
              void progress.refetch();
            }}
          >
            {t("reload")}
          </Button>
        </div>
      )}
      {active ? (
        <>
          <p className="welcome-counter" aria-live="polite" aria-atomic="true">
            {t("progress", { current: index + 1, total: steps.length })} ·{" "}
            {t(`${step.id}Title`)}
          </p>
          <progress
            max={steps.length}
            value={index + 1}
            aria-label={t("progress", {
              current: index + 1,
              total: steps.length,
            })}
          />
          <div className="welcome-step">
            {compact ? (
              <h3>{t(`${step.id}Title`)}</h3>
            ) : (
              <h2>{t(`${step.id}Title`)}</h2>
            )}
            <p>{t(`${step.id}Body`)}</p>
            {step.path && (
              <Button asChild variant="secondary">
                <Link to={step.path}>{t("open")}</Link>
              </Button>
            )}
          </div>
          <div className="welcome-actions">
            <Button
              variant="secondary"
              disabled={disabled || index === 0}
              onClick={() => save(steps[index - 1].id)}
            >
              {t("back")}
            </Button>
            <Button
              disabled={disabled}
              onClick={() =>
                index === steps.length - 1
                  ? save("finish", "completed")
                  : save(steps[index + 1].id)
              }
            >
              {t(
                mutation.isPending
                  ? "saving"
                  : index === steps.length - 1
                    ? "finish"
                    : "next",
              )}
            </Button>
          </div>
          <div className="welcome-secondary-actions">
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => save(step.id, "paused")}
            >
              {t("pause")}
            </Button>
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => save(step.id, "skipped")}
            >
              {t("skip")}
            </Button>
          </div>
        </>
      ) : (
        <div className="welcome-step">
          <p>{t(state.status)}</p>
          <Button
            disabled={disabled}
            onClick={() => save(finished ? "welcome" : step.id)}
          >
            {t(mutation.isPending ? "saving" : finished ? "restart" : "resume")}
          </Button>
        </div>
      )}
      {!compact && (
        <Link className="welcome-home" to="/">
          {t("home")}
        </Link>
      )}
    </section>
  );
}
