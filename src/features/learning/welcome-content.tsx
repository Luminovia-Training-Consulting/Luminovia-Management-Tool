import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";

const schema = z.object({
  version: z.number().int().nonnegative(),
  description: z.string(),
  objectives: z.string(),
  joining_instructions: z.string(),
  published_at: z.string().nullable(),
});
type Revision = z.infer<typeof schema>;

export function CourseWelcomeContent({
  actor,
  courseId,
  zone,
  canEdit,
}: {
  actor: string;
  courseId: string;
  zone: string;
  canEdit: boolean;
}) {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const online = useOnline();
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Revision | null>(null);
  const queryKey = ["course-welcome", actor, courseId] as const;
  const query = useQuery({
    queryKey,
    enabled: online,
    retry: false,
    refetchInterval: 15_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_welcome_content", { p_run_id: courseId })
        .abortSignal(signal);
      if (error) throw error;
      return schema.parse(data);
    },
  });
  const publish = useMutation({
    mutationFn: async (revision: Revision) => {
      requireOnline();
      const { data, error } = await db().rpc("publish_course_welcome_content", {
        p_run_id: courseId,
        p_description: revision.description,
        p_objectives: revision.objectives,
        p_joining_instructions: revision.joining_instructions,
        p_expected_version: revision.version,
      });
      if (error) throw error;
      return schema.parse(data);
    },
    onSuccess: (revision) => {
      cache.setQueryData(queryKey, revision);
      setDraft(null);
      void query.refetch();
    },
    onError: () => void query.refetch(),
  });
  if (!online) return null;
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  const current = query.data;
  const fields = [
    ["description", de ? "Kursbeschreibung" : "Course description"],
    ["objectives", de ? "Lernziele" : "Learning objectives"],
    [
      "joining_instructions",
      de ? "Hinweise zur Teilnahme" : "Joining instructions",
    ],
  ] as const;
  const title = de ? "Willkommen im Kurs" : "Welcome to the course";
  const stale = draft !== null && draft.version !== current.version;
  return (
    <section className="panel learning-panel" aria-label={title}>
      <h2>{title}</h2>
      {current.published_at && (
        <p className="muted">
          {de ? "Veröffentlicht" : "Published"} ·{" "}
          {dateTime(current.published_at, i18n.language, zone)}
        </p>
      )}
      {fields.map(
        ([key, label]) =>
          current[key] && (
            <div key={key}>
              <h3>{label}</h3>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {current[key]}
              </p>
            </div>
          ),
      )}
      {!fields.some(([key]) => current[key]) && (
        <p>
          {de
            ? "Noch kein Willkommenstext veröffentlicht."
            : "No welcome content has been published."}
        </p>
      )}
      {canEdit &&
        (draft === null ? (
          <Button
            variant="secondary"
            onClick={() => {
              publish.reset();
              setDraft(current);
            }}
          >
            {de ? "Willkommenstext bearbeiten" : "Edit welcome content"}
          </Button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!stale) publish.mutate(draft);
            }}
          >
            {fields.map(([key, label]) => (
              <Field key={key} id={`course-welcome-${key}`} label={label}>
                <textarea
                  id={`course-welcome-${key}`}
                  value={draft[key]}
                  maxLength={4000}
                  disabled={publish.isPending}
                  onChange={(event) =>
                    setDraft({ ...draft, [key]: event.target.value })
                  }
                />
              </Field>
            ))}
            {stale && (
              <Notice kind="error">
                {de
                  ? "Eine andere Version wurde veröffentlicht. Kopiere deine Änderungen und lade den Entwurf erneut."
                  : "Another version was published. Copy your changes and reopen the editor."}
              </Notice>
            )}
            {!stale && publish.isError && (
              <Notice kind="error">
                {de
                  ? "Veröffentlichung konnte nicht bestätigt werden."
                  : "Publication could not be confirmed."}
              </Notice>
            )}
            <div className="form-actions">
              <Button type="submit" disabled={stale || publish.isPending}>
                {de ? "Veröffentlichen" : "Publish"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={publish.isPending}
                onClick={() => setDraft(null)}
              >
                {de ? "Abbrechen" : "Cancel"}
              </Button>
            </div>
          </form>
        ))}
    </section>
  );
}
