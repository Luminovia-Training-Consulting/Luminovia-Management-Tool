/** Course-scoped framework authoring, mapping and immutable learner assessment history. */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import type { CourseWorkspace } from "./api";
import {
  competencyFrameworkDefinition,
  competencyPageSize,
  type CompetencyDefinition,
  type CompetencyFramework,
  type CourseCompetencyState,
} from "./competency-schema";
import "./competencies-i18n";

type Props = { actor: string; course: CourseWorkspace; editable: boolean };
type Command = {
  action: "save_framework" | "pin" | "assess";
  revision: number;
  payload: Record<string, unknown>;
};
type Action = ReturnType<typeof useCompetencyAction>;

/** Server data remains actor/course-scoped and inactive panels never fetch. */
async function readCompetencies(
  course: string,
  subject: string,
  offset: number,
  signal: AbortSignal,
) {
  const { data, error } = await db()
    .rpc("course_competencies", {
      p_run_id: course,
      p_user_id: subject || null,
      p_offset: offset,
    })
    .abortSignal(signal);
  if (error) throw error;
  return data as CourseCompetencyState;
}

/** Changes append a revision and re-read the shared mapping and personal evidence. */
function useCompetencyAction(actor: string, course: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, payload, revision }: Command) => {
      requireOnline();
      const { data, error } = await db().rpc("course_competency_action", {
        p_run_id: course,
        p_action: action,
        p_payload: payload,
        p_expected_revision: revision,
      });
      if (error) throw error;
      return data as { id?: string; revision: number };
    },
    onSuccess: () =>
      cache.invalidateQueries({
        queryKey: ["course-competencies", actor, course],
      }),
  });
}

const newLevel = () => ({ id: crypto.randomUUID(), title: "" });
const newCompetency = () => ({ id: crypto.randomUUID(), code: "", title: "" });
const newFramework = () => ({
  id: crypto.randomUUID(),
  revision: 0,
  content: {
    title: "",
    levels: [newLevel(), newLevel()],
    competencies: [newCompetency()],
  },
});

/** Managers create or revise reusable, organisation-scoped definitions. */
function FrameworkEditor({
  initial,
  busy,
  save,
  cancel,
}: {
  initial: CompetencyFramework;
  busy: boolean;
  save: (content: CompetencyDefinition) => void;
  cancel: () => void;
}) {
  const { t } = useTranslation("learning");
  const [content, setContent] = useState(initial.content);
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = competencyFrameworkDefinition.safeParse(content);
    const distinct = new Set(
      content.competencies.map(({ code }) => code.trim().toLowerCase()),
    );
    setInvalid(
      !parsed.success || distinct.size !== content.competencies.length,
    );
    if (parsed.success && distinct.size === content.competencies.length)
      save(parsed.data);
  }

  return (
    <form onSubmit={submit} className="learning-quiz-editor">
      <fieldset disabled={busy}>
        <legend>
          {t(
            initial.revision
              ? "competencyEditFramework"
              : "competencyCreateFramework",
          )}
        </legend>
        <label>
          {t("competencyName")}
          <input
            required
            maxLength={150}
            value={content.title}
            onChange={(event) =>
              setContent({ ...content, title: event.target.value })
            }
          />
        </label>
        {content.levels.map((level, index) => (
          <div key={level.id} className="flex flex-wrap items-end gap-2">
            <label>
              {t("competencyLevelNamed", { number: index + 1 })}
              <input
                required
                maxLength={100}
                value={level.title}
                onChange={(event) =>
                  setContent({
                    ...content,
                    levels: content.levels.map((item) =>
                      item.id === level.id
                        ? { ...item, title: event.target.value }
                        : item,
                    ),
                  })
                }
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              disabled={content.levels.length <= 2}
              onClick={() =>
                setContent({
                  ...content,
                  levels: content.levels.filter((item) => item.id !== level.id),
                })
              }
            >
              {t("competencyRemove")}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={content.levels.length >= 8}
          onClick={() =>
            setContent({ ...content, levels: [...content.levels, newLevel()] })
          }
        >
          {t("competencyAddLevel")}
        </Button>
        {content.competencies.map((competency, index) => (
          <fieldset key={competency.id}>
            <legend>{t("competencyItemNamed", { number: index + 1 })}</legend>
            <label>
              {t("competencyCode")}
              <input
                required
                maxLength={30}
                value={competency.code}
                onChange={(event) =>
                  setContent({
                    ...content,
                    competencies: content.competencies.map((item) =>
                      item.id === competency.id
                        ? { ...item, code: event.target.value }
                        : item,
                    ),
                  })
                }
              />
            </label>
            <label>
              {t("competencyItemTitle")}
              <input
                required
                maxLength={140}
                value={competency.title}
                onChange={(event) =>
                  setContent({
                    ...content,
                    competencies: content.competencies.map((item) =>
                      item.id === competency.id
                        ? { ...item, title: event.target.value }
                        : item,
                    ),
                  })
                }
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              disabled={content.competencies.length <= 1}
              onClick={() =>
                setContent({
                  ...content,
                  competencies: content.competencies.filter(
                    (item) => item.id !== competency.id,
                  ),
                })
              }
            >
              {t("competencyRemove")}
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={content.competencies.length >= 30}
          onClick={() =>
            setContent({
              ...content,
              competencies: [...content.competencies, newCompetency()],
            })
          }
        >
          {t("competencyAddItem")}
        </Button>
        {invalid && <Notice kind="error">{t("competencyInvalid")}</Notice>}
        <Button type="submit">{t("competencySaveFramework")}</Button>
        <Button type="button" variant="ghost" onClick={cancel}>
          {t("competencyCancel")}
        </Button>
      </fieldset>
    </form>
  );
}

/** Pin a published framework revision deliberately rather than updating enrolled courses on every edit. */
function FrameworkControls({
  data,
  write,
}: {
  data: CourseCompetencyState;
  write: Action;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const [selected, setSelected] = useState("");
  const [editor, setEditor] = useState<CompetencyFramework | null>(null);
  const chosen = data.frameworks.find(({ id }) => id === selected);
  const isPinned =
    data.pinned_framework?.id === chosen?.id &&
    data.pinned_framework?.revision === chosen?.revision;

  return (
    <div className="space-y-3">
      <Field id={id} label={t("competencyChooseFramework")}>
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={write.isPending}
        >
          <option value="">{t("competencyChoose")}</option>
          {data.frameworks.map((frame) => (
            <option key={frame.id} value={frame.id}>
              {t("competencyFrameworkVersion", {
                title: frame.content.title,
                revision: frame.revision,
              })}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={write.isPending || data.frameworks.length >= 20}
          onClick={() => setEditor(newFramework())}
        >
          {t("competencyCreateFramework")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!chosen || write.isPending}
          onClick={() => chosen && setEditor(chosen)}
        >
          {t("competencyEditFramework")}
        </Button>
        <Button
          type="button"
          disabled={!chosen || isPinned || write.isPending}
          onClick={() =>
            chosen &&
            write.mutate({
              action: "pin",
              revision: data.pin_revision,
              payload: {
                framework_id: chosen.id,
                framework_revision: chosen.revision,
              },
            })
          }
        >
          {t("competencySetFramework")}
        </Button>
      </div>
      {editor && (
        <FrameworkEditor
          key={editor.id + ":" + editor.revision}
          initial={editor}
          busy={write.isPending}
          cancel={() => setEditor(null)}
          save={(content) =>
            write.mutate(
              {
                action: "save_framework",
                revision: editor.revision,
                payload: { id: editor.id, content },
              },
              {
                onSuccess: () => {
                  setSelected(editor.id);
                  setEditor(null);
                },
              },
            )
          }
        />
      )}
    </div>
  );
}

/** An assessor reviews evidence for one current learner and intentionally publishes a decision. */
function AssessmentForm({
  data,
  subject,
  write,
}: {
  data: CourseCompetencyState;
  subject: string;
  write: Action;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const [competency, setCompetency] = useState("");
  const [level, setLevel] = useState("");
  const [note, setNote] = useState("");
  const [includeQuiz, setIncludeQuiz] = useState(false);
  const [assignment, setAssignment] = useState("");
  const assignmentOptions = data.assignment_options.map((item) => ({
    ...item,
    key: `${item.attempt_id}:${item.review_version}`,
  }));
  const selected = assignmentOptions.find(({ key }) => key === assignment);
  const staleSelection = Boolean(assignment && !selected);
  const definition = data.pinned_framework?.content;
  if (!definition) return null;

  return (
    <form
      className="learning-quiz-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !competency ||
          !level ||
          note.trim().length < 3 ||
          staleSelection ||
          write.isPending
        )
          return;
        write.mutate(
          {
            action: "assess",
            revision: data.current_revisions[competency] ?? 0,
            payload: {
              pin_revision: data.pin_revision,
              user_id: subject,
              competency_id: competency,
              level_id: level,
              evidence_note: note,
              include_quiz: includeQuiz,
              ...(selected && {
                assignment_evidence: {
                  assignment_id: selected.assignment_id,
                  attempt_id: selected.attempt_id,
                  review_version: selected.review_version,
                },
              }),
            },
          },
          {
            onSuccess: () => {
              setNote("");
              setIncludeQuiz(false);
              setAssignment("");
            },
          },
        );
      }}
    >
      <fieldset disabled={write.isPending}>
        <legend>{t("competencyAssessment")}</legend>
        <Field id={id + "-item"} label={t("competencyItem")}>
          <select
            required
            value={competency}
            onChange={(event) => setCompetency(event.target.value)}
          >
            <option value="">{t("competencyChoose")}</option>
            {definition.competencies.map(({ id, code, title }) => (
              <option key={id} value={id}>
                {code} · {title}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + "-level"} label={t("competencyLevel")}>
          <select
            required
            value={level}
            onChange={(event) => setLevel(event.target.value)}
          >
            <option value="">{t("competencyChoose")}</option>
            {definition.levels.map(({ id, title }) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + "-evidence"} label={t("competencyEvidence")}>
          <textarea
            required
            minLength={3}
            maxLength={1500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <p>{t("competencyEvidenceHint")}</p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={includeQuiz}
            onChange={(event) => setIncludeQuiz(event.target.checked)}
          />
          {t("competencyIncludeQuiz")}
        </label>
        {(assignmentOptions.length > 0 || staleSelection) && (
          <Field id={id + "-assignment"} label={t("competencyAssignment")}>
            <select
              value={assignment}
              onChange={(event) => setAssignment(event.target.value)}
            >
              <option value="">{t("competencyNoAssignment")}</option>
              {staleSelection && (
                <option value={assignment} disabled>
                  {t("competencyConflict")}
                </option>
              )}
              {assignmentOptions.map(({ key, title, score }) => (
                <option key={key} value={key}>
                  {t("competencyAssignmentEvidence", { title, score })}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Button type="submit" disabled={staleSelection}>
          {t("competencyPublishDecision")}
        </Button>
      </fieldset>
    </form>
  );
}

/** Display retained framework titles and levels from the exact decision revision. */
function DecisionHistory({
  data,
  course,
}: {
  data: CourseCompetencyState;
  course: CourseWorkspace;
}) {
  const { t, i18n } = useTranslation("learning");
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeZone: course.time_zone,
  });
  return (
    <>
      <h3>{t("competencyHistory")}</h3>
      {!data.decisions.length && <p>{t("competencyNoDecisions")}</p>}
      <ul className="learning-resources">
        {data.decisions.map((decision) => (
          <li
            key={`${decision.pin_revision}:${decision.competency_id}:${decision.revision}`}
            className="space-y-2"
          >
            <strong>
              {decision.code} · {decision.competency_title}
            </strong>
            <p>
              {decision.framework_title} · {decision.level_title} ·{" "}
              {t("competencyDecisionVersion", { revision: decision.revision })}
            </p>
            <p className="preserve-text">{decision.evidence_note}</p>
            {decision.quiz_evidence && (
              <p>
                {t("competencyQuizEvidence", {
                  version: decision.quiz_evidence.quiz_version,
                  score: decision.quiz_evidence.score,
                })}
              </p>
            )}
            {decision.assignment_evidence && (
              <p>
                {t(
                  "competencyAssignmentEvidence",
                  decision.assignment_evidence,
                )}
              </p>
            )}
            <time dateTime={decision.created_at}>
              {date.format(new Date(decision.created_at))}
            </time>
          </li>
        ))}
      </ul>
    </>
  );
}

export function CourseCompetencies(props: Props) {
  const { t } = useTranslation("learning");
  const [open, setOpen] = useState(false);
  const online = useOnline();
  return (
    <details
      className="panel learning-panel space-y-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("competencyTitle")}</summary>
      {open &&
        (online ? (
          <OpenCompetencies {...props} />
        ) : (
          <p role="status">{t("competencyOffline")}</p>
        ))}
    </details>
  );
}

function OpenCompetencies({ actor, course, editable }: Props) {
  const { t } = useTranslation("learning");
  const id = useId();
  const [subject, setSubject] = useState("");
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ["course-competencies", actor, course.id, subject, offset],
    queryFn: ({ signal }) =>
      readCompetencies(course.id, subject, offset, signal),
    retry: false,
  });
  const write = useCompetencyAction(actor, course.id);
  const conflict =
    typeof write.error === "object" &&
    write.error !== null &&
    "code" in write.error &&
    write.error.code === "PT409";

  return (
    <>
      {course.access.staff && (
        <Field id={id} label={t("competencyLearner")}>
          <select
            value={subject}
            disabled={write.isPending}
            onChange={(event) => {
              setSubject(event.target.value);
              setOffset(0);
              write.reset();
            }}
          >
            <option value="">{t("competencyChoose")}</option>
            {course.roster
              .filter(
                ({ status }) => status === "enrolled" || status === "completed",
              )
              .map(({ user_id, name }) => (
                <option value={user_id} key={user_id}>
                  {name}
                </option>
              ))}
          </select>
        </Field>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <>
          <p>
            {query.data.pinned_framework
              ? t("competencyFrameworkVersion", {
                  title: query.data.pinned_framework.content.title,
                  revision: query.data.pinned_framework.revision,
                })
              : t("competencyNoFramework")}
          </p>
          {editable && query.data.can_manage && (
            <FrameworkControls data={query.data} write={write} />
          )}
          {editable &&
            query.data.can_assess &&
            subject &&
            query.data.pinned_framework && (
              <AssessmentForm
                key={`${subject}:${query.data.pin_revision}`}
                data={query.data}
                subject={subject}
                write={write}
              />
            )}
          {(!course.access.staff || subject) && (
            <>
              <DecisionHistory data={query.data} course={course} />
              <div className="flex flex-wrap gap-2">
                {offset > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setOffset(offset - competencyPageSize)}
                  >
                    {t("competencyPrevious")}
                  </Button>
                )}
                {query.data.has_more && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setOffset(offset + competencyPageSize)}
                  >
                    {t("competencyNext")}
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}
      {write.isSuccess && <Notice>{t("saved")}</Notice>}
      {write.isError && (
        <Notice kind="error">
          {t(conflict ? "competencyConflict" : "saveError")}
          {conflict && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                write.reset();
                void query.refetch();
              }}
            >
              {t("competencyReload")}
            </Button>
          )}
        </Notice>
      )}
    </>
  );
}
