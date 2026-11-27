/** Course registration, learner launch and the same-tab LTI OIDC callback. */
import "./lti-course-i18n";
import { useId, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { LtiGrades } from "./lti-grades";
import { useAuth } from "../auth/auth-context";
import { sessionCacheBoundary } from "../auth/session-cache-boundary";

import { DynamicToolRegistration } from "./lti-register-tool";

type Tool = {
  id: string;
  title: string;
  active: boolean;
  version: number;
  client_id?: string;
  login_uri?: string;
  redirect_uri?: string;
  target_uri?: string;
  nrps_enabled?: boolean;
  ags_enabled?: boolean;
  view_grades?: boolean;
  tool_public_key?: JsonWebKey | null;
  deep_link_uri?: string | null;
  can_select: boolean;
  can_withdraw: boolean;
  links: { id: string; title: string }[];
};

type ToolList = { can_manage: boolean; can_launch: boolean; tools: Tool[] };
type LaunchStart = { redirect: string; login_hint: string };
type LaunchResult = { redirect: string; state: string; id_token: string };
const pendingKey = "luminovia-lti-pending";
const authorizeFields = [
  "scope",
  "response_type",
  "response_mode",
  "prompt",
  "client_id",
  "redirect_uri",
  "login_hint",
  "lti_message_hint",
  "nonce",
  "state",
] as const;

/** Read the current course projection. A teacher/learner never receives tool configuration. */
async function toolsForCourse(run: string, signal: AbortSignal) {
  requireOnline();
  const { data, error } = await db()
    .rpc("course_lti_tools", { p_run_id: run })
    .abortSignal(signal);
  if (error) throw error;
  return data as ToolList;
}

/** Initiate only one same-tab flow and keep the second factor outside tool URLs. */
async function beginLaunch({
  registration,
  resource,
  mode,
}: {
  registration: string;
  resource?: string;
  mode?: "select";
}) {
  requireOnline();
  const proof = crypto.randomUUID();
  const { data, error } = await db().functions.invoke<LaunchStart>(
    "learning-lti",
    {
      body: { action: "prepare", registration, proof, resource, mode },
    },
  );
  if (error || !data || new URL(data.redirect).protocol !== "https:")
    throw new Error("lti_unavailable");
  sessionStorage.setItem(
    pendingKey,
    JSON.stringify({ proof, hint: data.login_hint }),
  );
  window.location.assign(data.redirect);
}

/** Build a minimal form post without treating either the ID token or state as markup. */
function deliverLaunch(result: LaunchResult) {
  if (new URL(result.redirect).protocol !== "https:")
    throw new Error("lti_redirect");
  const form = document.createElement("form");
  form.method = "POST";
  form.action = result.redirect;
  form.style.display = "none";
  for (const [name, value] of Object.entries({
    state: result.state,
    id_token: result.id_token,
  })) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
  form.remove();
}

/** Complete the tool's OIDC request in the originating authenticated browser tab. */
export function LtiAuthorize() {
  const { t } = useTranslation("learning");
  const { loading, session } = useAuth();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (loading || started.current) return;
    started.current = true;
    if (!session) {
      return;
    }
    const authorize = async () => {
      requireOnline();
      const query = new URLSearchParams(window.location.search);
      if (authorizeFields.some((name) => query.getAll(name).length !== 1))
        throw new Error("lti_parameters");
      const fields = Object.fromEntries(
        authorizeFields.map((name) => [name, query.get(name)]),
      );
      const pending = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
      if (
        !pending ||
        fields.login_hint !== pending.hint ||
        typeof pending.proof !== "string"
      )
        throw new Error("lti_browser");
      sessionStorage.removeItem(pendingKey);
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname,
      );
      const { data, error } = await db().functions.invoke<LaunchResult>(
        "learning-lti",
        {
          body: { action: "authorize", ...fields, proof: pending.proof },
        },
      );
      if (error || !data || data.state !== fields.state)
        throw new Error("lti_authorization");
      const { data: current } = await db().auth.getSession();
      if (
        current.session?.user.id !== session.user.id ||
        sessionCacheBoundary(current.session?.access_token) !==
          sessionCacheBoundary(session.access_token) ||
        window.location.pathname !== "/lti/authorize"
      )
        throw new Error("lti_session");
      deliverLaunch(data);
    };
    void authorize().catch(() => setFailed(true));
  }, [loading, session]);
  return (
    <main className="learning-panel">
      <h1>{t("ltiAuthorize")}</h1>
      {failed || (!session && !loading) ? (
        <Notice kind="error">{t("ltiFailed")}</Notice>
      ) : (
        <Loading />
      )}
    </main>
  );
}

type Selection = {
  run_id: string;
  title: string | null;
  target_uri: string | null;
  published: boolean;
  line_item?: { label: string; maximum: number };
};

async function reviewSelection(
  id: string,
  action: "read" | "publish" | "withdraw",
) {
  requireOnline();
  const { data, error } = await db().rpc("lti_deep_link_review", {
    p_id: id,
    p_action: action,
  });
  if (error) throw error;
  return data as Selection;
}

/** Preview a tool selection after returning to the original authenticated tab. */
export function LtiDeepLinkReview() {
  const { t } = useTranslation("learning");
  const { loading, session } = useAuth();
  const online = useOnline();
  const [id] = useState(() => window.location.hash.slice(1));
  const valid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
  const sessionBoundary = sessionCacheBoundary(session?.access_token);
  const preview = useQuery({
    queryKey: ["lti-deep-link-review", id, session?.user.id, sessionBoundary],
    enabled: Boolean(valid && online && session),
    gcTime: 0,
    retry: false,
    queryFn: () => reviewSelection(id, "read"),
  });
  const publish = useMutation({
    mutationFn: () => reviewSelection(id, "publish"),
    onSuccess: () => void preview.refetch(),
  });
  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
  }, []);
  useEffect(() => {
    publish.reset();
    // A success notice belongs only to the original authentication session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionBoundary]);

  const selection = preview.data;
  return (
    <main className="learning-panel">
      <h1>{t("ltiReviewSelection")}</h1>
      {!valid || (!loading && !session) ? (
        <Notice kind="error">{t("ltiFailed")}</Notice>
      ) : !online ? (
        <p>{t("workspaceOffline")}</p>
      ) : preview.isError ? (
        <ErrorState retry={() => void preview.refetch()} />
      ) : !selection ? (
        <Loading />
      ) : (
        <>
          {selection.title ? (
            <>
              <h2>{selection.title}</h2>
              <p className="break-all">{selection.target_uri}</p>
              {selection.line_item && (
                <p>
                  {t("ltiSelectedGradeColumn", {
                    label: selection.line_item.label,
                    maximum: selection.line_item.maximum,
                  })}
                </p>
              )}
              {selection.published ? (
                <Notice>{t("ltiLinkPublished")}</Notice>
              ) : (
                <Button
                  type="button"
                  disabled={publish.isPending || publish.isSuccess}
                  onClick={() => publish.mutate()}
                >
                  {t("ltiPublishLink")}
                </Button>
              )}
            </>
          ) : (
            <p>{t("ltiNoSelection")}</p>
          )}
          {publish.isError && <Notice kind="error">{t("ltiFailed")}</Notice>}
          <div className="form-actions mt-4">
            <Link to={`/courses/${selection.run_id}/workspace#course-lti`}>
              {t("ltiReturnToTools")}
            </Link>
          </div>
        </>
      )}
    </main>
  );
}

/** Save one deployment against the manager's reviewed revision. */
function ToolForm({
  tool,
  course,
  saved,
  close,
}: {
  tool: Tool | null;
  course: string;
  saved: () => void;
  close: () => void;
}) {
  const { t } = useTranslation("learning");
  const labelId = useId();
  const [id] = useState(() => tool?.id ?? crypto.randomUUID());
  const fields = [
    "title",
    "client_id",
    "login_uri",
    "redirect_uri",
    "target_uri",
  ] as const;
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      requireOnline();
      const { error } = await db().rpc("save_course_lti_tool", {
        p_id: id,
        p_run_id: course,
        p_expected_version: tool?.version ?? 0,
        p_title: form.get("title"),
        p_client_id: form.get("client_id"),
        p_login_uri: form.get("login_uri"),
        p_redirect_uri: form.get("redirect_uri"),
        p_target_uri: form.get("target_uri"),
        p_active: form.has("active"),
      });
      if (error) throw error;
    },
    onSuccess: saved,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) save.mutate(new FormData(event.currentTarget));
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend>{t(tool ? "ltiEdit" : "ltiAdd")}</legend>
        {fields.map((field) => (
          <div key={field}>
            <label htmlFor={labelId + field}>{t("ltiField_" + field)}</label>
            <input
              id={labelId + field}
              name={field}
              defaultValue={tool?.[field] ?? ""}
              type={field.endsWith("_uri") ? "url" : "text"}
              required
              readOnly={Boolean(tool) && field === "client_id"}
            />
          </div>
        ))}
        <label className="checkbox-row">
          <input
            name="active"
            type="checkbox"
            defaultChecked={tool?.active ?? false}
          />
          {t("ltiEnabled")}
        </label>
        <div className="form-actions">
          <Button type="submit">{t("ltiSave")}</Button>
          <Button type="button" variant="secondary" onClick={close}>
            {t("portfolioCancel")}
          </Button>
        </div>
      </fieldset>
      {save.isError && <Notice kind="error">{t("ltiFailed")}</Notice>}
    </form>
  );
}

/** Enable roster provisioning for a deployment by pinning the tool's public key. */
function ToolAdvantageForm({ tool, saved }: { tool: Tool; saved: () => void }) {
  const { t } = useTranslation("learning");
  const input = useId();
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      requireOnline();
      const raw = String(form.get("key") ?? "").trim();
      const key = raw ? JSON.parse(raw) : null;
      if (key) {
        const imported = await crypto.subtle.importKey(
          "jwk",
          key,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );
        const algorithm = imported.algorithm as RsaHashedKeyAlgorithm;
        if (algorithm.modulusLength < 2048 || algorithm.modulusLength > 4096)
          throw new Error("lti_public_key");
      }
      const { error } = await db().rpc("configure_course_lti_advantage", {
        p_registration_id: tool.id,
        p_expected_version: tool.version,
        p_public_key: key,
        p_nrps: form.has("nrps"),
      });
      if (error) throw error;
    },
    onSuccess: saved,
  });
  return (
    <details>
      <summary>{t("ltiAdvantage")}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!save.isPending) save.mutate(new FormData(event.currentTarget));
        }}
      >
        <fieldset disabled={save.isPending}>
          <legend>{t("ltiServices")}</legend>
          <label htmlFor={input}>{t("ltiPublicKey")}</label>
          <textarea
            id={input}
            name="key"
            rows={4}
            maxLength={4096}
            spellCheck={false}
            defaultValue={
              tool.tool_public_key
                ? JSON.stringify(tool.tool_public_key, null, 2)
                : ""
            }
          />
          <label className="checkbox-row">
            <input
              name="nrps"
              type="checkbox"
              defaultChecked={tool.nrps_enabled}
            />
            {t("ltiRoster")}
          </label>
          <p>{t("ltiRosterPrivacy")}</p>
          <div className="form-actions">
            <Button type="submit">{t("ltiSave")}</Button>
          </div>
        </fieldset>
        {save.isError && <Notice kind="error">{t("ltiAdvantageError")}</Notice>}
        {save.isSuccess && <Notice>{t("saved")}</Notice>}
      </form>
    </details>
  );
}

function ToolDeepLinkSetup({ tool, saved }: { tool: Tool; saved: () => void }) {
  const { t } = useTranslation("learning");
  const input = useId();
  const save = useMutation({
    mutationFn: async (value: string) => {
      requireOnline();
      const { error } = await db().rpc("configure_course_lti_deep_link", {
        p_registration_id: tool.id,
        p_expected_version: tool.version,
        p_selector_uri: value.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: saved,
  });
  return (
    <details>
      <summary>{t("ltiConfigureSelector")}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!save.isPending)
            save.mutate(
              String(new FormData(event.currentTarget).get("selector") ?? ""),
            );
        }}
      >
        <fieldset disabled={save.isPending}>
          <legend>{t("ltiConfigureSelector")}</legend>
          <label htmlFor={input}>{t("ltiSelectorUri")}</label>
          <input
            id={input}
            name="selector"
            type="url"
            defaultValue={tool.deep_link_uri ?? ""}
          />
          <p>{t("ltiSelectorUriHelp")}</p>
          <Button type="submit">{t("ltiSave")}</Button>
        </fieldset>
        {save.isError && <Notice kind="error">{t("ltiAdvantageError")}</Notice>}
      </form>
    </details>
  );
}

/** Current staff configure tool metadata; only current learners or instructors can launch. */
export function CourseLtiTools({
  actor,
  course,
  allowAdvantage = true,
}: {
  actor: string;
  course: string;
  allowAdvantage?: boolean;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const [editing, setEditing] = useState<Tool | null | undefined>();
  const tools = useQuery({
    queryKey: ["course-lti-tools", actor, course],
    queryFn: ({ signal }) => toolsForCourse(course, signal),
    enabled: online,
    gcTime: 0,
    retry: false,
  });
  const launch = useMutation({ mutationFn: beginLaunch });
  const withdraw = useMutation({
    mutationFn: (id: string) => reviewSelection(id, "withdraw"),
    onSuccess: () => void tools.refetch(),
  });
  return (
    <section
      className="panel learning-panel space-y-2"
      aria-label={t("ltiTools")}
    >
      <h2>{t("ltiTools")}</h2>
      {!online ? (
        <p>{t("workspaceOffline")}</p>
      ) : tools.isError ? (
        <ErrorState retry={() => void tools.refetch()} />
      ) : !tools.data ? (
        <Loading />
      ) : (
        <>
          {tools.data.can_manage && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(null)}
            >
              {t("ltiAdd")}
            </Button>
          )}
          {tools.data.can_manage && allowAdvantage && (
            <DynamicToolRegistration
              course={course}
              refresh={() => void tools.refetch()}
            />
          )}
          {editing !== undefined && tools.data.can_manage && (
            <ToolForm
              key={editing?.id ?? "new"}
              course={course}
              tool={editing}
              close={() => setEditing(undefined)}
              saved={() => {
                setEditing(undefined);
                void tools.refetch();
              }}
            />
          )}
          {!tools.data.tools.length && <p>{t("ltiEmpty")}</p>}
          <ul className="learning-resources">
            {tools.data.tools.map((tool) => (
              <li key={tool.id}>
                <h3>{tool.title}</h3>
                {((tools.data?.can_launch && tool.active) ||
                  tool.can_select) && (
                  <div className="form-actions">
                    {tools.data?.can_launch && tool.active && (
                      <Button
                        type="button"
                        disabled={launch.isPending}
                        onClick={() => launch.mutate({ registration: tool.id })}
                      >
                        {t("ltiLaunch")}
                      </Button>
                    )}
                    {tool.can_select && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={launch.isPending}
                        onClick={() =>
                          launch.mutate({
                            registration: tool.id,
                            mode: "select",
                          })
                        }
                      >
                        {t("ltiSelectResource")}
                      </Button>
                    )}
                  </div>
                )}
                {tool.active && !!tool.links?.length && (
                  <ul className="learning-resources">
                    {tool.links.map((link) => (
                      <li key={link.id}>
                        <strong>{link.title}</strong>
                        <div className="form-actions">
                          {tools.data?.can_launch && (
                            <Button
                              type="button"
                              variant="secondary"
                              aria-label={t("ltiLaunchResource", {
                                title: link.title,
                              })}
                              disabled={launch.isPending}
                              onClick={() =>
                                launch.mutate({
                                  registration: tool.id,
                                  resource: link.id,
                                })
                              }
                            >
                              {t("ltiLaunch")}
                            </Button>
                          )}
                          {tool.can_withdraw && (
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={t("ltiWithdrawResource", {
                                title: link.title,
                              })}
                              disabled={withdraw.isPending}
                              onClick={() => withdraw.mutate(link.id)}
                            >
                              {t("ltiWithdrawLink")}
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {tools.data?.can_manage && (
                  <>
                    <dl>
                      <dt>{t("ltiDeploymentId")}</dt>
                      <dd>
                        <code className="break-all">{tool.id}</code>
                      </dd>
                    </dl>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setEditing(tool)}
                    >
                      {t("ltiEdit")}
                    </Button>
                    {allowAdvantage && (
                      <ToolAdvantageForm
                        key={tool.version}
                        tool={tool}
                        saved={() => void tools.refetch()}
                      />
                    )}
                    {allowAdvantage && tool.tool_public_key && (
                      <ToolDeepLinkSetup
                        key={`selector-${tool.version}`}
                        tool={tool}
                        saved={() => void tools.refetch()}
                      />
                    )}
                  </>
                )}
                {allowAdvantage &&
                  (tool.view_grades ||
                    (tools.data?.can_manage && tool.tool_public_key)) && (
                    <LtiGrades
                      key={`ags-${tool.version}`}
                      deployment={tool.id}
                      version={tool.version}
                      enabled={tool.ags_enabled === true}
                      canConfigure={
                        tools.data?.can_manage === true &&
                        Boolean(tool.tool_public_key)
                      }
                      actor={actor}
                      saved={() => void tools.refetch()}
                    />
                  )}
              </li>
            ))}
          </ul>
        </>
      )}
      {(launch.isError || withdraw.isError) && (
        <Notice kind="error">{t("ltiFailed")}</Notice>
      )}
    </section>
  );
}
