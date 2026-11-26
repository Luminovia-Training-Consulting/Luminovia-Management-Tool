import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { KnowledgeEditor } from "../knowledge/editor";
import {
  courseContentAction,
  courseContentStudioKey,
  courseContentStudioQuery,
  type CourseContentStudio,
  type CourseWorkspace,
} from "./api";
import {
  createCourseLesson,
  createCourseModule,
  emptyCurriculum,
  normalizeCourseCurriculum,
  type CourseCurriculum,
  type CourseLesson,
  type CourseModule,
} from "./course-authoring-schema";
import "../knowledge/knowledge.css";
import "./i18n";

function CourseContents({ curriculum }: { curriculum: CourseCurriculum }) {
  const { t } = useTranslation("learning");
  if (!curriculum.modules.length) return <p>{t("curriculumEmpty")}</p>;
  return (
    <div className="course-authoring-preview">
      {curriculum.modules.map((module) => (
        <section key={module.id}>
          <h3>{module.title}</h3>
          {module.description && <p>{module.description}</p>}
          {module.lessons.map((lesson) => (
            <article key={lesson.id}>
              <h4>{lesson.title}</h4>
              {lesson.objectives && (
                <p>
                  <strong>{t("lessonObjectives")}: </strong>
                  {lesson.objectives}
                </p>
              )}
              {lesson.duration_minutes > 0 && (
                <p>{t("lessonDuration", { count: lesson.duration_minutes })}</p>
              )}
              <KnowledgeEditor
                value={lesson.body}
                label={lesson.title}
                readOnly
              />
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function CourseAuthoring({
  actor,
  courseId,
  editable,
  manager,
  roster,
}: {
  actor: string;
  courseId: string;
  editable: boolean;
  manager: boolean;
  roster: CourseWorkspace["roster"];
}) {
  const { t } = useTranslation("learning");
  const location = useLocation();
  const navigate = useNavigate();
  const online = useOnline();
  const cache = useQueryClient();
  const key = courseContentStudioKey(actor, courseId);
  const query = useQuery(courseContentStudioQuery(actor, courseId));
  const [localDraft, setLocalDraft] = useState<{
    content: CourseCurriculum;
    published_version: number;
    draft_version: number;
  } | null>(null);
  const [preview, setPreview] = useState(false);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState("");
  const [pendingLocation, setPendingLocation] = useState<string | null>(null);
  const authoring = editable && query.data?.can_edit === true;
  const dirty = authoring && localDraft !== null;

  const curriculum = useMemo(() => {
    if (dirty) return localDraft.content;
    if (!query.data) return emptyCurriculum;
    const content = authoring
      ? (query.data.draft_content ?? query.data.published_content)
      : query.data.published_content;
    return normalizeCourseCurriculum(content);
  }, [authoring, dirty, localDraft, query.data]);

  const activeModuleIndex = curriculum.modules.findIndex(
    (item) => item.id === moduleId,
  );
  const activeModule = curriculum.modules[activeModuleIndex] ?? null;
  const activeLessonIndex =
    activeModule?.lessons.findIndex((item) => item.id === lessonId) ?? -1;
  const activeLesson = activeModule?.lessons[activeLessonIndex] ?? null;
  const activeParticipants = useMemo(
    () => roster.filter((item) => item.status === "enrolled"),
    [roster],
  );
  const mutation = useMutation({
    mutationFn: async ({
      action,
      payload,
    }: {
      action: "save_draft" | "publish" | "restore" | "migrate";
      payload: Record<string, unknown>;
    }) => {
      requireOnline();
      return courseContentAction(courseId, action, payload);
    },
    onSuccess: (data) => {
      cache.setQueryData<CourseContentStudio>(key, data);
      setLocalDraft(null);
    },
  });
  const { mutate, isPending, isError, reset, error } = mutation;
  const conflict =
    (dirty &&
      (localDraft.published_version !== query.data?.published_version ||
        localDraft.draft_version !== query.data?.draft_version)) ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "PT409");
  const draftPayload = useMemo(() => {
    if (!localDraft) return null;
    try {
      return {
        ...localDraft,
        content: normalizeCourseCurriculum(localDraft.content),
      };
    } catch {
      return null;
    }
  }, [localDraft]);

  useEffect(() => {
    if (!dirty || !online || !draftPayload || conflict || isPending || isError)
      return;
    const timer = window.setTimeout(() => {
      mutate({ action: "save_draft", payload: draftPayload });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [dirty, online, draftPayload, conflict, isPending, isError, mutate]);

  useEffect(() => {
    if (!dirty && !mutation.isPending) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const blockCourseNavigation = (event: MouseEvent) => {
      const target = event.target;
      const anchor =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        (anchor.target && anchor.target !== "_self") ||
        anchor.hasAttribute("download")
      )
        return;
      const next = new URL(anchor.href, window.location.href);
      if (
        next.origin !== window.location.origin ||
        (next.pathname === location.pathname && next.search === location.search)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPendingLocation(next.pathname + next.search + next.hash);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", blockCourseNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", blockCourseNavigation, true);
    };
  }, [dirty, location.pathname, location.search, mutation.isPending]);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data) return null;

  const state = query.data;
  const updateCurriculum = (
    update: (value: CourseCurriculum) => CourseCurriculum,
  ) => {
    if (mutation.isPending) return;
    setLocalDraft((current) => ({
      published_version: current?.published_version ?? state.published_version,
      draft_version: current?.draft_version ?? state.draft_version,
      content: update(current?.content ?? curriculum),
    }));
  };
  const saveDraft = () => {
    if (draftPayload && !conflict)
      mutate({ action: "save_draft", payload: draftPayload });
  };
  const publishDraft = () => {
    mutation.mutate({
      action: "publish",
      payload: {
        published_version: state.published_version,
        draft_version: state.draft_version,
      },
    });
  };
  const addModule = () => {
    const next = createCourseModule();
    next.title = t("newCourseModule");
    updateCurriculum((value) => ({ modules: [...value.modules, next] }));
    setModuleId(next.id);
    setLessonId(null);
    setPreview(false);
  };
  const addLesson = () => {
    if (!activeModule) return;
    const next = createCourseLesson();
    next.title = t("newCourseLesson");
    updateCurriculum((value) => ({
      modules: value.modules.map((item) =>
        item.id === activeModule.id
          ? { ...item, lessons: [...item.lessons, next] }
          : item,
      ),
    }));
    setLessonId(next.id);
    setPreview(false);
  };
  const reviseModule = (patch: Partial<CourseModule>) =>
    activeModule &&
    updateCurriculum((value) => ({
      modules: value.modules.map((item) =>
        item.id === activeModule.id ? { ...item, ...patch } : item,
      ),
    }));
  const reviseLesson = (patch: Partial<CourseLesson>) =>
    activeModule &&
    activeLesson &&
    updateCurriculum((value) => ({
      modules: value.modules.map((item) =>
        item.id === activeModule.id
          ? {
              ...item,
              lessons: item.lessons.map((lesson) =>
                lesson.id === activeLesson.id
                  ? { ...lesson, ...patch }
                  : lesson,
              ),
            }
          : item,
      ),
    }));

  if (!authoring)
    return (
      <section className="panel learning-panel course-authoring">
        <header>
          <h2>{t("curriculum")}</h2>
          {state.published_version > 0 && (
            <span>
              {t("curriculumPublishedVersion", {
                version: state.published_version,
              })}
            </span>
          )}
        </header>
        <CourseContents curriculum={curriculum} />
      </section>
    );

  return (
    <section className="panel learning-panel course-authoring">
      <header className="course-authoring-header">
        <div>
          <h2>{t("curriculum")}</h2>
          <p>{t("curriculumHelp")}</p>
          <p className="course-authoring-status" aria-live="polite">
            {isPending
              ? t(
                  mutation.variables?.action === "save_draft"
                    ? "curriculumSaving"
                    : "curriculumApplying",
                )
              : state.draft_version > 0
                ? t("curriculumDraftVersion", { version: state.draft_version })
                : state.published_version > 0
                  ? t("curriculumPublishedVersion", {
                      version: state.published_version,
                    })
                  : t("curriculumUnpublished")}
          </p>
        </div>
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? t("curriculumEdit") : t("curriculumPreview")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={
              !online || !dirty || !draftPayload || conflict || isPending
            }
            onClick={saveDraft}
          >
            {t("curriculumSaveDraft")}
          </Button>
          <Button
            type="button"
            disabled={
              !online ||
              dirty ||
              state.draft_version === 0 ||
              mutation.isPending
            }
            onClick={publishDraft}
          >
            {t("curriculumPublish")}
          </Button>
        </div>
      </header>
      {dirty && !conflict && (
        <Notice>
          {t(draftPayload ? "curriculumUnsaved" : "curriculumInvalid")}
        </Notice>
      )}
      {conflict && (
        <div role="alert">
          <p>{t("curriculumConflict")}</p>
          <Button
            type="button"
            variant="secondary"
            disabled={!online || query.isFetching}
            onClick={async () => {
              const result = await query.refetch();
              if (result.isSuccess) {
                setLocalDraft(null);
                reset();
              }
            }}
          >
            {t("curriculumReloadDiscard")}
          </Button>
        </div>
      )}
      {isError && !conflict && <ErrorState />}
      {mutation.isSuccess &&
        !dirty &&
        mutation.variables?.action === "save_draft" && (
          <Notice>{t("curriculumSaved")}</Notice>
        )}

      {preview ? (
        <CourseContents curriculum={curriculum} />
      ) : (
        <fieldset className="course-authoring-layout" disabled={isPending}>
          <aside aria-label={t("curriculumStructure")}>
            <div className="course-authoring-list-header">
              <h3>{t("courseModules")}</h3>
              <Button type="button" variant="secondary" onClick={addModule}>
                {t("curriculumAddModule")}
              </Button>
            </div>
            {curriculum.modules.length === 0 && (
              <p>{t("curriculumAddFirstModule")}</p>
            )}
            <ol className="course-authoring-modules">
              {curriculum.modules.map((item, index) => (
                <li key={item.id}>
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-current={item.id === moduleId ? "true" : undefined}
                      onClick={() => {
                        setModuleId(item.id);
                        setLessonId(null);
                      }}
                    >
                      {item.title || t("untitledCourseModule")}
                    </Button>
                    <div className="course-authoring-order">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={t("curriculumMoveModuleUp", {
                          title: item.title || t("untitledCourseModule"),
                        })}
                        disabled={index === 0}
                        onClick={() =>
                          updateCurriculum((value) => ({
                            modules: moveItem(value.modules, index, -1),
                          }))
                        }
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={t("curriculumMoveModuleDown", {
                          title: item.title || t("untitledCourseModule"),
                        })}
                        disabled={index === curriculum.modules.length - 1}
                        onClick={() =>
                          updateCurriculum((value) => ({
                            modules: moveItem(value.modules, index, 1),
                          }))
                        }
                      >
                        ↓
                      </Button>
                    </div>
                  </div>
                  <ul>
                    {item.lessons.map((lesson) => (
                      <li key={lesson.id}>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-current={
                            lesson.id === lessonId ? "true" : undefined
                          }
                          onClick={() => {
                            setModuleId(item.id);
                            setLessonId(lesson.id);
                          }}
                        >
                          {lesson.title || t("untitledCourseLesson")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </aside>

          <div className="course-authoring-editor">
            {!activeModule ? (
              <p>{t("curriculumSelectModule")}</p>
            ) : activeLesson ? (
              <>
                <div className="course-authoring-list-header">
                  <h3>{t("courseLesson")}</h3>
                  <Button type="button" variant="secondary" onClick={addLesson}>
                    {t("curriculumAddLesson")}
                  </Button>
                </div>
                <Field id="course-lesson-title" label={t("lessonTitle")}>
                  <input
                    maxLength={150}
                    value={activeLesson.title}
                    onChange={(event) =>
                      reviseLesson({ title: event.target.value })
                    }
                  />
                </Field>
                <Field
                  id="course-lesson-objectives"
                  label={t("lessonObjectives")}
                >
                  <textarea
                    maxLength={1000}
                    value={activeLesson.objectives}
                    onChange={(event) =>
                      reviseLesson({ objectives: event.target.value })
                    }
                  />
                </Field>
                <Field
                  id="course-lesson-duration"
                  label={t("lessonDurationLabel")}
                >
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={activeLesson.duration_minutes}
                    onChange={(event) =>
                      reviseLesson({
                        duration_minutes: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <KnowledgeEditor
                  key={activeLesson.id}
                  value={activeLesson.body}
                  onChange={(body) => reviseLesson({ body })}
                  label={t("lessonContent")}
                  disabled={isPending}
                />
                <div className="form-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={activeLessonIndex <= 0}
                    onClick={() =>
                      updateCurriculum((value) => ({
                        modules: value.modules.map((item) =>
                          item.id === activeModule.id
                            ? {
                                ...item,
                                lessons: moveItem(
                                  item.lessons,
                                  activeLessonIndex,
                                  -1,
                                ),
                              }
                            : item,
                        ),
                      }))
                    }
                  >
                    {t("curriculumMoveLessonUp")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={
                      activeLessonIndex === activeModule.lessons.length - 1
                    }
                    onClick={() =>
                      updateCurriculum((value) => ({
                        modules: value.modules.map((item) =>
                          item.id === activeModule.id
                            ? {
                                ...item,
                                lessons: moveItem(
                                  item.lessons,
                                  activeLessonIndex,
                                  1,
                                ),
                              }
                            : item,
                        ),
                      }))
                    }
                  >
                    {t("curriculumMoveLessonDown")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      updateCurriculum((value) => ({
                        modules: value.modules.map((item) =>
                          item.id === activeModule.id
                            ? {
                                ...item,
                                lessons: item.lessons.filter(
                                  (lesson) => lesson.id !== activeLesson.id,
                                ),
                              }
                            : item,
                        ),
                      }));
                      setLessonId(null);
                    }}
                  >
                    {t("curriculumRemoveLesson")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="course-authoring-list-header">
                  <h3>{t("courseModule")}</h3>
                  <Button type="button" variant="secondary" onClick={addLesson}>
                    {t("curriculumAddLesson")}
                  </Button>
                </div>
                <Field id="course-module-title" label={t("moduleTitle")}>
                  <input
                    maxLength={150}
                    value={activeModule.title}
                    onChange={(event) =>
                      reviseModule({ title: event.target.value })
                    }
                  />
                </Field>
                <Field
                  id="course-module-description"
                  label={t("moduleDescription")}
                >
                  <textarea
                    maxLength={1000}
                    value={activeModule.description}
                    onChange={(event) =>
                      reviseModule({ description: event.target.value })
                    }
                  />
                </Field>
                {activeModule.lessons.length === 0 && (
                  <p>{t("curriculumAddFirstLesson")}</p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    updateCurriculum((value) => ({
                      modules: value.modules.filter(
                        (item) => item.id !== activeModule.id,
                      ),
                    }));
                    setModuleId(null);
                  }}
                >
                  {t("curriculumRemoveModule")}
                </Button>
              </>
            )}
          </div>
        </fieldset>
      )}

      {state.versions.length > 0 && (
        <details className="course-authoring-history">
          <summary>{t("curriculumHistory")}</summary>
          <ol>
            {state.versions.map((version) => (
              <li key={version.version}>
                <span>
                  {t("curriculumVersionLabel", { version: version.version })} ·{" "}
                  {t("curriculumModuleCount", { count: version.module_count })}
                </span>
                <time dateTime={version.published_at}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                  }).format(new Date(version.published_at))}
                </time>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!online || dirty || mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      action: "restore",
                      payload: {
                        source_version: version.version,
                        published_version: state.published_version,
                        draft_version: state.draft_version,
                      },
                    })
                  }
                >
                  {t("curriculumRestore")}
                </Button>
              </li>
            ))}
          </ol>
        </details>
      )}

      {manager &&
        activeParticipants.length > 0 &&
        state.published_version > 0 && (
          <div className="course-authoring-migration">
            <Notice>{t("curriculumMigrationNotice")}</Notice>
            <Field
              id="course-content-participant"
              label={t("curriculumMigrateParticipant")}
            >
              <select
                value={participantId}
                onChange={(event) => setParticipantId(event.target.value)}
              >
                <option value="">{t("curriculumChooseParticipant")}</option>
                {activeParticipants.map((participant) => (
                  <option key={participant.user_id} value={participant.user_id}>
                    {participant.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              type="button"
              variant="secondary"
              disabled={
                !online || !participantId || dirty || mutation.isPending
              }
              onClick={() =>
                mutation.mutate({
                  action: "migrate",
                  payload: {
                    user_id: participantId,
                    target_version: state.published_version,
                  },
                })
              }
            >
              {t("curriculumMigrate")}
            </Button>
          </div>
        )}
      <Dialog
        open={pendingLocation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLocation(null);
        }}
        title={t("curriculumDiscardTitle")}
        description={t("curriculumDiscardDescription")}
        closeDisabled={mutation.isPending}
      >
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => setPendingLocation(null)}
          >
            {t("curriculumKeepEditing")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={mutation.isPending}
            onClick={() => {
              const next = pendingLocation;
              setLocalDraft(null);
              setPendingLocation(null);
              if (next) navigate(next);
            }}
          >
            {t("curriculumDiscardChanges")}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
