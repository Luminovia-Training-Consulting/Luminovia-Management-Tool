import { lazy, Suspense, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import {
  enrolLearningProgram,
  learningProgramsKey,
  learningProgramClassProgressQuery,
  placeLearningProgramParticipant,
  learningProgramsQuery,
  saveLearningProgram,
  startLearningProgramCourse,
} from "./learning-program-api";
import {
  learningProgramId,
  saveLearningProgramRequest,
  type LearningProgramDetail,
} from "./learning-program-schema";
import { ProgrammePrerequisites } from "./programme-prerequisites";
import "./learning-program-i18n";
import "./learning-programs.css";

const ProgrammeCurriculumEditor = lazy(() =>
  import("./programme-curriculum-editor").then((module) => ({
    default: module.ProgrammeCurriculumEditor,
  })),
);
const ProgrammePathExceptions = lazy(() =>
  import("./programme-path-exceptions").then((module) => ({
    default: module.ProgrammePathExceptions,
  })),
);
const ProgrammeGradeReport = lazy(() =>
  import("./programme-grade-report").then((module) => ({
    default: module.ProgrammeGradeReport,
  })),
);

const programUrl = (id: string) =>
  `/learning?view=programmes&program=${encodeURIComponent(id)}`;

type PickerOption = { id: string; name: string };
type Module = { course_id: string | null; title: string };

function ProgramEditor({
  actor,
  organisations,
  program,
  saved,
}: {
  actor: string;
  organisations: PickerOption[];
  program?: LearningProgramDetail;
  saved: (id: string) => void;
}) {
  const { t, i18n } = useTranslation("learningPrograms");
  const [id] = useState(() => program?.id ?? crypto.randomUUID());
  const [organisation, setOrganisation] = useState(
    program?.organisation_id ??
      (organisations.length === 1 ? organisations[0].id : ""),
  );
  const [title, setTitle] = useState(program?.title ?? "");
  const [description, setDescription] = useState(program?.description ?? "");
  const [sequential, setSequential] = useState(program?.sequential ?? true);
  const [modules, setModules] = useState<Module[]>(program?.steps ?? []);
  const [search, setSearch] = useState("");
  const [choice, setChoice] = useState("");
  const hasPathRules = Boolean(Object.keys(program?.path_rules ?? {}).length);
  const orderLocked = hasPathRules || Boolean(program?.curriculum);
  const courses = useQuery({
    ...learningProgramsQuery(actor, {
      p_organisation_id: organisation,
      p_search: search.trim(),
    }),
    enabled: Boolean(organisation),
  });
  const save = useMutation({
    mutationFn: saveLearningProgram,
    onSuccess: saved,
  });
  const choices =
    courses.data?.courses.filter(
      (item) => !modules.some((step) => step.course_id === item.id),
    ) ?? [];
  const selected = choices.find((item) => item.id === choice);
  const move = (index: number, offset: -1 | 1) => {
    setModules((previous) => {
      const next = [...previous];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = saveLearningProgramRequest.safeParse({
      p_program_id: id,
      p_organisation_id: organisation,
      p_title: title,
      p_description: description,
      p_sequential: sequential,
      p_course_ids: modules.map((item) => item.course_id),
      p_archived: program?.archived ?? false,
      p_expected_version: program?.version ?? 0,
    });
    if (parsed.success) save.mutate(parsed.data);
  }

  return (
    <form className="panel programme-panel" onSubmit={submit}>
      <h3>{t(program ? "edit" : "create")}</h3>
      <fieldset disabled={save.isPending}>
        {!program && (
          <Field id="programme-company" label={t("organisation")}>
            <select
              id="programme-company"
              value={organisation}
              required
              onChange={(event) => {
                setOrganisation(event.target.value);
                setModules([]);
                setChoice("");
              }}
            >
              <option value="">{t("selectOrganisation")}</option>
              {organisations.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id="programme-title" label={t("name")}>
          <input
            id="programme-title"
            value={title}
            maxLength={140}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field id="programme-description" label={t("description")}>
          <textarea
            id="programme-description"
            value={description}
            maxLength={4000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={sequential}
            onChange={(event) => setSequential(event.target.checked)}
          />
          {t("sequential")}
        </label>
        <p>{t("sequentialHint")}</p>
        <Field id="programme-course-search" label={t("courseSearch")}>
          <input
            id="programme-course-search"
            type="search"
            maxLength={120}
            disabled={!organisation}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setChoice("");
            }}
          />
        </Field>
        {courses.isError ? (
          <ErrorState retry={() => void courses.refetch()} />
        ) : organisation && courses.isPending ? (
          <Loading />
        ) : (
          <div className="programme-picker">
            <Field id="programme-course" label={t("course")}>
              <select
                id="programme-course"
                value={choice}
                disabled={choices.length === 0}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">{t("selectCourse")}</option>
                {choices.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                    {option.starts_at
                      ? ` · ${new Date(option.starts_at).toLocaleString(i18n.language)}`
                      : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              type="button"
              variant="secondary"
              disabled={orderLocked || !selected || modules.length >= 30}
              onClick={() => {
                if (!selected) return;
                setModules([
                  ...modules,
                  { course_id: selected.id, title: selected.title },
                ]);
                setChoice("");
              }}
            >
              {t("addCourse")}
            </Button>
          </div>
        )}
        {hasPathRules && <p>{t("pathLockedRule")}</p>}
        {program?.curriculum && <p>{t("curriculumLockedOrder")}</p>}
        <h4>{t("selectedCourses")}</h4>
        <ol className="programme-steps">
          {modules.map((module, index) => (
            <li key={module.course_id ?? `unavailable-${index}`}>
              <div className="programme-step">
                <strong>{module.title}</strong>
                {!orderLocked && (
                  <details
                    className="programme-step-actions"
                    name={`programme-course-actions-${id}`}
                  >
                    <summary
                      aria-label={t("courseActionsFor", {
                        title: module.title,
                      })}
                    >
                      {t("courseActions")}
                    </summary>
                    <div className="form-actions">
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        {t("moveUp")}
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={index === modules.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        {t("moveDown")}
                      </Button>
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={() =>
                          setModules((items) =>
                            items.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        {t("remove")}
                      </Button>
                    </div>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
        <Button
          type="submit"
          disabled={
            !organisation ||
            !title.trim() ||
            modules.length < 2 ||
            modules.some((item) => !item.course_id)
          }
        >
          {t("save")}
        </Button>
      </fieldset>
      {save.isError && <Notice kind="error">{t("saveFailed")}</Notice>}
    </form>
  );
}

function ProgrammeClassProgress({
  actor,
  program,
}: {
  actor: string;
  program: string;
}) {
  const { t } = useTranslation("learningPrograms");
  const [selection, setSelection] = useState("");
  const progress = useQuery(learningProgramClassProgressQuery(actor, program));
  const groups = progress.data ?? [];
  const selected = groups.some((group) => group.class_id === selection)
    ? selection
    : "";
  return (
    <section
      className="panel programme-panel"
      aria-labelledby="programme-class-progress"
    >
      <h3 id="programme-class-progress">{t("classProgress")}</h3>
      {progress.isPending || !progress.isFetchedAfterMount ? (
        <Loading />
      ) : progress.isError ? (
        <ErrorState retry={() => void progress.refetch()} />
      ) : groups.length === 0 ? (
        <p>{t("classProgressEmpty")}</p>
      ) : (
        <>
          <Field id="programme-class-filter" label={t("filterClass")}>
            <select
              id="programme-class-filter"
              value={selected}
              onChange={(event) => setSelection(event.target.value)}
            >
              <option value="">{t("allClasses")}</option>
              {groups.map((group) => (
                <option key={group.class_id} value={group.class_id}>
                  {group.class_name}
                </option>
              ))}
            </select>
          </Field>
          <ul className="programme-roster">
            {groups
              .filter((group) => !selected || group.class_id === selected)
              .map((group) => {
                const courses = t("classProgressModules", {
                  completed: group.modules_completed,
                  total: group.module_slots,
                });
                return (
                  <li className="programme-class-progress" key={group.class_id}>
                    <h4>{group.class_name}</h4>
                    <span>
                      {t("classProgressParticipants", {
                        completed: group.participants_completed,
                        total: group.participants,
                      })}
                    </span>
                    <span>{courses}</span>
                    <progress
                      max={group.module_slots}
                      value={group.modules_completed}
                      aria-label={`${group.class_name}: ${courses}`}
                    />
                  </li>
                );
              })}
          </ul>
        </>
      )}
    </section>
  );
}

function ProgrammeClassPlacement({
  organisation,
  classes,
  roster,
  refresh,
}: {
  organisation: string;
  classes: PickerOption[];
  roster: NonNullable<LearningProgramDetail["roster"]>;
  refresh: () => void;
}) {
  const { t } = useTranslation("learningPrograms");
  const [draft, setDraft] = useState<{
    id: string;
    classId: string;
    version: number;
  } | null>(null);
  const assignment = useMutation({
    mutationFn: placeLearningProgramParticipant,
    onSuccess: () => {
      setDraft(null);
      refresh();
    },
    onError: () => {
      setDraft(null);
      refresh();
    },
  });
  const learners = roster.filter((person) => person.active && person.placement);
  const current = learners.find((person) => person.id === draft?.id)?.placement;
  const changed =
    draft &&
    current &&
    draft.version === current.version &&
    draft.classId !== (current.class_id ?? "");
  if (!classes.length || !learners.length) return null;
  return (
    <>
      <h4>{t("classPlacement")}</h4>
      <p>{t("classPlacementHint")}</p>
      <form
        className="programme-picker"
        onSubmit={(event) => {
          event.preventDefault();
          if (!changed) return;
          assignment.mutate({
            p_organisation_id: organisation,
            p_user_id: draft.id,
            p_class_id: draft.classId || null,
            p_expected_version: draft.version,
          });
        }}
      >
        <Field
          id="programme-placement-learner"
          label={t("placementParticipant")}
        >
          <select
            id="programme-placement-learner"
            value={draft?.id ?? ""}
            disabled={assignment.isPending}
            onChange={(event) => {
              const person = learners.find(
                (entry) => entry.id === event.target.value,
              );
              const placement = person?.placement;
              assignment.reset();
              setDraft(
                person && placement
                  ? {
                      id: person.id,
                      classId: placement.class_id ?? "",
                      version: placement.version,
                    }
                  : null,
              );
            }}
          >
            <option value="">{t("selectParticipant")}</option>
            {learners.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="programme-placement-class" label={t("placementClass")}>
          <select
            id="programme-placement-class"
            value={draft?.classId ?? ""}
            disabled={!draft || assignment.isPending}
            onChange={(event) => {
              if (draft) setDraft({ ...draft, classId: event.target.value });
            }}
          >
            <option value="">{t("placementNone")}</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" disabled={!changed || assignment.isPending}>
          {t("savePlacement")}
        </Button>
      </form>
      {assignment.isSuccess && (
        <Notice kind="success">{t("placementSaved")}</Notice>
      )}
      {(assignment.isError ||
        (draft && (!current || draft.version !== current.version))) && (
        <Notice kind="error">{t("placementFailed")}</Notice>
      )}
    </>
  );
}

function ProgramManager({
  actor,
  program,
  organisations,
  candidates,
  refresh,
}: {
  actor: string;
  program: LearningProgramDetail;
  candidates: (PickerOption & { reference: string })[];
  organisations: PickerOption[];
  refresh: () => void;
}) {
  const { t } = useTranslation("learningPrograms");
  const [editing, setEditing] = useState(false);
  const [editingCurriculum, setEditingCurriculum] = useState(false);
  const [publishedCurriculum, setPublishedCurriculum] = useState(false);
  const [participant, setParticipant] = useState("");
  const [search, setSearch] = useState("");
  const filtered = useQuery({
    ...learningProgramsQuery(actor, {
      p_program_id: program.id,
      p_search: search.trim(),
    }),
    enabled: Boolean(search.trim()),
  });
  const people = search.trim() ? (filtered.data?.candidates ?? []) : candidates;
  const roster = search.trim()
    ? (filtered.data?.detail?.roster ?? [])
    : program.roster;
  const assignment = useMutation({
    mutationFn: enrolLearningProgram,
    onSuccess: () => {
      setParticipant("");
      refresh();
    },
  });
  const archive = useMutation({
    mutationFn: saveLearningProgram,
    onSuccess: refresh,
  });
  const ids = (program.steps ?? []).map((step) => step.course_id);
  const validCandidates = people.some(
    (candidate) => candidate.id === participant,
  );

  if (editing && program.can_edit) {
    return (
      <>
        <Button variant="secondary" onClick={() => setEditing(false)}>
          {t("close")}
        </Button>
        <ProgramEditor
          actor={actor}
          organisations={organisations}
          program={program}
          saved={() => {
            setEditing(false);
            refresh();
          }}
        />
      </>
    );
  }

  return (
    <>
      <section className="panel programme-panel">
        <h3>{t("selectedCourses")}</h3>
        <ol className="programme-steps">
          {program.steps?.map((step, index) => (
            <li key={step.course_id ?? `unavailable-${index}`}>
              {step.course_id ? (
                <Link to={`/courses/${step.course_id}/workspace`}>
                  {step.title}
                </Link>
              ) : (
                step.title
              )}
            </li>
          ))}
        </ol>
        {program.can_write && !program.can_edit && <p>{t("orderLocked")}</p>}
        {program.can_write && (
          <div className="form-actions">
            {program.can_edit && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t("edit")}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={
                archive.isPending || (program.archived && ids.some((id) => !id))
              }
              onClick={() => {
                archive.mutate({
                  p_program_id: program.id,
                  p_organisation_id: program.organisation_id,
                  p_title: program.title,
                  p_description: program.description,
                  p_sequential: program.sequential,
                  p_course_ids: ids,
                  p_archived: !program.archived,
                  p_expected_version: program.version,
                });
              }}
            >
              {t(program.archived ? "restore" : "archive")}
            </Button>
          </div>
        )}
        {archive.isError && <Notice kind="error">{t("saveFailed")}</Notice>}
      </section>
      {program.can_edit && !program.archived && (
        <ProgrammePrerequisites program={program} refresh={refresh} />
      )}
      {program.can_manage_path_exceptions && !program.archived && (
        <Suspense fallback={<Loading />}>
          <ProgrammePathExceptions
            key={program.id}
            program={program.id}
            roster={(roster ?? []).filter(({ active }) => active)}
            refresh={refresh}
          />
        </Suspense>
      )}
      {(program.curriculum || (program.can_edit && !program.archived)) && (
        <section className="panel programme-panel">
          <h3>{t("curriculum")}</h3>
          {program.curriculum && (
            <>
              <p>
                {t("curriculumRevision", {
                  revision: program.curriculum.revision,
                })}
              </p>
              {program.curriculum.overview && (
                <p>{program.curriculum.overview}</p>
              )}
              <p>
                {t("curriculumRequirements", {
                  count: program.curriculum.elective_count,
                })}
              </p>
            </>
          )}
          {publishedCurriculum && <Notice>{t("curriculumSaved")}</Notice>}
          {program.can_edit &&
            !program.archived &&
            (editingCurriculum ? (
              <Suspense fallback={<Loading />}>
                <ProgrammeCurriculumEditor
                  key={program.id}
                  program={program}
                  onCancel={() => setEditingCurriculum(false)}
                  onSaved={() => {
                    setEditingCurriculum(false);
                    setPublishedCurriculum(true);
                    refresh();
                  }}
                />
              </Suspense>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPublishedCurriculum(false);
                  setEditingCurriculum(true);
                }}
              >
                {t("curriculumEdit")}
              </Button>
            ))}
        </section>
      )}
      <ProgrammeClassProgress actor={actor} program={program.id} />
      <section className="panel programme-panel">
        {program.can_write && !program.archived && <h3>{t("enrolment")}</h3>}
        <Field id="programme-learner-search" label={t("findParticipant")}>
          <input
            type="search"
            id="programme-learner-search"
            value={search}
            maxLength={120}
            onChange={(event) => {
              setParticipant("");
              setSearch(event.target.value);
            }}
          />
        </Field>
        {filtered.isError && (
          <ErrorState retry={() => void filtered.refetch()} />
        )}
        {program.can_write && !program.archived && (
          <form
            className="programme-picker"
            onSubmit={(event) => {
              event.preventDefault();
              if (validCandidates)
                assignment.mutate({
                  p_program_id: program.id,
                  p_user_id: participant,
                  p_expected_version: program.version,
                });
            }}
          >
            <Field id="programme-learner" label={t("participant")}>
              <select
                id="programme-learner"
                value={participant}
                onChange={(event) => setParticipant(event.target.value)}
              >
                <option value="">{t("selectParticipant")}</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.reference}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              disabled={!validCandidates || assignment.isPending}
              type="submit"
            >
              {t("enrol")}
            </Button>
          </form>
        )}
        {assignment.isSuccess && (
          <Notice kind="success">{t("enrolmentSaved")}</Notice>
        )}
        {assignment.isError && (
          <Notice kind="error">{t("enrolmentFailed")}</Notice>
        )}
        <h3>{t("roster")}</h3>
        {roster?.length ? (
          <ul className="programme-roster">
            {roster.map((person) => (
              <li key={person.id}>
                <strong>{person.name}</strong>
                <span>{t("progress", person.progress)}</span>
                {!person.active && <span>{t("inactive")}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("rosterEmpty")}</p>
        )}
        {program.can_write && roster && (
          <ProgrammeClassPlacement
            organisation={program.organisation_id}
            classes={program.classes ?? []}
            roster={roster}
            refresh={refresh}
          />
        )}
      </section>
      {program.can_read_grades && (
        <Suspense fallback={<Loading />}>
          <ProgrammeGradeReport
            actor={actor}
            program={program.id}
            learners={(roster ?? []).filter(({ active }) => active)}
          />
        </Suspense>
      )}
    </>
  );
}

function LearnerProgram({
  program,
  writable,
  refresh,
}: {
  program: LearningProgramDetail;
  writable: boolean;
  refresh: () => void;
}) {
  const { t, i18n } = useTranslation("learningPrograms");
  const start = useMutation({
    mutationFn: startLearningProgramCourse,
    onSuccess: refresh,
  });
  const progress = program.progress;
  if (!progress) return null;
  const next = progress.steps.find(
    (item) => item.state === "ready" || item.state === "in_progress",
  );

  return (
    <>
      <section className="panel programme-panel">
        <h3>{t("progress", progress)}</h3>
        {program.curriculum && (
          <>
            {program.curriculum.overview && (
              <p>{program.curriculum.overview}</p>
            )}
            <p>
              {t("curriculumRequirements", {
                count: program.curriculum.elective_count,
              })}
            </p>
          </>
        )}
        <progress
          aria-label={t("progress", progress)}
          max={progress.total}
          value={progress.completed}
        />
        {next && (
          <p>
            <strong>{t("next")}</strong> · {next.title}
          </p>
        )}
        <ol className="programme-steps">
          {progress.steps.map((step, index) => {
            const curriculumStep = step.course_id
              ? program.curriculum?.steps[step.course_id]
              : undefined;
            return (
              <li
                id={`programme-step-${index + 1}`}
                key={step.course_id ?? `unavailable-${index}`}
              >
                <div className="programme-step">
                  <span>
                    <strong>{step.title}</strong> · {t(`state.${step.state}`)}
                  </span>
                  {step.can_open && step.course_id && (
                    <Button asChild variant="secondary">
                      <Link to={`/courses/${step.course_id}/workspace`}>
                        {t("courseAction.open")}
                      </Link>
                    </Button>
                  )}
                  {step.state === "ready" && writable && step.course_id && (
                    <Button
                      type="button"
                      disabled={start.isPending}
                      onClick={() =>
                        start.mutate({
                          p_program_id: program.id,
                          p_course_id: step.course_id!,
                        })
                      }
                    >
                      {t("courseAction.start")}
                    </Button>
                  )}
                </div>
                {curriculumStep && (
                  <>
                    <p>
                      {t(
                        curriculumStep.required
                          ? "curriculumRequired"
                          : "curriculumElective",
                      )}
                    </p>
                    {curriculumStep.objectives && (
                      <p>{curriculumStep.objectives}</p>
                    )}
                  </>
                )}
                {step.prerequisite_exception?.active && (
                  <p>{t("pathExceptionActive")}</p>
                )}
                {step.prerequisites && (
                  <div>
                    <p>
                      {t(
                        step.prerequisites.mode === "any"
                          ? "pathAlternatives"
                          : "pathRequired",
                      )}
                    </p>
                    {curriculumStep?.remediation && (
                      <div>
                        <p>
                          <strong>{t("curriculumRemediationTitle")}</strong>
                        </p>
                        <p>{curriculumStep.remediation}</p>
                      </div>
                    )}
                    <ul className="list-disc ps-5">
                      {step.prerequisites.items
                        .filter((item) => !item.completed)
                        .map((item) => (
                          <li key={item.position}>
                            <a href={`#programme-step-${item.position}`}>
                              {item.title}
                            </a>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {start.isError && <Notice kind="error">{t("startFailed")}</Notice>}
      </section>
      {progress.completed_at &&
        progress.steps.filter(
          (step) => step.receipt_id && step.completion_credited !== false,
        ).length >= progress.total && (
          <article className="panel programme-panel programme-certificate">
            <h3>{t("certificate")}</h3>
            <p>{t("certificateIntro")}</p>
            <p>
              <strong>{program.title}</strong> · {program.learner_name}
            </p>
            <p>
              {t("certificateDate", {
                date: new Date(progress.completed_at).toLocaleDateString(
                  i18n.language,
                ),
              })}
            </p>
            <ul>
              {progress.steps
                .filter(
                  (step) =>
                    step.receipt_id && step.completion_credited !== false,
                )
                .map((step) => (
                  <li key={step.receipt_id}>
                    {step.title} ·{" "}
                    {t("certificateReference", { id: step.receipt_id })}
                  </li>
                ))}
            </ul>
            <Button type="button" onClick={() => window.print()}>
              {t("print")}
            </Button>
          </article>
        )}
    </>
  );
}

export function LearningPrograms({ actor }: { actor: string }) {
  const { t } = useTranslation("learningPrograms");
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const parsed = learningProgramId.safeParse(params.get("program"));
  const id = parsed.success ? parsed.data : undefined;
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    ...learningProgramsQuery(actor, {
      p_program_id: id,
      p_search: "",
    }),
    refetchOnMount: "always",
  });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: learningProgramsKey(actor) });
    void cache.invalidateQueries({ queryKey: ["course-workspaces", actor] });
  };
  if (query.isPending || !query.isFetchedAfterMount) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;

  const { programs, organisations, detail, candidates, writable } = query.data;
  if (detail) {
    return (
      <section className="programme-layout">
        <div>
          <Button asChild variant="secondary">
            <Link to="/learning?view=programmes">{t("close")}</Link>
          </Button>
        </div>
        <div>
          <h2>{detail.title}</h2>
          {detail.archived && <Notice>{t("archivedHint")}</Notice>}
          {!writable && <Notice>{t("noWrite")}</Notice>}
          <p>
            {detail.organisation_name} ·{" "}
            {t(detail.sequential ? "ordered" : "openOrder")}
          </p>
          {detail.description && (
            <p className="programme-description">{detail.description}</p>
          )}
        </div>
        {detail.manage && (
          <ProgramManager
            key={detail.id}
            actor={actor}
            program={detail}
            candidates={candidates}
            organisations={organisations}
            refresh={refresh}
          />
        )}
        {detail.progress && (
          <>
            <LearnerProgram
              key={`${detail.id}-learner`}
              program={detail}
              writable={writable}
              refresh={refresh}
            />
            <Suspense fallback={<Loading />}>
              <ProgrammeGradeReport
                key={`${detail.id}-grade-report`}
                actor={actor}
                program={detail.id}
              />
            </Suspense>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="programme-layout">
      <div>
        <h2>{t("title")}</h2>
        <p>{t("intro")}</p>
      </div>
      {organisations.length > 0 &&
        (creating ? (
          <ProgramEditor
            actor={actor}
            organisations={organisations}
            saved={(createdId) => {
              refresh();
              setCreating(false);
              setParams({ view: "programmes", program: createdId });
            }}
          />
        ) : (
          <div>
            <Button onClick={() => setCreating(true)}>{t("create")}</Button>
          </div>
        ))}
      {programs.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <div className="learning-grid">
          {programs.map((program) => (
            <article key={program.id} className="panel learning-card">
              <h3>{program.title}</h3>
              <p>{program.organisation_name}</p>
              {program.archived && (
                <span className="badge">{t("archived")}</span>
              )}
              <Button asChild variant="secondary">
                <Link
                  to={programUrl(program.id)}
                  aria-label={`${t("openProgram")}: ${program.title}`}
                >
                  {t("openProgram")}
                </Link>
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
