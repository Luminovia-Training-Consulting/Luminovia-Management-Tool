/** Course-run authoring and participant projection for versioned curricula. */
import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Dialog } from "../../components/ui/dialog";
import { dateTime, zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { DownloadButton } from "./resources";
import { KnowledgeEditor } from "../knowledge/editor-loader";
import { KnowledgeDocument } from "../knowledge/reader";
import {
  CourseLessonBlockEditor,
  CourseLessonBlockContent,
} from "./course-lesson-blocks";
import {
  courseContentAction,
  courseContentStudioKey,
  courseContentStudioQuery,
  type CourseContentAction,
  type CourseContentStudio,
  type CourseWorkspace,
} from "./api";
import {
  compareCourseCurricula,
  copyCourseLesson,
  copyCourseModule,
  createCourseLesson,
  createCourseModule,
  emptyCurriculum,
  maxCourseModules,
  maxLessonMaterials,
  maxModuleLessons,
  moveCourseLesson,
  normalizeCourseCurriculum,
  type CourseCurriculum,
  type CourseLesson,
  type CourseModule,
} from "./course-authoring-schema";
import {
  CourseDraftContext,
  type LocalCourseDraft,
} from "./course-draft-context";
import "../knowledge/knowledge.css";
import "./i18n";

const CourseCurriculumCatalogue = lazy(() =>
  import("./course-curriculum-catalogue").then(
    ({ CourseCurriculumCatalogue }) => ({ default: CourseCurriculumCatalogue }),
  ),
);

/** Resolve only currently projected, exact-version shares. Hidden and withdrawn shares are omitted. */
function CourseContents({
  curriculum,
  materials,
  preview = false,
}: {
  curriculum: CourseCurriculum;
  materials: CourseWorkspace["resources"];
  preview?: boolean;
}) {
  const { t } = useTranslation("learning");
  const modules = curriculum.modules.filter((module) => !module.archived);
  const byId = new Map(materials.map((material) => [material.id, material]));
  if (!modules.length) return <p>{t("curriculumEmpty")}</p>;
  return (
    <div className="course-authoring-preview">
      {modules.map((module) => (
        <section key={module.id}>
          <h3>{module.title}</h3>
          {module.description && <p>{module.description}</p>}
          {module.lessons
            .filter((lesson) => !lesson.archived)
            .map((lesson) => (
              <article key={lesson.id}>
                <h4>{lesson.title}</h4>
                {lesson.objectives && (
                  <p>
                    <strong>{t("lessonObjectives")}: </strong>
                    {lesson.objectives}
                  </p>
                )}
                {lesson.duration_minutes > 0 && (
                  <p>
                    {t("lessonDuration", { count: lesson.duration_minutes })}
                  </p>
                )}
                <KnowledgeDocument value={lesson.body} label={lesson.title} />
                {lesson.blocks?.map((block) => (
                  <CourseLessonBlockContent key={block.id} block={block} />
                ))}
                {lesson.material_ids?.map((id) => {
                  const material = byId.get(id);
                  return (
                    material && (
                      <p key={id}>
                        {material.name}
                        {!preview && (
                          <DownloadButton
                            kind="resource"
                            id={id}
                            name={material.name}
                            label={t("materialDownload", {
                              name: material.name,
                            })}
                          />
                        )}
                      </p>
                    )
                  );
                })}
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

function LessonDestination({
  modules,
  sourceId,
  onMove,
}: {
  modules: CourseModule[];
  sourceId: string;
  onMove: (id: string) => void;
}) {
  const { t } = useTranslation("learning");
  const [destination, setDestination] = useState("");
  const available = modules.some(
    (module) =>
      module.id !== sourceId && module.lessons.length < maxModuleLessons,
  );
  const valid = modules.some(
    (module) =>
      module.id === destination &&
      module.id !== sourceId &&
      module.lessons.length < maxModuleLessons,
  );

  if (modules.length < 2) return null;
  return (
    <div className="course-authoring-destination">
      <Field
        id="course-lesson-destination"
        label={t("curriculumLessonDestination")}
      >
        <select
          disabled={!available}
          value={valid ? destination : ""}
          onChange={(event) => setDestination(event.target.value)}
        >
          <option value="">{t("curriculumChooseModule")}</option>
          {modules.map(
            (module, index) =>
              module.id !== sourceId && (
                <option
                  key={module.id}
                  value={module.id}
                  disabled={module.lessons.length >= maxModuleLessons}
                >
                  {t("curriculumModuleOption", {
                    position: index + 1,
                    title: module.title || t("untitledCourseModule"),
                  })}
                </option>
              ),
          )}
        </select>
      </Field>
      {!available && <p>{t("curriculumNoDestination")}</p>}
      <Button
        type="button"
        variant="secondary"
        disabled={!valid}
        onClick={() => {
          onMove(destination);
          setDestination("");
        }}
      >
        {t("curriculumMoveLessonToModule")}
      </Button>
    </div>
  );
}

/** Summarise which stable objects a draft changes relative to the last publication. */
function CurriculumComparison({
  published,
  draft,
  version,
}: {
  published: CourseCurriculum;
  draft: CourseCurriculum;
  version: number;
}) {
  const { t } = useTranslation("learning");
  const [open, setOpen] = useState(false);
  const changes = open ? compareCourseCurricula(published, draft) : [];
  return (
    <details
      className="course-authoring-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("curriculumCompare", { version })}</summary>
      {open &&
        (changes.length ? (
          <ul className="space-y-2">
            {changes.map(({ id, kind, title, previousTitle, fieldChanges }) => (
              <li key={id}>
                <strong>
                  {t(kind)} · {title}
                </strong>
                {previousTitle && (
                  <> {t("curriculumPreviousTitle", { title: previousTitle })}</>
                )}
                {" · "}
                {fieldChanges.map((change) => t(change)).join(", ")}
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("curriculumNoChanges")}</p>
        ))}
    </details>
  );
}

/** Attach learner-visible materials without leaving the existing scanned share scope. */
function LessonMaterials({
  selected,
  materials,
  onChange,
}: {
  selected: string[];
  materials: CourseWorkspace["resources"];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation("learning");
  const [choice, setChoice] = useState("");
  const available = materials.filter(({ id }) => !selected.includes(id));
  return (
    <div className="space-y-2">
      <Field id="course-lesson-material" label={t("curriculumLessonMaterials")}>
        <select
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">{t("curriculumChooseMaterial")}</option>
          {available.map(({ id, name, version }) => (
            <option key={id} value={id}>
              {name} · {t("version", { version })}
            </option>
          ))}
        </select>
      </Field>
      <Button
        type="button"
        variant="secondary"
        disabled={
          selected.length >= maxLessonMaterials ||
          !available.some(({ id }) => id === choice)
        }
        onClick={() => {
          onChange([...selected, choice]);
          setChoice("");
        }}
      >
        {t("curriculumAttachMaterial")}
      </Button>
      {selected.length > 0 && (
        <ul className="space-y-2">
          {selected.map((id) => {
            const name =
              materials.find((material) => material.id === id)?.name ??
              t("curriculumUnavailableMaterial");
            return (
              <li key={id} className="flex flex-wrap items-center gap-2">
                <span>{name}</span>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={t("curriculumDetachMaterialNamed", { name })}
                  onClick={() =>
                    onChange(selected.filter((item) => item !== id))
                  }
                >
                  {t("curriculumDetachMaterial")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type ReviewCommand = Extract<
  CourseContentAction,
  | "request_review"
  | "approve_review"
  | "return_review"
  | "cancel_review"
  | "schedule_publish"
>;

/** Review a saved draft without changing what learners can currently read. */
function CurriculumReview({
  review,
  manager,
  zone,
  disabled,
  apply,
}: {
  review: CourseContentStudio["review"];
  manager: boolean;
  zone: string;
  disabled: boolean;
  apply: (action: ReviewCommand, fields?: object) => void;
}) {
  const { t, i18n } = useTranslation("learning");
  const [scheduled, setScheduled] = useState("");
  const state = review?.state;
  const actions: { action: ReviewCommand; label: string }[] = [];
  if (!state || state === "returned" || state === "blocked")
    actions.push({
      action: "request_review",
      label: "curriculumRequestReview",
    });
  if (state === "requested" && manager) {
    actions.push({
      action: "approve_review",
      label: "curriculumApproveReview",
    });
    actions.push({ action: "return_review", label: "curriculumReturnReview" });
  }
  if (state && (manager || (state !== "approved" && state !== "scheduled")))
    actions.push({ action: "cancel_review", label: "curriculumCancelReview" });
  const instant = scheduled && zonedInstant(scheduled, zone);
  return (
    <section className="space-y-2" aria-labelledby="curriculum-review-title">
      <h3 id="curriculum-review-title">{t("curriculumReview")}</h3>
      {state && (
        <p role="status">
          {t(`curriculumReviewState.${state}`)}
          {state === "scheduled" &&
            review.publish_at &&
            ` · ${dateTime(review.publish_at, i18n.language, zone)} (${zone})`}
        </p>
      )}
      <div className="form-actions">
        {actions.map(({ action, label }) => (
          <Button
            key={action}
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => apply(action)}
          >
            {t(label)}
          </Button>
        ))}
      </div>
      {manager && state === "approved" && (
        <form
          className="form-actions"
          onSubmit={(event) => {
            event.preventDefault();
            if (instant && !disabled)
              apply("schedule_publish", { publish_at: instant });
          }}
        >
          <Field
            id="curriculum-publish-at"
            label={t("curriculumPublishAt", { zone })}
          >
            <input
              type="datetime-local"
              value={scheduled}
              onChange={(event) => setScheduled(event.target.value)}
              required
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            disabled={disabled || !instant}
          >
            {t("curriculumSchedulePublish")}
          </Button>
        </form>
      )}
    </section>
  );
}

export function CourseAuthoring({
  actor,
  courseId,
  editable,
  manager,
  roster,
  resources = [],
  zone = "UTC",
}: {
  actor: string;
  courseId: string;
  editable: boolean;
  manager: boolean;
  roster: CourseWorkspace["roster"];
  resources?: CourseWorkspace["resources"];
  zone?: string;
}) {
  const { t } = useTranslation("learning");
  const location = useLocation();
  const navigate = useNavigate();
  const online = useOnline();
  const cache = useQueryClient();
  const key = courseContentStudioKey(actor, courseId);
  const query = useQuery({
    ...courseContentStudioQuery(actor, courseId),
    refetchOnMount: "always",
  });
  const retainedDraft = useContext(CourseDraftContext);
  const fallbackDraft = useState<LocalCourseDraft | null>(null);
  const [localDraft, setLocalDraft] = retainedDraft ?? fallbackDraft;
  const studio =
    query.isFetchedAfterMount && query.isSuccess ? query.data : null;
  const [mergeBlocked, setMergeBlocked] = useState(false);
  const [preview, setPreview] = useState(false);
  const [compactPreview, setCompactPreview] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [copiedLessonTitle, setCopiedLessonTitle] = useState<string>();
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState("");
  const [pendingLocation, setPendingLocation] = useState<string | null>(null);
  const authoring = editable && studio?.can_edit === true;
  const dirty = authoring && localDraft !== null;
  useEffect(() => {
    if (studio && !authoring) setLocalDraft(null);
  }, [authoring, setLocalDraft, studio]);

  const curriculum = useMemo(() => {
    if (dirty) return localDraft.content;
    if (!studio) return emptyCurriculum;
    const content = authoring
      ? (studio.draft_content ?? studio.published_content)
      : studio.published_content;
    return normalizeCourseCurriculum(content);
  }, [authoring, dirty, localDraft, studio]);

  const activeModuleIndex = curriculum.modules.findIndex(
    (item) => item.id === moduleId,
  );
  const activeModule = curriculum.modules[activeModuleIndex] ?? null;
  const activeLessonIndex =
    activeModule?.lessons.findIndex((item) => item.id === lessonId) ?? -1;
  const activeLesson = activeModule?.lessons[activeLessonIndex] ?? null;
  const canAddModule = curriculum.modules.length < maxCourseModules;
  const canAddLesson =
    !!activeModule && activeModule.lessons.length < maxModuleLessons;
  const activeParticipants = useMemo(
    () => roster.filter((item) => item.status === "enrolled"),
    [roster],
  );
  const mutation = useMutation({
    mutationFn: async ({
      action,
      payload,
    }: {
      action: CourseContentAction;
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
        published_version: localDraft.published_version,
        draft_version: localDraft.draft_version,
        content: normalizeCourseCurriculum(localDraft.content),
      };
    } catch {
      return null;
    }
  }, [localDraft]);

  useEffect(() => {
    if (
      !dirty ||
      !online ||
      !draftPayload ||
      conflict ||
      isPending ||
      isError ||
      catalogueOpen
    )
      return;
    const timer = window.setTimeout(() => {
      mutate({ action: "save_draft", payload: draftPayload });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [
    dirty,
    online,
    draftPayload,
    conflict,
    isPending,
    isError,
    mutate,
    catalogueOpen,
  ]);

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

  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!studio) return <Loading />;

  const state = studio;
  const reviewState = state.review?.state;
  const draftLocked =
    reviewState === "requested" ||
    reviewState === "approved" ||
    reviewState === "scheduled";
  const publicationBlocked =
    reviewState !== undefined && reviewState !== "approved";
  const materials = resources.filter(
    ({ category, audience, sha256 }) =>
      category === "material" &&
      (audience === "all" || audience === "participants") &&
      /^[0-9a-f]{64}$/.test(sha256),
  );
  const updateCurriculum = (
    update: (value: CourseCurriculum) => CourseCurriculum,
  ) => {
    if (mutation.isPending) return;
    setLocalDraft((current) => ({
      base: current?.base ?? curriculum,
      published_version: current?.published_version ?? state.published_version,
      draft_version: current?.draft_version ?? state.draft_version,
      content: update(current?.content ?? curriculum),
    }));
  };
  async function mergeDraft() {
    if (!localDraft || !draftPayload) return;
    const result = await query.refetch();
    if (!result.isSuccess) return;
    const latest = result.data;
    const remote = normalizeCourseCurriculum(
      latest.draft_content ?? latest.published_content,
    );
    const locked =
      latest.review?.state === "requested" ||
      latest.review?.state === "approved" ||
      latest.review?.state === "scheduled";
    const merged =
      latest.can_edit && !locked
        ? (await import("./curriculum-merge")).mergeCourseCurriculum(
            localDraft.base,
            draftPayload.content,
            remote,
          )
        : null;
    setMergeBlocked(merged === null);
    if (merged) {
      setLocalDraft({
        base: remote,
        content: merged,
        published_version: latest.published_version,
        draft_version: latest.draft_version,
      });
      reset();
    }
  }
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
  const insertModule = (next: CourseModule, index: number) => {
    if (!canAddModule) return;
    updateCurriculum((value) => ({
      modules: [
        ...value.modules.slice(0, index),
        next,
        ...value.modules.slice(index),
      ],
    }));
    setModuleId(next.id);
    setLessonId(null);
    setPreview(false);
  };
  const addModule = () =>
    insertModule(
      { ...createCourseModule(), title: t("newCourseModule") },
      curriculum.modules.length,
    );
  const insertLesson = (
    next: CourseLesson,
    index: number,
    fromCatalogue = false,
  ) => {
    if (!activeModule || !canAddLesson) return false;
    const withLesson = (value: CourseCurriculum) => ({
      modules: value.modules.map((item) =>
        item.id === activeModule.id
          ? {
              ...item,
              lessons: [
                ...item.lessons.slice(0, index),
                next,
                ...item.lessons.slice(index),
              ],
            }
          : item,
      ),
    });
    if (fromCatalogue) {
      try {
        normalizeCourseCurriculum(withLesson(curriculum));
      } catch {
        return false;
      }
    }
    updateCurriculum(withLesson);
    if (!fromCatalogue) setLessonId(next.id);
    setPreview(false);
    return true;
  };
  const addLesson = () => {
    if (activeModule)
      insertLesson(
        { ...createCourseLesson(), title: t("newCourseLesson") },
        activeModule.lessons.length,
      );
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
        <CourseContents curriculum={curriculum} materials={materials} />
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
              publicationBlocked ||
              mutation.isPending
            }
            onClick={publishDraft}
          >
            {t("curriculumPublish")}
          </Button>
        </div>
      </header>
      {state.draft_version > 0 && !dirty && (
        <CurriculumReview
          review={state.review}
          manager={manager}
          zone={zone}
          disabled={!online || conflict || isPending}
          apply={(action, fields) =>
            mutate({
              action,
              payload: {
                published_version: state.published_version,
                draft_version: state.draft_version,
                ...fields,
              },
            })
          }
        />
      )}
      {dirty && !conflict && (
        <Notice>
          {t(draftPayload ? "curriculumUnsaved" : "curriculumInvalid")}
        </Notice>
      )}
      {conflict && (
        <div role="alert">
          <p>{t("curriculumConflict")}</p>
          {mergeBlocked && <p>{t("curriculumMergeBlocked")}</p>}
          <div className="form-actions">
            {draftPayload && (
              <Button
                type="button"
                variant="secondary"
                disabled={!online || query.isFetching}
                onClick={() => void mergeDraft()}
              >
                {t("curriculumMerge")}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={!online || query.isFetching}
              onClick={async () => {
                const result = await query.refetch();
                if (result.isSuccess) {
                  setLocalDraft(null);
                  setMergeBlocked(false);
                  reset();
                }
              }}
            >
              {t("curriculumReloadDiscard")}
            </Button>
          </div>
        </div>
      )}
      {isError && !conflict && <ErrorState />}
      {mutation.isSuccess &&
        !dirty &&
        mutation.variables?.action === "save_draft" && (
          <Notice>{t("curriculumSaved")}</Notice>
        )}
      {copiedLessonTitle && (
        <p role="status">
          {t("curriculumCatalogueCopied", { title: copiedLessonTitle })}
        </p>
      )}
      {catalogueOpen && activeModule && (
        <Suspense fallback={<Loading />}>
          <CourseCurriculumCatalogue
            actor={actor}
            course={courseId}
            unavailable={
              draftLocked ||
              conflict ||
              isPending ||
              !canAddLesson ||
              Boolean(activeModule.archived)
            }
            onClose={() => setCatalogueOpen(false)}
            onCopy={(lesson) => {
              if (!insertLesson(lesson, activeModule.lessons.length, true))
                return false;
              setCopiedLessonTitle(lesson.title);
              setCatalogueOpen(false);
              return true;
            }}
          />
        </Suspense>
      )}

      {preview ? (
        <div>
          <div
            className="form-actions"
            role="group"
            aria-label={t("curriculumPreviewWidth")}
          >
            <Button
              type="button"
              variant="secondary"
              aria-pressed={!compactPreview}
              onClick={() => setCompactPreview(false)}
            >
              {t("curriculumPreviewWide")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              aria-pressed={compactPreview}
              onClick={() => setCompactPreview(true)}
            >
              {t("curriculumPreviewCompact")}
            </Button>
          </div>
          <div
            className={compactPreview ? "course-authoring-compact" : undefined}
          >
            <CourseContents
              curriculum={curriculum}
              materials={materials}
              preview
            />
          </div>
        </div>
      ) : (
        <fieldset
          className="course-authoring-layout"
          disabled={isPending || draftLocked}
        >
          <aside aria-label={t("curriculumStructure")}>
            <div className="course-authoring-list-header">
              <h3>{t("courseModules")}</h3>
              <Button
                type="button"
                variant="secondary"
                disabled={!canAddModule}
                onClick={addModule}
              >
                {t("curriculumAddModule")}
              </Button>
            </div>
            {curriculum.modules.length === 0 && (
              <p>{t("curriculumAddFirstModule")}</p>
            )}
            {!canAddModule && (
              <p>{t("curriculumModuleLimit", { count: maxCourseModules })}</p>
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
            {activeModule && !canAddLesson && (
              <p>{t("curriculumLessonLimit", { count: maxModuleLessons })}</p>
            )}
            {!activeModule ? (
              <p>{t("curriculumSelectModule")}</p>
            ) : activeLesson ? (
              <>
                <div className="course-authoring-list-header">
                  <h3>{t("courseLesson")}</h3>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canAddLesson}
                    onClick={addLesson}
                  >
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
                  key={activeLesson.id + ":editor"}
                  value={activeLesson.body}
                  onChange={(body) => reviseLesson({ body })}
                  label={t("lessonContent")}
                  disabled={isPending}
                />
                <CourseLessonBlockEditor
                  key={activeLesson.id + ":blocks"}
                  blocks={activeLesson.blocks ?? []}
                  onChange={(blocks) => reviseLesson({ blocks })}
                  pending={isPending}
                  move={moveItem}
                />
                <div className="form-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canAddLesson}
                    onClick={() =>
                      insertLesson(
                        copyCourseLesson(activeLesson),
                        activeLessonIndex + 1,
                      )
                    }
                  >
                    {t("curriculumCopyLesson")}
                  </Button>
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
                    onClick={() =>
                      reviseLesson({ archived: !activeLesson.archived })
                    }
                  >
                    {t(
                      activeLesson.archived
                        ? "curriculumRestoreLesson"
                        : "curriculumArchiveLesson",
                    )}
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
                <LessonMaterials
                  key={activeLesson.id + ":materials"}
                  selected={activeLesson.material_ids ?? []}
                  materials={materials}
                  onChange={(material_ids) => reviseLesson({ material_ids })}
                />
                <LessonDestination
                  key={activeLesson.id + ":destination"}
                  modules={curriculum.modules}
                  sourceId={activeModule.id}
                  onMove={(destination) => {
                    updateCurriculum((value) =>
                      moveCourseLesson(
                        value,
                        activeModule.id,
                        activeLesson.id,
                        destination,
                      ),
                    );
                    setModuleId(destination);
                  }}
                />
              </>
            ) : (
              <>
                <div className="course-authoring-list-header">
                  <h3>{t("courseModule")}</h3>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canAddLesson}
                    onClick={addLesson}
                  >
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
                <div className="form-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={
                      !online ||
                      !canAddLesson ||
                      activeModule.archived ||
                      conflict
                    }
                    onClick={() => setCatalogueOpen(true)}
                  >
                    {t("curriculumCatalogue")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canAddModule}
                    onClick={() =>
                      insertModule(
                        copyCourseModule(activeModule),
                        activeModuleIndex + 1,
                      )
                    }
                  >
                    {t("curriculumCopyModule")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      reviseModule({ archived: !activeModule.archived })
                    }
                  >
                    {t(
                      activeModule.archived
                        ? "curriculumRestoreModule"
                        : "curriculumArchiveModule",
                    )}
                  </Button>
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
                </div>
              </>
            )}
          </div>
        </fieldset>
      )}

      {state.published_version > 0 && (dirty || state.draft_version > 0) && (
        <CurriculumComparison
          published={normalizeCourseCurriculum(state.published_content)}
          draft={curriculum}
          version={state.published_version}
        />
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
                  disabled={
                    !online || dirty || mutation.isPending || draftLocked
                  }
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
