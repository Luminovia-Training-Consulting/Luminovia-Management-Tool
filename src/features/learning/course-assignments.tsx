/** Course assignment drafts, scanned attempts and scoped assessment on the workspace. */
import { lazy, Suspense, useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { zonedInstant, zonedInstantForScheduleEdit } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { acceptedFiles, uploadCourseAssignmentSubmission } from "../files/api";
import { downloadPortalDocument, type CourseWorkspace } from "./api";
import {
  assignmentDefinition,
  type assignmentActions,
  courseAssignmentsProjection,
  rubricIsOrdered,
  type AssignmentDefinition,
  type CourseAssignment,
  type CourseAssignmentAttempt,
} from "./course-assignment-schema";

const AssignmentTeams = lazy(() =>
  import("./course-assignment-teams").then((module) => ({
    default: module.AssignmentTeams,
  })),
);

type Action = (typeof assignmentActions)[number];
type Command = (
  action: Action,
  input: unknown,
  version: number,
) => Promise<unknown>;
type Participant = Pick<
  CourseWorkspace["roster"][number],
  "user_id" | "name" | "status"
>;

/** Send the read version so a slow editor cannot overwrite another staff member's work. */
async function sendAssignmentAction(
  course: string,
  assignment: string,
  action: Action,
  input: unknown,
  version: number,
) {
  requireOnline();
  const { error } = await db().rpc("course_assignment_action", {
    p_run_id: course,
    p_assignment_id: assignment,
    p_action: action,
    p_payload: input,
    p_expected_version: version,
  });
  if (error) throw error;
}

function AssignmentError({ error }: { error: unknown }) {
  const { t } = useTranslation("learning");
  if (!error) return null;
  const code = typeof error === "object" && "code" in error && error.code;
  return (
    <Notice kind="error">
      {t(
        code === "PT409"
          ? "assignmentsConflict"
          : code === "42501"
            ? "assignmentsNoAccess"
            : "saveError",
      )}
    </Notice>
  );
}

const blankCriterion = () => ({
  label: "",
  levels: [
    { label: "", points: 0 },
    { label: "", points: 1 },
  ],
});
const localTime = (instant: string, zone: string) =>
  DateTime.fromISO(instant).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");

/** Publish the saved definition and edit a new revision using separate actions. */
function AssignmentEditor({
  current,
  command,
  zone,
  nowLabel,
}: {
  current: CourseAssignment | null;
  command: Command;
  zone: string;
  nowLabel: string;
}) {
  const { t } = useTranslation("learning");
  const [draft, setDraft] = useState<AssignmentDefinition>(() => ({
    title: current?.title ?? "",
    instructions: current?.instructions ?? "",
    due_at: current ? localTime(current.due_at, zone) : nowLabel,
    max_attempts: current?.max_attempts ?? 2,
    rubric: current?.rubric ?? [blankCriterion()],
  }));
  const [invalid, setInvalid] = useState(false);
  const saving = useMutation({
    mutationFn: (value: AssignmentDefinition) =>
      command("save", value, current?.version ?? 0),
  });
  const publishing = useMutation({
    mutationFn: () => command("publish", {}, current?.version ?? 0),
  });
  const updateCriterion = (
    index: number,
    criterion: AssignmentDefinition["rubric"][number],
  ) =>
    setDraft((previous) => ({
      ...previous,
      rubric: previous.rubric.map((item, n) =>
        n === index ? criterion : item,
      ),
    }));
  function save(event: FormEvent) {
    event.preventDefault();
    const utc = zonedInstantForScheduleEdit(
      draft.due_at,
      zone,
      current?.due_at,
      zone,
    );
    const data = assignmentDefinition.safeParse({ ...draft, due_at: utc });
    setInvalid(!data.success || !rubricIsOrdered(draft.rubric));
    if (data.success && rubricIsOrdered(draft.rubric)) saving.mutate(data.data);
  }
  return (
    <form onSubmit={save} className="space-y-3">
      <fieldset
        disabled={saving.isPending || publishing.isPending}
        className="space-y-3"
      >
        <legend>
          {t(current ? "assignmentsDraft" : "assignmentsNew", {
            version: current?.version,
          })}
        </legend>
        <label>
          {t("assignmentsTitleField")}
          <input
            required
            maxLength={160}
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.currentTarget.value })
            }
          />
        </label>
        <label>
          {t("assignmentsInstructions")}
          <textarea
            required
            maxLength={8000}
            value={draft.instructions}
            onChange={(event) =>
              setDraft({ ...draft, instructions: event.currentTarget.value })
            }
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label>
            {t("assignmentsDue", { zone })}
            <input
              required
              type="datetime-local"
              value={draft.due_at}
              onChange={(event) =>
                setDraft({ ...draft, due_at: event.currentTarget.value })
              }
            />
          </label>
          <label>
            {t("assignmentsAttempts")}
            <input
              required
              type="number"
              min={1}
              max={10}
              value={Number.isNaN(draft.max_attempts) ? "" : draft.max_attempts}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  max_attempts: event.currentTarget.valueAsNumber,
                })
              }
            />
          </label>
        </div>
        <fieldset className="space-y-3">
          <legend>{t("assignmentsRubric")}</legend>
          {draft.rubric.map((criterion, index) => (
            <fieldset className="space-y-2 border p-3" key={index}>
              <legend>{t("assignmentsCriterion", { index: index + 1 })}</legend>
              <label>
                {t("assignmentsCriterionName")}
                <input
                  required
                  maxLength={160}
                  value={criterion.label}
                  onChange={(event) =>
                    updateCriterion(index, {
                      ...criterion,
                      label: event.currentTarget.value,
                    })
                  }
                />
              </label>
              {criterion.levels.map((level, levelIndex) => (
                <fieldset
                  key={levelIndex}
                  className="flex flex-wrap items-end gap-2"
                >
                  <legend>
                    {t("assignmentsLevel", { index: levelIndex + 1 })}
                  </legend>
                  <label>
                    {t("assignmentsLevelName")}
                    <input
                      required
                      maxLength={160}
                      value={level.label}
                      onChange={(event) => {
                        const label = event.currentTarget.value;
                        updateCriterion(index, {
                          ...criterion,
                          levels: criterion.levels.map((entry, n) =>
                            n === levelIndex ? { ...entry, label } : entry,
                          ),
                        });
                      }}
                    />
                  </label>
                  <label>
                    {t("assignmentsLevelPoints")}
                    <input
                      required
                      type="number"
                      min={0}
                      max={1000}
                      value={Number.isNaN(level.points) ? "" : level.points}
                      onChange={(event) => {
                        const points = event.currentTarget.valueAsNumber;
                        updateCriterion(index, {
                          ...criterion,
                          levels: criterion.levels.map((entry, n) =>
                            n === levelIndex ? { ...entry, points } : entry,
                          ),
                        });
                      }}
                    />
                  </label>
                  {criterion.levels.length > 2 && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        updateCriterion(index, {
                          ...criterion,
                          levels: criterion.levels.filter(
                            (_, n) => n !== levelIndex,
                          ),
                        })
                      }
                    >
                      {t("assignmentsRemoveLevel")}
                    </Button>
                  )}
                </fieldset>
              ))}
              <div className="flex flex-wrap gap-2">
                {criterion.levels.length < 8 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      updateCriterion(index, {
                        ...criterion,
                        levels: [
                          ...criterion.levels,
                          {
                            label: "",
                            points: (criterion.levels.at(-1)?.points ?? 0) + 1,
                          },
                        ],
                      })
                    }
                  >
                    {t("assignmentsAddLevel")}
                  </Button>
                )}
                {draft.rubric.length > 1 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        rubric: draft.rubric.filter((_, n) => n !== index),
                      })
                    }
                  >
                    {t("assignmentsRemoveCriterion")}
                  </Button>
                )}
              </div>
            </fieldset>
          ))}
          {draft.rubric.length < 20 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setDraft({
                  ...draft,
                  rubric: [...draft.rubric, blankCriterion()],
                })
              }
            >
              {t("assignmentsAddCriterion")}
            </Button>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t("assignmentsSave")}</Button>
          {current && current.published_version !== current.version && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => publishing.mutate()}
            >
              {t("assignmentsPublish")}
            </Button>
          )}
        </div>
      </fieldset>
      {invalid && <Notice kind="error">{t("assignmentsInvalid")}</Notice>}
      <AssignmentError error={saving.error ?? publishing.error} />
    </form>
  );
}

/** Keep the clean version in memory until submit is confirmed, including network retries. */
function AssignmentSubmission({
  assignment,
  course,
  command,
}: {
  assignment: CourseAssignment;
  course: string;
  command: Command;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const [file, setFile] = useState<{
    bytes: File;
    clientId: string;
    scannedId?: string;
  } | null>(null);
  const submit = useMutation({
    mutationFn: async (selected: NonNullable<typeof file>) => {
      const scannedId =
        selected.scannedId ??
        (
          await uploadCourseAssignmentSubmission(
            selected.bytes,
            course,
            assignment.assignment_id,
            selected.clientId,
          )
        ).current_version_id;
      if (!scannedId) throw new Error("upload_failed");
      setFile({ ...selected, scannedId });
      await command(
        "submit",
        { file_version_id: scannedId },
        assignment.version,
      );
    },
    onSuccess: () => setFile(null),
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (file && !submit.isPending) submit.mutate(file);
      }}
    >
      <fieldset disabled={submit.isPending} className="space-y-2">
        <label htmlFor={id}>{t("submissionFile")}</label>
        <input
          id={id}
          type="file"
          accept={acceptedFiles}
          aria-describedby={id + "-size"}
          onChange={(event) => {
            const bytes = event.currentTarget.files?.[0];
            submit.reset();
            setFile(bytes ? { bytes, clientId: crypto.randomUUID() } : null);
          }}
        />
        <p id={id + "-size"}>{t("submissionFileLimit")}</p>
        <Button disabled={!file} type="submit">
          {t(submit.isPending ? "submissionScanning" : "submissionSend")}
        </Button>
        {submit.isError && (
          <Notice kind="error">
            {t(
              submit.error.message === "scan_rejected"
                ? "submissionRejected"
                : submit.error.message === "scanner_unavailable"
                  ? "submissionScannerUnavailable"
                  : "submissionUploadFailed",
            )}
          </Notice>
        )}
      </fieldset>
    </form>
  );
}

/** Extension CAS applies to one participant and one assignment's due instant. */
function AssignmentExtension({
  assignment,
  participants,
  zone,
  language,
  command,
}: {
  assignment: CourseAssignment;
  participants: Participant[];
  zone: string;
  language: string;
  command: Command;
}) {
  const { t } = useTranslation("learning");
  const [selected, setSelected] = useState("");
  const [due, setDue] = useState("");
  const extension = assignment.extensions.find(
    ({ user_id }) => user_id === selected,
  );
  const save = useMutation({
    mutationFn: () =>
      command(
        "extend",
        {
          user_id: selected,
          due_at: zonedInstant(due, zone),
        },
        extension?.version ?? 0,
      ),
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (selected && due) save.mutate();
      }}
    >
      <fieldset
        disabled={save.isPending}
        className="flex flex-wrap items-end gap-2"
      >
        <legend>{t("assignmentsExtension")}</legend>
        <label>
          {t("assignmentsParticipant")}
          <select
            required
            value={selected}
            onChange={(event) => {
              const user = event.currentTarget.value;
              const record = assignment.extensions.find(
                ({ user_id }) => user_id === user,
              );
              setSelected(user);
              setDue(record ? localTime(record.due_at, zone) : "");
              save.reset();
            }}
          >
            <option value="">{t("assignmentsParticipant")}</option>
            {participants
              .filter(({ status }) => status === "enrolled")
              .map(({ user_id, name }) => (
                <option key={user_id} value={user_id}>
                  {name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t("assignmentsDue", { zone })}
          <input
            required
            type="datetime-local"
            value={due}
            onChange={(event) => setDue(event.currentTarget.value)}
          />
        </label>
        <Button type="submit" disabled={!selected || !due}>
          {t("assignmentsExtend")}
        </Button>
      </fieldset>
      {extension && (
        <p>
          {t("assignmentsExtensionCurrent", {
            time: formatDate(extension.due_at, zone, language),
          })}
        </p>
      )}
      <AssignmentError error={save.error} />
    </form>
  );
}

/** Render each attempt with its pinned rubric; newer assignment edits cannot change available levels. */
function AssignmentReview({
  attempt,
  command,
}: {
  attempt: CourseAssignmentAttempt;
  command: Command;
}) {
  const { t } = useTranslation("learning");
  const [scores, setScores] = useState(
    attempt.review?.scores ?? attempt.rubric.map(() => 0),
  );
  const [feedback, setFeedback] = useState(attempt.review?.feedback ?? "");
  const [note, setNote] = useState(attempt.review?.private_note ?? "");
  const [state, setState] = useState("draft");
  const save = useMutation({
    mutationFn: () =>
      command(
        "review",
        {
          attempt_id: attempt.id,
          scores,
          feedback,
          private_note: note,
          state,
        },
        attempt.review?.version ?? 0,
      ),
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset disabled={save.isPending} className="space-y-2">
        <legend>{t("assignmentsReview")}</legend>
        {attempt.rubric.map(({ label, levels }, index) => (
          <label key={label}>
            {label}
            <select
              value={scores[index]}
              onChange={(event) => {
                const points = Number(event.currentTarget.value);
                setScores(
                  scores.map((score, n) => (n === index ? points : score)),
                );
              }}
            >
              {levels.map(({ label, points }) => (
                <option key={points} value={points}>
                  {label} · {points}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          {t("assignmentsFeedback")}
          <textarea
            maxLength={4000}
            required={state === "revision_requested"}
            value={feedback}
            onChange={(event) => setFeedback(event.currentTarget.value)}
          />
        </label>
        <label>
          {t("assignmentsPrivateNote")}
          <textarea
            maxLength={4000}
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </label>
        <label>
          {t("assignmentsStatus")}
          <select
            value={state}
            onChange={(event) => setState(event.currentTarget.value)}
          >
            <option value="draft">{t("assignmentsStateDraft")}</option>
            <option value="revision_requested">
              {t("assignmentsStateRevision")}
            </option>
            <option value="released">{t("assignmentsStateReleased")}</option>
          </select>
        </label>
        <Button type="submit">{t("assignmentsReviewSave")}</Button>
      </fieldset>
      <AssignmentError error={save.error} />
    </form>
  );
}

/** Format absolute deadlines and submissions in the originating course's timezone. */
function formatDate(instant: string, zone: string, locale: string) {
  return DateTime.fromISO(instant)
    .setZone(zone)
    .setLocale(locale)
    .toLocaleString(DateTime.DATETIME_MED);
}

function AssignmentAttemptCard({
  attempt,
  command,
  actor,
  course,
  staff,
  canManage,
  zone,
}: {
  attempt: CourseAssignmentAttempt;
  command: Command;
  actor: string;
  course: string;
  staff: boolean;
  canManage: boolean;
  zone: string;
}) {
  const { t, i18n } = useTranslation("learning");
  const download = useMutation({
    mutationFn: (version: string) =>
      downloadPortalDocument(
        { kind: "participant_submission", id: course, version_id: version },
        attempt.file_name,
      ),
  });
  const status = attempt.review?.state;
  const label =
    status === "draft"
      ? "assignmentsStateDraft"
      : status === "released"
        ? "assignmentsReviewed"
        : status === "revision_requested"
          ? "assignmentsRevisionRequested"
          : "assignmentsWaiting";
  return (
    <li className="space-y-2 border p-3">
      <h4>
        {staff ? (attempt.team_title ?? attempt.display_name) + " · " : ""}
        {t("assignmentsAttempt", { number: attempt.attempt_no })}
      </h4>
      <p>{formatDate(attempt.submitted_at, zone, i18n.language)}</p>
      <p className="break-all">{attempt.file_name}</p>
      {attempt.file_version_id && (
        <Button
          variant="secondary"
          disabled={download.isPending}
          onClick={() => {
            if (attempt.file_version_id)
              download.mutate(attempt.file_version_id);
          }}
        >
          {t("download")}
        </Button>
      )}
      {download.isError && <Notice kind="error">{t("downloadError")}</Notice>}
      <p>{t(label)}</p>
      {attempt.review && (
        <p>
          {t("assignmentsPoints", {
            points: attempt.review.scores.reduce(
              (sum, score) => sum + score,
              0,
            ),
            max: attempt.rubric.reduce(
              (sum, criterion) => sum + (criterion.levels.at(-1)?.points ?? 0),
              0,
            ),
          })}
        </p>
      )}
      {attempt.review?.feedback && (
        <p className="preserve-text">{attempt.review.feedback}</p>
      )}
      {canManage && actor !== attempt.user_id && (
        <AssignmentReview
          key={attempt.review?.version ?? 0}
          attempt={attempt}
          command={command}
        />
      )}
    </li>
  );
}

/** Bind sensitive results and local drafts to this identity, course, and selection. */
export function CourseAssignments({
  actor,
  course,
  zone,
  participants,
  staff,
  readOnly,
}: {
  actor: string;
  course: string;
  zone: string;
  participants: Participant[];
  staff: boolean;
  readOnly: boolean;
}) {
  const { t, i18n } = useTranslation("learning");
  const cache = useQueryClient();
  const online = useOnline();
  const title = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [offset, setOffset] = useState(0);
  const [openTeams, setOpenTeams] = useState<string | null>(null);
  const baseKey = ["course-assignments", actor, course];
  const query = useQuery({
    queryKey: [...baseKey, creating ? null : selected, offset],
    enabled: online,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db().rpc("course_assignments", {
        p_run_id: course,
        p_assignment_id: creating ? null : selected,
        p_offset: offset,
      });
      if (error) throw error;
      return courseAssignmentsProjection.parse(data);
    },
  });
  const refresh = () => cache.invalidateQueries({ queryKey: baseKey });
  const command: Command = async (action, input, version) => {
    if (!selected) return;
    await sendAssignmentAction(course, selected, action, input, version);
    if (creating && action === "save") setCreating(false);
    await refresh();
  };
  const data = online && !query.isError ? query.data : undefined;
  const assignment = data?.detail;
  const canManage = Boolean(data?.can_manage && !readOnly);
  return (
    <section
      aria-labelledby={title}
      className="panel learning-panel min-w-0 space-y-4"
    >
      <h2 id={title}>{t("assignmentsTitle")}</h2>
      {!online && <p>{t("submissionOnline")}</p>}
      {online && query.isPending && <Loading />}
      {online && query.isError && (
        <ErrorState retry={() => void query.refetch()} />
      )}
      {data && (
        <>
          {readOnly && <Notice>{t("assignmentsReadOnly")}</Notice>}
          <div className="flex flex-wrap gap-2">
            {data.assignments.length > 0 && (
              <label>
                {t("assignmentsChoose")}
                <select
                  value={creating ? "" : (selected ?? "")}
                  onChange={(event) => {
                    setSelected(event.currentTarget.value || null);
                    setCreating(false);
                    setOffset(0);
                  }}
                >
                  <option value="">{t("assignmentsChoose")}</option>
                  {data.assignments.map(({ id, title }) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {canManage && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSelected(crypto.randomUUID());
                  setCreating(true);
                  setOffset(0);
                }}
              >
                {t("assignmentsNew")}
              </Button>
            )}
            {selected && (
              <Button variant="secondary" onClick={() => void refresh()}>
                {t("refresh")}
              </Button>
            )}
          </div>
          {data.assignments.length === 0 && !creating && (
            <p>{t("assignmentsEmpty")}</p>
          )}
          {canManage && creating && (
            <AssignmentEditor
              key={selected}
              current={null}
              zone={zone}
              nowLabel={DateTime.now()
                .setZone(zone)
                .plus({ days: 7 })
                .toFormat("yyyy-MM-dd'T'HH:mm")}
              command={command}
            />
          )}
          {!creating && assignment && (
            <>
              <h3>{assignment.title}</h3>
              <p className="preserve-text">{assignment.instructions}</p>
              <p>
                {t("assignmentsDue", { zone })} ·{" "}
                {formatDate(assignment.effective_due_at, zone, i18n.language)}
              </p>
              {assignment.published_version && (
                <p>
                  {t("assignmentsPublished", {
                    version: assignment.published_version,
                  })}
                </p>
              )}
              {canManage && (
                <AssignmentEditor
                  key={assignment.assignment_id + ":" + assignment.version}
                  current={assignment}
                  command={command}
                  zone={zone}
                  nowLabel=""
                />
              )}
              {canManage && assignment.published_version && (
                <AssignmentExtension
                  key={assignment.assignment_id}
                  assignment={assignment}
                  command={command}
                  participants={participants}
                  zone={zone}
                  language={i18n.language}
                />
              )}
              {staff && (
                <details
                  key={assignment.assignment_id}
                  onToggle={(event) =>
                    setOpenTeams(
                      event.currentTarget.open
                        ? assignment.assignment_id
                        : null,
                    )
                  }
                >
                  <summary>{t("assignmentsTeams")}</summary>
                  {openTeams === assignment.assignment_id && (
                    <Suspense fallback={<Loading />}>
                      <AssignmentTeams
                        teams={assignment.teams}
                        command={command}
                        participants={participants}
                        zone={zone}
                        canManage={canManage}
                        ErrorMessage={AssignmentError}
                      />
                    </Suspense>
                  )}
                </details>
              )}
              {!staff && assignment.teams[0] && (
                <Notice>
                  {t("assignmentsTeamShared", {
                    title: assignment.teams[0].title,
                  })}
                </Notice>
              )}
              {!staff && (
                <details>
                  <summary>{t("assignmentsRubric")}</summary>
                  <ul>
                    {assignment.rubric.map(({ label, levels }) => (
                      <li key={label}>
                        {label}
                        <ul>
                          {levels.map(({ label, points }) => (
                            <li key={points}>
                              {label} · {points}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {!readOnly && assignment.can_submit && (
                <AssignmentSubmission
                  key={assignment.assignment_id + ":" + assignment.version}
                  assignment={assignment}
                  course={course}
                  command={command}
                />
              )}
              {!staff && !readOnly && !assignment.can_submit && (
                <p>{t("assignmentsUnavailable")}</p>
              )}
              {assignment.attempts.length === 0 ? (
                <p>{t("assignmentsNoAttempts")}</p>
              ) : (
                <ul className="space-y-3">
                  {assignment.attempts.map((attempt) => (
                    <AssignmentAttemptCard
                      key={attempt.id}
                      attempt={attempt}
                      actor={actor}
                      course={course}
                      command={command}
                      staff={staff}
                      canManage={canManage}
                      zone={zone}
                    />
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {offset > 0 && (
                  <Button
                    variant="secondary"
                    onClick={() => setOffset(offset - 25)}
                  >
                    {t("submissionPrevious")}
                  </Button>
                )}
                {assignment.attempts.length === 25 && (
                  <Button
                    variant="secondary"
                    onClick={() => setOffset(offset + 25)}
                  >
                    {t("submissionNext")}
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
