/**
 * Explizite Verwaltung optionaler Kursteilnehmender. Rollenprüfung steuert die Oberfläche; echte Einschreibung und davon abhängige Ressourcenrechte entstehen durch den Serververtrag.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery } from "../../lib/queries";
import { useOnline, requireOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Field, Loading, ErrorState, Notice } from "../../components/common";
import { peopleRpc, type Enrolment } from "./api";
import "./i18n";
import "./people.css";
/** Lädt und verändert explizite Kurseinschreibungen nur über den vorgesehenen Verwaltungsvertrag. */
export function EnrolmentManager({ courseRunId }: { courseRunId: string }) {
  const { t } = useTranslation("people");
  const { session } = useAuth();
  const online = useOnline();
  const client = useQueryClient();
  const actor = session!.user.id;
  const permissions = useQuery(permissionsQuery(actor));
  const allowed = permissions.data?.includes("courses.manage") ?? false;
  const query = useQuery({
    queryKey: ["course-enrolments", actor, courseRunId],
    enabled: allowed,
    queryFn: () =>
      peopleRpc<Enrolment[]>("course_enrolments", {
        p_course_run_id: courseRunId,
      }),
  });
  const candidates = useQuery({
    queryKey: ["enrolment-candidates", actor],
    enabled: allowed,
    queryFn: () =>
      peopleRpc<{ id: string; display_name: string }[]>("enrolment_candidates"),
  });
  const [user, setUser] = useState("");
  const [status, setStatus] = useState("enrolled");
  const mutation = useMutation({
    mutationFn: async () => {
      requireOnline();
      await peopleRpc("manage_course_enrolment", {
        p_course_run_id: courseRunId,
        p_user_id: user,
        p_status: status,
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["course-enrolments"] });
      await client.invalidateQueries({ queryKey: ["reviewable-courses"] });
    },
  });
  if (permissions.isPending) return <Loading />;
  if (!allowed) return <Notice>{t("permission")}</Notice>;
  return (
    <section className="panel" style={{ marginTop: 24 }}>
      <h2>{t("enrolments")}</h2>
      <p>{t("enrolmentHelp")}</p>
      {query.isPending || candidates.isPending ? (
        <Loading />
      ) : query.isError || candidates.isError ? (
        <ErrorState
          retry={() => {
            void query.refetch();
            void candidates.refetch();
          }}
        />
      ) : (
        <>
          <form
            className="enrolment-form"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <Field
              id={`enrolment-person-${courseRunId}`}
              label={t("participantSelect")}
            >
              <select
                id={`enrolment-person-${courseRunId}`}
                value={user}
                required
                onChange={(e) => setUser(e.target.value)}
              >
                <option value="">{t("choose")}</option>
                {candidates.data.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`enrolment-status-${courseRunId}`} label={t("status")}>
              <select
                id={`enrolment-status-${courseRunId}`}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {["enrolled", "completed", "removed"].map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </Field>
            <Button disabled={!online || !user || mutation.isPending}>
              {t("update")}
            </Button>
          </form>
          {mutation.isError && <Notice kind="error">{t("error")}</Notice>}
          {mutation.isSuccess && <Notice>{t("saved")}</Notice>}
          {!query.data.length ? (
            <p>{t("noEnrolments")}</p>
          ) : (
            <ul className="enrolment-list">
              {query.data.map((item) => (
                <li key={item.user_id}>
                  <span>{item.display_name}</span>
                  <span className="badge">{t(item.status)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setUser(item.user_id);
                      setStatus(item.status);
                    }}
                  >
                    {t("update")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
