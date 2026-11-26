/** Course registration, learner launch and the same-tab LTI OIDC callback. */
import { useId, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import { sessionCacheBoundary } from "../auth/session-cache-boundary";

type Tool = {
  id: string;
  title: string;
  active: boolean;
  version: number;
  client_id?: string;
  login_uri?: string;
  redirect_uri?: string;
  target_uri?: string;
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
async function beginLaunch(id: string) {
  requireOnline();
  const proof = crypto.randomUUID();
  const { data, error } = await db().functions.invoke<LaunchStart>(
    "learning-lti",
    {
      body: { action: "prepare", registration: id, proof },
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

/** Current staff configure tool metadata; only current learners or instructors can launch. */
export function CourseLtiTools({
  actor,
  course,
}: {
  actor: string;
  course: string;
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
                {tools.data?.can_launch && tool.active && (
                  <Button
                    type="button"
                    disabled={launch.isPending}
                    onClick={() => launch.mutate(tool.id)}
                  >
                    {t("ltiLaunch")}
                  </Button>
                )}
                {tools.data?.can_manage && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setEditing(tool)}
                  >
                    {t("ltiEdit")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {launch.isError && <Notice kind="error">{t("ltiFailed")}</Notice>}
    </section>
  );
}
