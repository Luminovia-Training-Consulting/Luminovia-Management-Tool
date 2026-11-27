import { LoadMore } from "../../components/load-more";
import { SessionScroll } from "../../components/session-scroll";
import { PermanentDeleteAction } from "../deletions/deletions";
/**
 * Reusable templates and actual course runs with concrete sessions. Content, participant
 * management and versioned publication of linked teaching offers.
 */
import { selectableTopics } from "../taxonomy/selection";
import "../taxonomy/i18n";
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import "../learning/i18n";
import { courseWorkspaceEntitlementQuery } from "../learning/api";
import { ResourceComments } from "../comments/comments";
import { changeCandidatesQuery } from "../changes/api";
import {
  OfferPublicationAction,
  PublishOfferDraft,
} from "../jobs/publish-draft";
import { lifecycleQuery, refreshJobState } from "../jobs/lifecycle-api";
import { TimeZoneOptions } from "../../components/time-zone-options";
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { CoursePhaseFilter } from "../learning/course-phase-filter";
import { CourseSessionRecurrence } from "../learning/course-session-recurrence";
import {
  scheduledCoursePhase,
  type CoursePhaseSelection,
} from "../learning/course-phase";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  Copy,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { DateTime } from "luxon";
import "./i18n";
import "./styles.css";
import { useAuth } from "../auth/auth-context";
import { clientOrganisationsQuery } from "../commercial/commission-api";
import {
  permissionsQuery,
  topicsQuery,
  userRolesQuery,
} from "../../lib/queries";
import type { Topic } from "../../lib/types";
import { calendarCourseSchedule } from "../../lib/course-calendar-link";
import { db } from "../../lib/supabase";
import {
  dateTime,
  validZone,
  zonedInstantForScheduleEdit,
  compareScheduleInstants,
  validScheduleIntervals,
} from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { TableImport } from "../../components/table-import";
import { importTableRow } from "../../components/table-import-api";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import {
  buildingBlockPlanningQuery,
  type CourseRun,
  type Organisation,
  orgQuery,
  runsQuery,
  type Template,
  templatesQuery,
} from "./data";
import { BuildingBlockReference, CourseRunOfferLink } from "./building-blocks";
import { CourseSessionBulkEdit } from "./course-session-bulk-edit";
import { CourseSchedulePlanner } from "./course-schedule-planner";
import "./course-creator-drafts-i18n";
import {
  courseCreatorDraftId,
  courseCreatorDraftsQuery,
  useCourseCreatorDraftSaver,
  type CourseCreatorDraft,
} from "./course-creator-drafts-api";
import { CourseSeriesForm } from "./course-series";

import { courseTemplateFormSchema as templateSchema } from "./course-building-block-schema";

const CourseCreatorDraftLibrary = lazy(() =>
  import("./course-creator-drafts").then(({ CourseCreatorDraftLibrary }) => ({
    default: CourseCreatorDraftLibrary,
  })),
);
const CourseCreatorDraftSaveBar = lazy(() =>
  import("./course-creator-drafts").then(({ CourseCreatorDraftSaveBar }) => ({
    default: CourseCreatorDraftSaveBar,
  })),
);

const CourseReuseForm = lazy(() =>
  import("./course-reuse").then((module) => ({
    default: module.CourseReuseForm,
  })),
);

const CourseOfferForm = lazy(() =>
  import("../admin/admin").then(({ CourseOfferForm }) => ({
    default: CourseOfferForm,
  })),
);

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const runSchema = z.object({
  template_id: z.uuid(),
  organisation_id: z.string(),
  time_zone: z.string().refine(validZone),
  delivery_type: z.enum(["online", "onsite"]),
  venue: z.string().max(500),
  teaching_language: z.enum(["", "de", "en"]).optional(),
  archived: z.boolean(),
  sessions: z
    .array(
      z.object({
        starts_at: z.string().min(1),
        ends_at: z.string().min(1),
        // Form-local identity follows a retained row through remove/reorder.
        // It is never included in the normalized server session payload.
        source_session_id: z.string().optional(),
      }),
    )
    .min(1)
    .max(60),
});

type TemplateValues = z.infer<typeof templateSchema>;
type PlanningOrganisation = Pick<Organisation, "id" | "name"> &
  Partial<Pick<Organisation, "archived_at">>;
const newCourseSchema = runSchema.extend({
  template_id: z.union([z.uuid(), z.literal("")]),
});

/** Validate the draft without rounding unchanged stored instants or reordering submitted rows. */
function resolveCourseSessions(
  rows: z.infer<typeof runSchema>["sessions"],
  zone: string,
  origins: {
    zone: string;
    sessions: Map<string, { starts_at: string; ends_at: string }>;
  },
) {
  const sessions = [];
  for (const row of rows) {
    const source = origins.sessions.get(row.source_session_id ?? "");
    const starts_at = zonedInstantForScheduleEdit(
      row.starts_at,
      zone,
      source?.starts_at,
      origins.zone,
    );
    const ends_at = zonedInstantForScheduleEdit(
      row.ends_at,
      zone,
      source?.ends_at,
      origins.zone,
    );
    if (!starts_at || !ends_at) return null;
    sessions.push({ starts_at, ends_at });
  }
  if (!validScheduleIntervals(sessions)) return null;
  return sessions;
}

async function saveCourseTemplate(
  values: z.infer<typeof templateSchema>,
  id: string | null,
  owner?: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_course_template", {
    p_id: id,
    p_payload: owner ? { ...values, owner_organisation_id: owner } : values,
  });
  if (error) throw error;
  return data as string;
}

function CourseContentFields({
  register,
  errors,
  topics,
  selectedTopicIds,
}: {
  register: UseFormRegister<TemplateValues>;
  errors: FieldErrors<TemplateValues>;
  topics: Topic[];
  selectedTopicIds: string[];
}) {
  const { t, i18n } = useTranslation("operations");
  const availableTopics = selectableTopics(topics, selectedTopicIds);
  const topicGroups = (["topic", "tool", "language"] as const)
    .map((kind) => ({
      kind,
      entries: availableTopics.filter((entry) => entry.kind === kind),
    }))
    .filter(({ entries }) => entries.length > 0);
  return (
    <>
      <Field
        id="template-title"
        label={t("title")}
        error={Boolean(errors.title)}
      >
        <input id="template-title" {...register("title")} />
      </Field>
      {(["description", "syllabus", "prerequisites"] as const).map((key) => (
        <Field
          key={key}
          id={`template-${key}`}
          label={t(key)}
          error={Boolean(errors[key])}
        >
          <textarea
            id={`template-${key}`}
            rows={key === "syllabus" ? 6 : 3}
            {...register(key)}
          />
        </Field>
      ))}
      {topicGroups.length > 0 && (
        <div className="operations-topic-groups">
          {topicGroups.map(({ kind, entries }) => (
            <fieldset className="operations-topic-field" key={kind}>
              <legend>{t(`courseCatalogueKind.${kind}`)}</legend>
              <div className="operations-topic-options">
                {entries.map((topic) => (
                  <label className="checkbox-label" key={topic.id}>
                    <input
                      type="checkbox"
                      value={topic.id}
                      {...register("topic_ids")}
                    />
                    <span>
                      {i18n.language.startsWith("de")
                        ? topic.label_de
                        : topic.label_en}
                      {topic.archived_at && <> ({t("taxonomy:archived")})</>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </>
  );
}

/** Edit reusable content templates separately from particular customers and schedules. */
function TemplateForm({
  original,
  organisations,
  companyOnly,
  onDone,
}: {
  original?: Template;
  organisations: PlanningOrganisation[];
  companyOnly: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation("operations");
  const client = useQueryClient();
  const online = useOnline();
  const topics = useQuery(topicsQuery);
  const [owner, setOwner] = useState(
    original?.owner_organisation_id ??
      (companyOnly ? organisations[0]?.id : "") ??
      "",
  );
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof templateSchema>>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      title: original?.title ?? "",
      description: original?.description ?? "",
      syllabus: original?.syllabus ?? "",
      prerequisites: original?.prerequisites ?? "",
      topic_ids:
        original?.course_template_topics.map((topic) => topic.topic_id) ?? [],
      archived: Boolean(original?.archived_at),
    },
  });
  const selectedTopicIds = useWatch({ control, name: "topic_ids" }) ?? [];
  const save = useMutation({
    mutationFn: (values: z.infer<typeof templateSchema>) =>
      saveCourseTemplate(
        values,
        original?.id ?? null,
        companyOnly || !original?.owner_organisation_id ? owner : undefined,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["operations"] });
      onDone();
    },
  });
  if (topics.isPending) return <Loading />;
  if (topics.isError) return <ErrorState retry={() => void topics.refetch()} />;
  return (
    <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
      <Field id="template-owner" label={t("templateOwner")}>
        <select
          id="template-owner"
          value={owner}
          disabled={companyOnly || Boolean(original?.owner_organisation_id)}
          onChange={(event) => setOwner(event.target.value)}
        >
          {!companyOnly && <option value="">{t("internalTemplate")}</option>}
          {organisations
            .filter(
              (organisation) =>
                !organisation.archived_at || organisation.id === owner,
            )
            .map((organisation) => (
              <option key={organisation.id} value={organisation.id}>
                {organisation.name}
              </option>
            ))}
        </select>
      </Field>
      <CourseContentFields
        register={register}
        errors={errors}
        topics={topics.data}
        selectedTopicIds={selectedTopicIds}
      />
      <label className="checkbox-label">
        <input type="checkbox" {...register("archived")} />
        {t("archive")}
      </label>
      <Button disabled={!online || save.isPending || (companyOnly && !owner)}>
        {t("save")}
      </Button>
      {save.isError && (
        <Notice kind="error">
          {t(
            save.error.message === "course_locked"
              ? companyOnly
                ? "companyTemplateLocked"
                : "locked"
              : "error",
          )}
        </Notice>
      )}
    </form>
  );
}

/** Plan a run from a template with specific local times, customer and delivery mode. */
function RunForm({
  original,
  templates,
  organisations,
  initialTemplateId,
  initialSchedule,
  creator,
  reloadCreator,
  companyOnly,
  focusTarget,
  canPrepareOffer,
  canReadBlockPlanning,
  onDone,
  onBusy,
}: {
  original?: CourseRun;
  templates: Template[];
  organisations: PlanningOrganisation[];
  initialTemplateId?: string;
  initialSchedule?: ReturnType<typeof calendarCourseSchedule>;
  creator?: { id: string; saved?: CourseCreatorDraft };
  reloadCreator?: () => void;
  companyOnly: boolean;
  focusTarget?: "schedule" | "organisation";
  canPrepareOffer: boolean;
  canReadBlockPlanning: boolean;
  onDone: (
    result: "template" | "run",
    offerRun?: string,
    savedRun?: string,
  ) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { t, i18n } = useTranslation("operations");
  const creatorText = useTranslation("courseCreator").t;
  const draftOnly = Boolean(initialTemplateId) && !original && !creator;
  const { session } = useAuth();
  const actor = session!.user.id;
  const draftSaver = useCourseCreatorDraftSaver(
    actor,
    creator?.id,
    creator?.saved?.revision,
  );
  const online = useOnline();
  const client = useQueryClient();
  const topics = useQuery(topicsQuery);
  const content = useForm<TemplateValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: creator?.saved?.payload?.content ?? {
      title: "",
      description: "",
      syllabus: "",
      prerequisites: "",
      topic_ids: [],
      archived: false,
    },
  });
  const topicIds =
    useWatch({ control: content.control, name: "topic_ids" }) ?? [];
  const [templateRetained, setTemplateRetained] = useState(false);
  const createdTemplate = useRef<{
    id: string;
    value: string;
    owner: string;
  } | null>(null);
  const [timeError, setTimeError] = useState(false);
  const sessionOrigins = useRef({
    zone: original?.time_zone ?? "Europe/Berlin",
    sessions: new Map(
      original?.course_sessions.map(({ id, starts_at, ends_at }) => [
        id,
        { starts_at, ends_at },
      ]) ?? [],
    ),
  });
  const {
    register,
    control,
    getValues,
    handleSubmit,
    setValue,
    setFocus,
    formState: { errors, isDirty },
  } = useForm<z.infer<typeof newCourseSchema>>({
    resolver: zodResolver(newCourseSchema),
    defaultValues: creator?.saved?.payload?.run ?? {
      template_id: original?.template_id ?? initialTemplateId ?? "",
      organisation_id:
        original?.organisation_id ??
        templates.find(({ id }) => id === initialTemplateId)
          ?.owner_organisation_id ??
        "",
      time_zone:
        original?.time_zone ?? initialSchedule?.time_zone ?? "Europe/Berlin",
      delivery_type: original?.delivery_type ?? "online",
      venue: original?.venue ?? "",
      teaching_language: original?.teaching_language ?? "",
      archived: Boolean(original?.archived_at),
      sessions: original
        ? [...original.course_sessions]
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
            .map((s) => ({
              source_session_id: s.id,
              starts_at: DateTime.fromISO(s.starts_at)
                .setZone(original.time_zone)
                .toFormat("yyyy-MM-dd'T'HH:mm"),
              ends_at: DateTime.fromISO(s.ends_at)
                .setZone(original.time_zone)
                .toFormat("yyyy-MM-dd'T'HH:mm"),
            }))
        : [
            {
              starts_at: initialSchedule?.starts_at ?? "",
              ends_at: initialSchedule?.ends_at ?? "",
            },
          ],
    },
  });
  const editedSessions = useWatch({ control, name: "sessions" }) ?? [];
  // Only the creator observes the complete unsaved form. Normal course editing
  // continues to subscribe to the specific fields needed for its existing UI.
  const creatorRunValues = useWatch({ control, disabled: !creator });
  const creatorContentValues = useWatch({
    control: content.control,
    disabled: !creator,
  });
  const editedSessionCount = editedSessions.filter(
    (entry) => entry.starts_at || entry.ends_at,
  ).length;
  const schedule = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!focusTarget) return;
    const frame = requestAnimationFrame(() => {
      if (focusTarget === "schedule") schedule.current?.focus();
      else setFocus("organisation_id");
    });
    return () => cancelAnimationFrame(frame);
  }, [focusTarget, setFocus]);
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "sessions",
  });
  const lastSession = useWatch({
    control,
    name: `sessions.${Math.max(fields.length - 1, 0)}`,
  });
  const selectedTemplateId = useWatch({ control, name: "template_id" });
  const zone = useWatch({ control, name: "time_zone" });
  const selectedOrganisationId = useWatch({ control, name: "organisation_id" });
  const activeOrganisation = organisations.some(
    (org) => org.id === selectedOrganisationId && !org.archived_at,
  );
  const selectedTemplate = templates.find(
    (item) => item.id === selectedTemplateId,
  );
  const currentOrganisation = organisations.find(
    (item) => item.id === original?.organisation_id,
  );
  const blockPlanning = useQuery({
    ...buildingBlockPlanningQuery(actor),
    enabled:
      canReadBlockPlanning && Boolean(selectedTemplate?.building_block_id),
  });
  const selectedBlock = canReadBlockPlanning
    ? blockPlanning.data?.find(
        (item) => item.id === selectedTemplate?.building_block_id,
      )
    : undefined;
  const needsContent = !original && !selectedTemplateId;
  const linkedJobs = original?.jobs ?? [];
  const linked = linkedJobs.length > 0;
  const linkedJob = linkedJobs.length === 1 ? linkedJobs[0] : undefined;
  const lifecycle = useQuery({
    ...lifecycleQuery(actor, linkedJob?.id ?? ""),
    enabled: Boolean(linkedJob) && online,
  });
  const candidates = useQuery({
    ...changeCandidatesQuery(actor),
    enabled: linked && online,
  });
  const linkedDetails =
    lifecycle.isSuccess && online ? lifecycle.data : undefined;
  const canEditCourseDetails =
    !linked || linkedDetails?.can_edit_course_details === true;
  const canEditCompany =
    !linked || linkedDetails?.can_reassign_company === true;
  const canEditSchedule = !linked || linkedDetails?.can_edit_schedule === true;
  const scheduleCandidates =
    candidates.isSuccess && online
      ? candidates.data.filter(
          (candidate) =>
            candidate.schedule_editable &&
            linkedJobs.some((job) => job.id === candidate.current.job_id),
        )
      : [];
  const reviewedJobVersion = useRef<number>(undefined);
  useEffect(() => {
    if (reviewedJobVersion.current === undefined && linkedDetails) {
      reviewedJobVersion.current = linkedDetails.version;
    }
  }, [linkedDetails]);
  const linkedRequest = useRef<{ payloadKey: string; id: string }>(undefined);

  const hasActiveJob = linkedJobs.some(
    ({ status }) => status === "published" || status === "filled",
  );
  const withdrawableJobId =
    linkedJob?.status === "published" &&
    linkedDetails?.can_manage &&
    linkedDetails.confirmed_count === 0 &&
    linkedDetails.claims.length === 0
      ? linkedJob.id
      : undefined;
  const publicationJobs = linkedJobs.filter(
    ({ id, status }) => status === "draft" || id === withdrawableJobId,
  );
  function changeZone(next: string) {
    if (!validZone(next) || next === zone) return;
    const previous = sessionOrigins.current;
    const rebased = [];
    for (const row of getValues("sessions")) {
      const source = previous.sessions.get(row.source_session_id ?? "");
      const starts_at = row.starts_at
        ? zonedInstantForScheduleEdit(
            row.starts_at,
            zone,
            source?.starts_at,
            previous.zone,
          )
        : "";
      const ends_at = row.ends_at
        ? zonedInstantForScheduleEdit(
            row.ends_at,
            zone,
            source?.ends_at,
            previous.zone,
          )
        : "";
      if (starts_at === null || ends_at === null) {
        setTimeError(true);
        return;
      }
      rebased.push({
        id: row.source_session_id ?? crypto.randomUUID(),
        starts_at,
        ends_at,
      });
    }
    sessionOrigins.current = {
      zone: next,
      sessions: new Map(
        rebased.map(({ id, starts_at, ends_at }) => [
          id,
          { starts_at, ends_at },
        ]),
      ),
    };
    for (const [index, row] of rebased.entries()) {
      setValue(`sessions.${index}.source_session_id`, row.id);
      for (const endpoint of ["starts_at", "ends_at"] as const) {
        setValue(
          `sessions.${index}.${endpoint}`,
          row[endpoint]
            ? DateTime.fromISO(row[endpoint], { zone: next }).toFormat(
                "yyyy-MM-dd'T'HH:mm",
              )
            : "",
        );
      }
    }
    setValue("time_zone", next, { shouldDirty: true, shouldValidate: true });
    setTimeError(false);
  }

  const save = useMutation({
    onMutate: () => onBusy(true),
    mutationFn: async (
      intent:
        | { kind: "template"; content: TemplateValues; owner?: string }
        | {
            kind: "run";
            values: z.infer<typeof newCourseSchema>;
            content?: TemplateValues;
            offer?: boolean;
          },
    ) => {
      requireOnline();
      setTimeError(false);
      if (intent.kind === "template") {
        await saveCourseTemplate(
          intent.content,
          createdTemplate.current?.id ?? null,
          intent.owner,
        );
        return { kind: "template" } as const;
      }
      const { values } = intent;
      const sessions = resolveCourseSessions(
        values.sessions,
        values.time_zone,
        sessionOrigins.current,
      );
      if (!sessions) {
        setTimeError(true);
        throw new Error("time");
      }
      if (creator) {
        const {
          template_id,
          organisation_id,
          time_zone,
          delivery_type,
          teaching_language,
          venue,
        } = values;
        const fields = intent.content;
        const receipt = await draftSaver.write(
          { run: getValues(), content: content.getValues() },
          {
            run: {
              template_id,
              organisation_id,
              time_zone,
              delivery_type,
              teaching_language,
              venue,
              sessions,
            },
            content: fields
              ? {
                  title: fields.title,
                  description: fields.description,
                  syllabus: fields.syllabus,
                  prerequisites: fields.prerequisites,
                  topic_ids: fields.topic_ids,
                }
              : null,
            next_action: intent.offer ? "offer" : "course",
          },
        );
        if (!receipt?.course_run_id) throw new Error("missing course receipt");
        return {
          kind: "run",
          offerRun:
            receipt.next_action === "offer" ? receipt.course_run_id : undefined,
          savedRun: receipt.course_run_id,
        } as const;
      }
      let templateId = values.template_id;
      if (!templateId && intent.content) {
        const value = JSON.stringify([intent.content, values.organisation_id]);
        const previous = createdTemplate.current;
        if (!previous || previous.value !== value) {
          const id = await saveCourseTemplate(
            intent.content,
            previous?.owner === values.organisation_id ? previous.id : null,
            values.organisation_id,
          );
          if (!id) throw new Error("missing course template");
          createdTemplate.current = {
            id,
            value,
            owner: values.organisation_id,
          };
          setTemplateRetained(true);
        }
        templateId = createdTemplate.current!.id;
      }
      const { teaching_language, ...runValues } = values;
      const payload = {
        ...runValues,
        ...(teaching_language !== undefined &&
        teaching_language !== (original?.teaching_language ?? "")
          ? { teaching_language }
          : {}),
        template_id: templateId,
        sessions,
        published: original?.published ?? false,
      };
      let offerChange:
        { expected_job_version: number; job_request_id: string } | undefined;
      if (linked && original) {
        const ordered = [...sessions].sort(
          (a, b) => compareScheduleInstants(a.starts_at, b.starts_at) ?? 0,
        );
        const originalSessions = [...original.course_sessions].sort(
          (a, b) => compareScheduleInstants(a.starts_at, b.starts_at) ?? 0,
        );
        const scheduleChanged =
          ordered.length !== originalSessions.length ||
          ordered.some(
            (row, index) =>
              compareScheduleInstants(
                row.starts_at,
                originalSessions[index].starts_at,
              ) !== 0 ||
              compareScheduleInstants(
                row.ends_at,
                originalSessions[index].ends_at,
              ) !== 0,
          );
        const detailsChanged =
          templateId !== original.template_id ||
          values.delivery_type !== original.delivery_type ||
          values.time_zone !== original.time_zone;
        const companyChanged =
          (values.organisation_id || null) !== original.organisation_id;
        if (detailsChanged || companyChanged || scheduleChanged) {
          const version = reviewedJobVersion.current;
          if (
            version === undefined ||
            !linkedDetails ||
            (detailsChanged && !canEditCourseDetails) ||
            (companyChanged && !canEditCompany) ||
            (scheduleChanged && !canEditSchedule)
          ) {
            throw new Error("course_locked");
          }
          const payloadKey = JSON.stringify(payload);
          if (linkedRequest.current?.payloadKey !== payloadKey)
            linkedRequest.current = { payloadKey, id: crypto.randomUUID() };
          offerChange = {
            expected_job_version: version,
            job_request_id: linkedRequest.current.id,
          };
        }
      }
      const { data, error } = await db().rpc("save_course_run", {
        p_id: original?.id ?? null,
        p_payload: { ...payload, ...offerChange },
      });
      if (error) throw error;
      return {
        kind: "run",
        offerRun: intent.offer && typeof data === "string" ? data : undefined,
        savedRun: typeof data === "string" ? data : undefined,
      } as const;
    },
    onSuccess: (result) => {
      onDone(
        result.kind,
        result.kind === "run" ? result.offerRun : undefined,
        result.kind === "run" ? result.savedRun : undefined,
      );
      if (linked) void refreshJobState(client);
      else void client.invalidateQueries({ queryKey: ["operations"] });
    },
    onError: async () => {
      if (createdTemplate.current)
        await client.invalidateQueries({ queryKey: ["operations"] });
    },
    onSettled: () => onBusy(false),
  });

  const submitRun = (offer = false) =>
    handleSubmit(async (values) => {
      if (save.isPending || (offer && !activeOrganisation)) return;
      const draft = !values.template_id
        ? await content.trigger(undefined, { shouldFocus: true })
        : true;
      if (!draft) return;
      const fields = !values.template_id
        ? templateSchema.parse(content.getValues())
        : undefined;
      save.mutate({
        kind: "run",
        values,
        content: fields,
        offer,
      });
    });
  return (
    <form className="course-run-editor" noValidate onSubmit={submitRun()}>
      {linked && (
        <Notice>
          <p>
            {t(canEditSchedule ? "linkedRunEditableHelp" : "linkedRunHelp")}
          </p>
          <ul className="course-linked-actions">
            {linkedJobs.map((job) => (
              <li key={job.id}>
                <Link className="text-link" to={`/jobs/${job.id}`}>
                  {t("openLinkedJob", { title: job.title })}
                </Link>
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {creator && <h3>{creatorText("information")}</h3>}
      {canEditCourseDetails && !linked && (
        <Field id="run-teaching-language" label={t("teachingLanguage")}>
          <select id="run-teaching-language" {...register("teaching_language")}>
            <option value="">{t("teachingLanguageUnset")}</option>
            <option value="de">{t("teachingLanguageGerman")}</option>
            <option value="en">{t("teachingLanguageEnglish")}</option>
          </select>
        </Field>
      )}
      <div className="course-run-source-fields">
        {(!canEditCourseDetails || !canEditCompany) && (
          <dl className="course-run-retained-details">
            {!canEditCourseDetails && (
              <>
                <div>
                  <dt>{t("template")}</dt>
                  <dd>
                    {selectedTemplate?.title ?? t("courseRecordUnavailable")}
                  </dd>
                </div>
                <div>
                  <dt>{t("timezone")}</dt>
                  <dd>{zone}</dd>
                </div>
                <div>
                  <dt>{t("delivery")}</dt>
                  <dd>{t(original!.delivery_type)}</dd>
                </div>
              </>
            )}
            {!canEditCompany && (
              <div>
                <dt>{t("organisation")}</dt>
                <dd>
                  {currentOrganisation?.name ??
                    t(
                      original?.organisation_id
                        ? "courseRecordUnavailable"
                        : "none",
                    )}
                </dd>
              </div>
            )}
          </dl>
        )}
        {canEditCourseDetails && (
          <Field
            id="run-template"
            label={t("template")}
            error={Boolean(errors.template_id)}
          >
            <select
              id="run-template"
              {...register("template_id", {
                onChange: (event) => {
                  // Company planning is already bound to the selected company.
                  if (companyOnly) return;
                  const owner = templates.find(
                    ({ id }) => id === event.target.value,
                  )?.owner_organisation_id;
                  if (owner) setValue("organisation_id", owner);
                },
              })}
            >
              {!original && !companyOnly && (
                <option value="">{t("newCourseContent")}</option>
              )}
              {original &&
                !templates.some(
                  (template) => template.id === original.template_id,
                ) && (
                  <option value={original.template_id}>
                    {t("courseRecordUnavailable")}
                  </option>
                )}
              {templates
                .filter(
                  (template) =>
                    !template.archived_at ||
                    template.id === original?.template_id,
                )
                .map((template) => (
                  <option value={template.id} key={template.id}>
                    {template.title}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {canEditCompany && (
          <Field
            id="run-org"
            label={t("organisation")}
            hint={
              focusTarget === "organisation"
                ? t("offerOrganisationRequired")
                : undefined
            }
          >
            <select id="run-org" {...register("organisation_id")}>
              {!selectedTemplate?.owner_organisation_id &&
                (!linked || !original?.organisation_id) && (
                  <option value="" disabled={linked}>
                    {t("none")}
                  </option>
                )}
              {original?.organisation_id && !currentOrganisation && (
                <option value={original.organisation_id}>
                  {t("courseRecordUnavailable")}
                </option>
              )}
              {organisations
                .filter(
                  (org) =>
                    (!selectedTemplate?.owner_organisation_id ||
                      org.id === selectedTemplate.owner_organisation_id) &&
                    (!org.archived_at || org.id === original?.organisation_id),
                )
                .map((org) => (
                  <option
                    value={org.id}
                    key={org.id}
                    disabled={Boolean(org.archived_at)}
                  >
                    {org.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {needsContent &&
          (topics.isPending ? (
            <Loading />
          ) : topics.isError ? (
            <ErrorState retry={() => void topics.refetch()} />
          ) : (
            <CourseContentFields
              register={content.register}
              errors={content.formState.errors}
              topics={topics.data}
              selectedTopicIds={topicIds}
            />
          ))}
        {canReadBlockPlanning &&
          selectedTemplate?.building_block_id &&
          blockPlanning.isError && (
            <ErrorState retry={() => void blockPlanning.refetch()} />
          )}
        {canEditCourseDetails && (
          <div className="form-row">
            <Field
              id="run-zone"
              label={t("timezone")}
              hint={t("courseZoneHelp")}
              error={Boolean(errors.time_zone)}
            >
              <select
                id="run-zone"
                {...register("time_zone")}
                value={zone}
                onChange={(event) => changeZone(event.target.value)}
              >
                <TimeZoneOptions current={original?.time_zone ?? zone} />
              </select>
            </Field>
            <Field id="run-delivery" label={t("delivery")}>
              <select id="run-delivery" {...register("delivery_type")}>
                <option value="online">{t("online")}</option>
                <option value="onsite">{t("onsite")}</option>
              </select>
            </Field>
          </div>
        )}
      </div>
      {creator && <h3>{creatorText("schedule")}</h3>}
      <Field id="run-venue" label={t("venue")} error={Boolean(errors.venue)}>
        <input id="run-venue" {...register("venue")} />
      </Field>
      <fieldset className="operations-topic-field" ref={schedule} tabIndex={-1}>
        <legend>{t("sessions")}</legend>
        {canEditSchedule ? (
          <>
            <CourseSchedulePlanner
              zone={zone}
              suggestedDays={selectedBlock?.duration_days}
              editedSessionCount={editedSessionCount}
              disabled={!online || save.isPending}
              onApply={replace}
            />
            {editedSessionCount > 1 && (
              <CourseSessionBulkEdit
                entries={fields.flatMap(({ id }, index) =>
                  editedSessions[index]
                    ? [{ id, row: editedSessions[index] }]
                    : [],
                )}
                zone={zone}
                disabled={!online || save.isPending}
                onApply={(changes) => {
                  const byId = new Map(
                    changes.map((entry) => [entry.id, entry.row]),
                  );
                  const rows = fields.flatMap(({ id }, index) => {
                    const row = editedSessions[index];
                    if (!row || (!row.starts_at && !row.ends_at)) return [];
                    return [{ ...row, ...byId.get(id) }];
                  });
                  if (
                    !resolveCourseSessions(rows, zone, sessionOrigins.current)
                  )
                    return false;
                  fields.forEach(({ id }, index) => {
                    const adjusted = byId.get(id);
                    if (!adjusted) return;
                    setValue(
                      `sessions.${index}.starts_at`,
                      adjusted.starts_at,
                      { shouldDirty: true, shouldValidate: true },
                    );
                    setValue(`sessions.${index}.ends_at`, adjusted.ends_at, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  });
                  return true;
                }}
              />
            )}
            <SessionScroll label={t("sessions")}>
              {fields.map((field, index) => (
                <div className="session-form-row" key={field.id}>
                  <Field
                    id={`run-start-${index}`}
                    label={`${t("start")} ${index + 1}`}
                    error={Boolean(errors.sessions?.[index]?.starts_at)}
                  >
                    <input
                      id={`run-start-${index}`}
                      type="datetime-local"
                      {...register(`sessions.${index}.starts_at`)}
                    />
                  </Field>
                  <Field
                    id={`run-end-${index}`}
                    label={`${t("end")} ${index + 1}`}
                    error={Boolean(errors.sessions?.[index]?.ends_at)}
                  >
                    <input
                      id={`run-end-${index}`}
                      type="datetime-local"
                      {...register(`sessions.${index}.ends_at`)}
                    />
                  </Field>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`${t("remove")} ${index + 1}`}
                    disabled={fields.length < 2}
                    onClick={() => remove(index)}
                  >
                    <Trash2 size={18} />
                  </Button>
                </div>
              ))}
            </SessionScroll>
            {original && fields.length === 1 && (
              <p className="muted">{t("deleteLastRunSession")}</p>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={fields.length >= 60}
              onClick={() => append({ starts_at: "", ends_at: "" })}
            >
              {t("addSession")}
            </Button>
            {lastSession && (
              <CourseSessionRecurrence
                anchor={lastSession}
                zone={zone}
                sessionCount={fields.length}
                disabled={!online || save.isPending}
                onAppend={(entries) =>
                  append(entries, {
                    focusName: `sessions.${fields.length}.starts_at`,
                  })
                }
              />
            )}
          </>
        ) : (
          <>
            <ol className="course-run-retained-sessions">
              {[...(original?.course_sessions ?? [])]
                .sort(
                  (a, b) =>
                    compareScheduleInstants(a.starts_at, b.starts_at) ?? 0,
                )
                .map((slot) => (
                  <li key={slot.id}>
                    <time dateTime={slot.starts_at}>
                      {dateTime(slot.starts_at, i18n.language, zone)}
                    </time>
                    {" – "}
                    <time dateTime={slot.ends_at}>
                      {dateTime(slot.ends_at, i18n.language, zone)}
                    </time>
                  </li>
                ))}
            </ol>
            {scheduleCandidates.length > 0 && (
              <div className="form-actions">
                {scheduleCandidates.map((candidate) => (
                  <Button asChild variant="secondary" key={candidate.claim_id}>
                    <Link to={`/changes?claim=${candidate.claim_id}&new=1`}>
                      {scheduleCandidates.length === 1
                        ? t("proposeLinkedSchedule")
                        : t("proposeLinkedScheduleFor", {
                            name: candidate.lecturer_name,
                          })}
                    </Link>
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
      </fieldset>
      {original && (
        <fieldset className="course-run-archive">
          <legend>{t("courseArchive")}</legend>
          <label className="checkbox-label">
            <input
              type="checkbox"
              disabled={hasActiveJob}
              {...register("archived")}
            />
            {t("archive")}
          </label>
        </fieldset>
      )}
      {creator && (
        <>
          <h3>{creatorText("review")}</h3>
          {canPrepareOffer && (
            <p className="muted">{creatorText("offerHint")}</p>
          )}
          <Suspense fallback={<Loading />}>
            <CourseCreatorDraftSaveBar
              snapshot={{
                run: {
                  ...getValues(),
                  ...creatorRunValues,
                  sessions: getValues("sessions"),
                },
                content: { ...content.getValues(), ...creatorContentValues },
              }}
              saver={draftSaver}
              busy={save.isPending}
              onReload={() => reloadCreator?.()}
            />
          </Suspense>
        </>
      )}
      <div className="form-actions">
        {needsContent && !creator && (
          <Button
            type="button"
            variant="secondary"
            disabled={!online || save.isPending || !topics.isSuccess}
            onClick={content.handleSubmit((values) =>
              save.mutate({
                kind: "template",
                content: values,
                owner: selectedOrganisationId,
              }),
            )}
          >
            {t("saveAsTemplate")}
          </Button>
        )}
        <Button
          type="submit"
          variant={
            original && focusTarget !== "organisation" ? "default" : "secondary"
          }
          disabled={
            !online ||
            save.isPending ||
            draftSaver.status === "conflict" ||
            (needsContent && !topics.isSuccess)
          }
        >
          {t(original ? "save" : "saveRunDraft")}
        </Button>
        {!original?.archived_at &&
          !draftOnly &&
          !linkedJobs.some(({ status }) =>
            ["draft", "published", "filled"].includes(status),
          ) &&
          canPrepareOffer &&
          (activeOrganisation || focusTarget === "organisation") && (
            <Button
              type="button"
              disabled={
                !online ||
                !activeOrganisation ||
                save.isPending ||
                draftSaver.status === "conflict" ||
                (needsContent && !topics.isSuccess)
              }
              onClick={submitRun(true)}
            >
              {t("saveAndPrepareOffer")}
            </Button>
          )}
      </div>
      {original &&
        !original.archived_at &&
        canPrepareOffer &&
        publicationJobs.length > 0 && (
          <section
            className="course-marketplace-state"
            aria-label={t("marketplaceStatus")}
          >
            <strong>{t("marketplaceStatus")}</strong>
            <p className="muted">
              {t(isDirty ? "saveBeforeOfferPublication" : "publishedHint")}
            </p>
            {publicationJobs.map((job) => (
              <div key={job.id} className="operations-actions">
                <Link to={`/jobs/${job.id}`}>{job.title}</Link>
                <OfferPublicationAction
                  disabled={isDirty || save.isPending}
                  jobId={job.id}
                  action={job.status === "draft" ? "published" : "draft"}
                  onChanged={() => onDone("run", undefined, original.id)}
                />
              </div>
            ))}
          </section>
        )}
      {save.isError && needsContent && templateRetained && (
        <Notice>{t("courseTemplateRetained")}</Notice>
      )}
      {(save.isError || timeError) && (
        <Notice kind="error">
          {t(
            timeError
              ? "timeInvalid"
              : save.error?.message === "course_locked" ||
                  (save.error &&
                    "code" in save.error &&
                    save.error.code === "40001")
                ? "linkedRunConflict"
                : "error",
          )}
        </Notice>
      )}
    </form>
  );
}

function courseOfferState(run: CourseRun, now: number) {
  const liveOffers =
    run.jobs?.filter(
      ({ status, claim_deadline, first_session }) =>
        status === "published" &&
        (!claim_deadline || Date.parse(claim_deadline) > now) &&
        (!first_session || Date.parse(first_session[0]?.starts_at ?? "") > now),
    ) ?? [];
  const jobs = run.jobs ?? [];
  const closedReason = jobs.some(({ status }) => status === "filled")
    ? "marketplaceAssigned"
    : jobs.some(
          ({ status, claim_deadline }) =>
            status === "published" &&
            claim_deadline &&
            Date.parse(claim_deadline) <= now,
        )
      ? "marketplaceExpired"
      : jobs.some(
            ({ status, first_session }) =>
              status === "published" &&
              Date.parse(first_session?.[0]?.starts_at ?? "") <= now,
          )
        ? "marketplaceStarted"
        : jobs.some(({ status }) => status === "draft")
          ? "marketplaceDraft"
          : jobs.length
            ? "marketplaceClosed"
            : "marketplaceMissing";
  return { liveOffers, closedReason };
}

/** Classify the course separately from the availability of individual offers. */
function courseRunStatus(run: CourseRun) {
  if (run.archived_at) return "archived";
  if (
    run.published ||
    run.jobs?.some(
      (job) =>
        job.status === "published" ||
        job.status === "filled" ||
        job.job_claims?.some(({ status }) => status === "confirmed"),
    )
  )
    return "published";
  return "planning";
}

function CourseActionDisclosure({ children }: { children: ReactNode }) {
  const { t } = useTranslation("operations");
  return (
    <details className="course-card-more">
      <summary className="button button-ghost">
        {t("courseMoreActions")} <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="operations-actions course-secondary-actions">
        {children}
      </div>
    </details>
  );
}

/** Combine templates/runs with explicitly requested publication/copy actions. */
export function CoursesPage() {
  const { t, i18n } = useTranslation(["operations", "courseSeries"]);
  const { session } = useAuth();
  const actor = session!.user.id;
  const permissions = useQuery(permissionsQuery(actor));
  const manage = permissions.data?.includes("courses.manage") ?? false;
  const canPrepareOffer =
    manage && (permissions.data?.includes("jobs.manage") ?? false);
  const roles = useQuery(userRolesQuery(actor));
  const companyViewer = !manage && roles.data?.includes("client");
  const ownCompanies = useQuery({
    ...clientOrganisationsQuery(actor),
    enabled: Boolean(companyViewer),
  });
  const orgs = useQuery(orgQuery(actor));
  const topics = useQuery(topicsQuery);
  const client = useQueryClient();
  const online = useOnline();
  const [search, setSearch] = useState("");
  const needle = useDeferredValue(search).toLowerCase();
  const [phase, setPhase] = useState<CoursePhaseSelection>("all");
  const [runStatus, setRunStatus] = useState("all");
  const [lecturer, setLecturer] = useState("");
  const [initialTemplateId, setInitialTemplateId] = useState<string>();
  const [templateEdit, setTemplateEdit] = useState<Template | null>();
  const [seriesTemplate, setSeriesTemplate] = useState<Template | null>();
  const [seriesBusy, setSeriesBusy] = useState(false);
  const [runEdit, setRunEdit] = useState<CourseRun | null | undefined>();
  const [runSaving, setRunSaving] = useState(false);
  const [focusTarget, setFocusTarget] = useState<"schedule" | "organisation">();
  const [params, setParams] = useSearchParams();
  const creatorText = useTranslation("courseCreator").t;
  const creatorRoute = params.get("creator");
  const requestedCreatorId = courseCreatorDraftId.safeParse(creatorRoute).data;
  const creatorId = manage ? requestedCreatorId : undefined;
  const creatorRead = useQuery({
    ...courseCreatorDraftsQuery(actor, creatorId),
    enabled: Boolean(creatorId) && online,
    retry: false,
  });
  const creatorRecord = creatorRead.data?.[0];
  const creatorFresh = params.get("startCreator") === "1";
  const creatorTemplateParam = params.get("creatorTemplate");
  const [creatorEpoch, setCreatorEpoch] = useState(0);
  useEffect(() => {
    if (manage && creatorRoute === "new") {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("creator", crypto.randomUUID());
          next.set("startCreator", "1");
          return next;
        },
        { replace: true },
      );
    }
  }, [creatorRoute, manage, setParams]);
  const calendarPlan =
    manage && runEdit === undefined
      ? calendarCourseSchedule(
          params.get("planFrom"),
          params.get("planUntil"),
          params.get("planZone"),
        )
      : undefined;
  const company = `${params.get("company") ?? ""}`;
  const companyOrganisations = companyViewer ? (ownCompanies.data ?? []) : [];
  // Only infer a company when there is exactly one active membership and no explicit request.
  const templateCompany = company
    ? companyOrganisations.find(({ id }) => id === company)
    : companyOrganisations.length === 1
      ? companyOrganisations[0]
      : undefined;
  const templateCompanyId = `${templateCompany?.id ?? ""}`;
  const setCourseView = (view: Record<string, string>, replace = false) =>
    setParams(
      (manage || companyViewer) && company ? { ...view, company } : view,
      { replace },
    );
  const selectedRunStatus =
    manage && (runStatus !== "assigned" || canPrepareOffer) ? runStatus : "all";
  const onlyAssignedRuns = canPrepareOffer && selectedRunStatus === "assigned";
  const tab =
    (manage || companyViewer) && params.get("tab") === "templates"
      ? "templates"
      : "runs";
  const companyLibrary = useQuery({
    ...templatesQuery(actor, templateCompanyId),
    enabled: Boolean(templateCompanyId),
  });
  // The run overview still needs authorized run titles across memberships, but
  // it is not a source of company library options or of scoped detail records.
  const useRunMetadata = !companyViewer || tab === "runs" || params.has("run");
  const templates = useQuery({
    ...templatesQuery(actor),
    enabled: permissions.isSuccess && roles.isSuccess && useRunMetadata,
  });
  const needsRuns =
    tab === "runs" || params.has("run") || params.has("template");
  const runs = useQuery({
    ...runsQuery(actor, canPrepareOffer),
    // Choose the projection once permissions resolve. Otherwise staff first
    // download the basic catalogue and then request it again with assignments.
    enabled: permissions.isSuccess && needsRuns,
    refetchInterval: manage ? false : 10000,
    refetchOnMount: manage ? true : "always",
  });
  const blockPlanning = useQuery({
    ...buildingBlockPlanningQuery(actor),
    enabled: manage && tab === "templates",
  });
  const batchSize = 24;
  const listKey = JSON.stringify(
    tab === "runs"
      ? [actor, tab, needle, company, phase, selectedRunStatus, lecturer]
      : [actor, tab, needle, templateCompanyId],
  );
  const [visibleList, setVisibleList] = useState({
    key: listKey,
    count: batchSize,
  });
  if (visibleList.key !== listKey)
    setVisibleList({ key: listKey, count: batchSize });
  const setTab = (next: "runs" | "templates") => {
    setCourseView(next === "templates" ? { tab: next } : {});
  };
  const canCreateTemplate = manage || Boolean(templateCompany);
  const templatesById = useMemo(
    () => new Map(templates.data?.map((item) => [item.id, item])),
    [templates.data],
  );
  const organisationsById = useMemo(
    () => new Map(orgs.data?.map((item) => [item.id, item])),
    [orgs.data],
  );
  const companyOrganisationsById = useMemo(
    () => new Map(ownCompanies.data?.map((item) => [item.id, item])),
    [ownCompanies.data],
  );
  const topicsById = useMemo(
    () => new Map(topics.data?.map((item) => [item.id, item])),
    [topics.data],
  );
  const assignmentsByRun = useMemo(
    () =>
      new Map(
        runs.data?.map((run) => [
          run.id,
          (run.jobs ?? []).flatMap((job) => {
            const claims = job.job_claims?.filter(
              ({ status }) => status === "confirmed",
            );
            return claims?.length
              ? [
                  {
                    id: job.id,
                    title: job.title,
                    count: claims.length,
                    capacity: job.capacity ?? claims.length,
                    lecturers: claims.flatMap(({ lecturer_id, profiles }) =>
                      profiles?.display_name
                        ? [{ id: lecturer_id, name: profiles.display_name }]
                        : [],
                    ),
                  },
                ]
              : [];
          }),
        ]),
      ),
    [runs.data],
  );
  const lecturerOptions = useMemo(
    () =>
      Array.from(
        new Map(
          Array.from(assignmentsByRun.values()).flatMap((assignments) =>
            assignments.flatMap(({ lecturers }) =>
              lecturers.flatMap(({ id, name }) =>
                id ? [[id, name] as const] : [],
              ),
            ),
          ),
        ),
      ).sort((a, b) => a[1].localeCompare(b[1], i18n.language)),
    [assignmentsByRun, i18n.language],
  );
  const organisationName = useCallback(
    (id: string | null | undefined) =>
      id
        ? (organisationsById.get(id)?.name ??
          (companyViewer ? companyOrganisationsById.get(id)?.name : undefined))
        : undefined,
    [organisationsById, companyViewer, companyOrganisationsById],
  );
  const canManageTemplate = useCallback(
    (template: Template) =>
      manage ||
      Boolean(
        templateCompanyId &&
        template.owner_organisation_id === templateCompanyId,
      ),
    [manage, templateCompanyId],
  );
  const canEditTemplate = (template: Template) =>
    manage ||
    (canManageTemplate(template) &&
      !template.building_block_id &&
      !template.building_block_source_id);
  const navigate = useNavigate();
  const startCreator = () =>
    setCourseView({ creator: crypto.randomUUID(), startCreator: "1" });
  const openCreator = (id: string) => setCourseView({ creator: id });
  const continueCreator = (draft: CourseCreatorDraft) => {
    if (!draft.course_run_id) return;
    setCourseView(
      draft.next_action === "offer" && canPrepareOffer
        ? { offer: draft.course_run_id }
        : { run: draft.course_run_id },
    );
  };
  const detail = runs.data?.find((run) => run.id === params.get("run"));
  const offerRunId = canPrepareOffer ? params.get("offer") : null;
  const workspaceEntitlement = useQuery({
    ...courseWorkspaceEntitlementQuery(actor, detail?.id ?? ""),
    enabled: Boolean(detail && !detail.archived_at),
  });
  const templateId = params.get("template");
  const libraryDetail = companyLibrary.data?.find(
    (template) => template.id === templateId && canManageTemplate(template),
  );
  const runTemplateDetail = templatesById.get(templateId ?? "");
  const templateDetail = companyViewer
    ? (libraryDetail ??
      (!company && tab === "runs" && !runTemplateDetail?.owner_organisation_id
        ? runTemplateDetail
        : undefined))
    : runTemplateDetail;
  const editRun = (
    run: CourseRun | null,
    target?: "schedule" | "organisation",
  ) => {
    setFocusTarget(target);
    setRunEdit(run);
  };
  const reviewSchedule = (run: CourseRun) => {
    setCourseView({}, true);
    editRun(run, "schedule");
  };
  const planRun = (templateId: string) => {
    if (manage) {
      // Keep the source in the URL until the first acknowledged save. Reload
      // reapplies the authorised template; recovery uses the saved snapshot.
      setCourseView({
        tab: "templates",
        creator: crypto.randomUUID(),
        startCreator: "1",
        creatorTemplate: templateId,
      });
      return;
    }
    setInitialTemplateId(templateId);
    setTab(tab);
    editRun(null);
  };
  const [copy, setCopy] = useState<
    | { type: "template"; id: string; title: string }
    | { type: "run"; id: string; title: string; run: CourseRun }
  >();
  const [copyTitle, setCopyTitle] = useState("");
  const [message, setMessage] = useState("");
  const [savedRun, setSavedRun] = useState<string>();
  const archiveRun = useMutation({
    mutationFn: async ({
      run,
      archived,
    }: {
      run: CourseRun;
      archived: boolean;
    }) => {
      requireOnline();
      const { error } = await db().rpc("set_course_visibility", {
        p_id: run.id,
        p_published: run.published,
        p_archived: archived,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["operations"] });
      setMessage(t("archiveSaved"));
    },
  });
  const duplicate = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!copy || copy.type !== "template") throw new Error("missing");
      const { error } = await db().rpc("duplicate_course_template", {
        p_id: copy.id,
        p_title: copyTitle.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["operations"] });
      setCopy(undefined);
      setMessage(t("copied"));
    },
  });
  const indexedRuns = useMemo(
    () =>
      (runs.data ?? []).map((run) => ({
        run,
        status: courseRunStatus(run),
        phase: scheduledCoursePhase(run.course_sessions, runs.dataUpdatedAt),
      })),
    [runs.data, runs.dataUpdatedAt],
  );
  const searchingRuns = tab === "runs" && Boolean(needle);
  const runSearchText = useMemo(() => {
    if (!searchingRuns) return null;
    return new Map(
      (runs.data ?? []).map((run) => {
        const template = templatesById.get(run.template_id);
        const lecturers = canPrepareOffer
          ? (assignmentsByRun
              .get(run.id)
              ?.flatMap((assignment) =>
                assignment.lecturers.map(({ name }) => name),
              ) ?? [])
          : [];
        return [
          run.id,
          [
            template?.title,
            template?.description,
            organisationName(run.organisation_id),
            run.venue,
            ...lecturers,
          ]
            .join(" ")
            .toLowerCase(),
        ];
      }),
    );
  }, [
    searchingRuns,
    runs.data,
    templatesById,
    organisationName,
    canPrepareOffer,
    assignmentsByRun,
  ]);
  const { filteredRuns, draftCount } = useMemo(() => {
    if (tab !== "runs") return { filteredRuns: [], draftCount: 0 };
    let draftCount = 0;
    const groups: (typeof indexedRuns)[] = [[], [], [], []];
    for (const entry of indexedRuns) {
      const { run, status } = entry;
      const assignments = assignmentsByRun.get(run.id) ?? [];
      if (
        (!manage && run.archived_at) ||
        (manage && company && run.organisation_id !== company) ||
        (onlyAssignedRuns && !assignments.length) ||
        (canPrepareOffer &&
          lecturer &&
          !assignments.some(({ lecturers }) =>
            lecturers.some(({ id }) => id === lecturer),
          )) ||
        (phase !== "all" && entry.phase !== phase)
      )
        continue;
      if (needle && !runSearchText?.get(run.id)?.includes(needle)) continue;
      if (status === "planning") draftCount++;
      if (
        selectedRunStatus !== "all" &&
        !onlyAssignedRuns &&
        status !== selectedRunStatus
      )
        continue;
      const rank =
        status === "published"
          ? 0
          : status === "archived"
            ? 3
            : entry.phase === "completed"
              ? 2
              : 1;
      groups[rank].push(entry);
    }
    return { filteredRuns: groups.flat(), draftCount };
  }, [
    tab,
    indexedRuns,
    assignmentsByRun,
    manage,
    company,
    onlyAssignedRuns,
    canPrepareOffer,
    lecturer,
    phase,
    needle,
    runSearchText,
    selectedRunStatus,
  ]);
  const visibleTemplates = useMemo(
    () =>
      manage
        ? (templates.data ?? [])
        : (companyLibrary.data ?? []).filter(canManageTemplate),
    [manage, templates.data, companyLibrary.data, canManageTemplate],
  );
  const blockCodes = useMemo(
    () => new Map(blockPlanning.data?.map((block) => [block.id, block.code])),
    [blockPlanning.data],
  );
  const filteredTemplates = useMemo(
    () =>
      tab === "templates" && needle
        ? visibleTemplates.filter((template) =>
            [
              template.title,
              template.description,
              template.syllabus,
              blockCodes.get(template.building_block_id ?? ""),
            ]
              .join(" ")
              .toLowerCase()
              .includes(needle),
          )
        : visibleTemplates,
    [tab, needle, visibleTemplates, blockCodes],
  );
  if (
    (useRunMetadata && templates.isError) ||
    (Boolean(templateCompany) && companyLibrary.isError) ||
    (companyViewer && ownCompanies.isError) ||
    roles.isError ||
    (needsRuns && runs.isError) ||
    orgs.isError ||
    topics.isError ||
    permissions.isError
  )
    return (
      <ErrorState
        retry={() => {
          if (useRunMetadata) void templates.refetch();
          if (templateCompany) void companyLibrary.refetch();
          if (companyViewer) void ownCompanies.refetch();
          void roles.refetch();
          if (needsRuns && permissions.isSuccess) void runs.refetch();
          void orgs.refetch();
          void topics.refetch();
          void permissions.refetch();
        }}
      />
    );
  if (
    (useRunMetadata && templates.isPending) ||
    (Boolean(templateCompany) && companyLibrary.isPending) ||
    (companyViewer && ownCompanies.isPending) ||
    roles.isPending ||
    (needsRuns && runs.isPending) ||
    orgs.isPending ||
    topics.isPending ||
    permissions.isPending
  )
    return <Loading />;
  const findTemplate = (run: CourseRun) => templatesById.get(run.template_id);
  const creatorTemplate =
    manage && creatorId && creatorFresh && !creatorRecord
      ? templates.data?.find(
          (template) =>
            template.id === creatorTemplateParam && !template.archived_at,
        )
      : undefined;
  const creatorSourceUnavailable =
    creatorFresh &&
    creatorTemplateParam !== null &&
    !creatorRecord &&
    !creatorTemplate;
  const planningOrganisations = manage
    ? orgs.data
    : templateCompany
      ? [templateCompany]
      : [];
  // A browser history change can switch scope without using the company picker.
  const mayOpenTemplateEditor =
    canCreateTemplate && (!templateEdit || canEditTemplate(templateEdit));
  const mayOpenSeries =
    canCreateTemplate && (!seriesTemplate || canManageTemplate(seriesTemplate));
  const mayOpenRunEditor =
    manage || visibleTemplates.some(({ id }) => id === initialTemplateId);
  const offerStatus = (
    run: CourseRun,
    { liveOffers, closedReason }: ReturnType<typeof courseOfferState>,
    compact = false,
  ) => {
    const lecturerNames = canPrepareOffer
      ? Array.from(
          new Set(
            assignmentsByRun
              .get(run.id)
              ?.flatMap(({ lecturers }) => lecturers.map(({ name }) => name)),
          ),
        ).join(", ")
      : "";
    const filled = closedReason === "marketplaceAssigned";
    const status =
      filled && lecturerNames
        ? t("marketplaceAssignedWithLecturers", { names: lecturerNames })
        : t(closedReason);
    const staffing =
      !filled && lecturerNames
        ? t("confirmedCourseLecturers", { names: lecturerNames })
        : null;
    if (compact) {
      const summary = [filled || !liveOffers.length ? status : null, staffing]
        .filter(Boolean)
        .join(" · ");
      return summary ? <p className="muted">{summary}</p> : null;
    }
    return (
      <>
        <strong>{t("marketplaceStatus")}</strong>
        {liveOffers.map((job) => (
          <Link key={job.id} to={`/jobs/${job.id}`}>
            {t(
              job.company_internal || run.own_lecturers_only
                ? "openCompanyOffer"
                : "openListedOffer",
              { title: job.title },
            )}
          </Link>
        ))}
        {(filled || !liveOffers.length) && <span>{status}</span>}
        {staffing && <span>{staffing}</span>}
        {run.jobs
          ?.filter(
            ({ id, status }) =>
              status !== "draft" &&
              !liveOffers.some((offer) => offer.id === id),
          )
          .map((job) => (
            <Button key={job.id} asChild variant="secondary">
              <Link to={`/jobs/${job.id}`}>
                {t("viewCourseJob", { title: job.title })}
              </Link>
            </Button>
          ))}
      </>
    );
  };
  const marketplaceAction = (run: CourseRun, compact = false) => {
    if (!manage) return null;
    const draft = run.jobs?.find(({ status }) => status === "draft");
    if (draft)
      return (
        <>
          {!compact && (
            <Link to={`/jobs/${draft.id}`}>
              {t("openMarketplaceDraft", { title: draft.title })}
            </Link>
          )}
          {canPrepareOffer && !run.archived_at && (
            <PublishOfferDraft jobId={draft.id} />
          )}
        </>
      );
    if (run.archived_at) return null;
    if (!canPrepareOffer)
      return compact ? null : (
        <p className="muted">{t("offerPermissionRequired")}</p>
      );
    const company = organisationsById.get(run.organisation_id ?? "");
    if (company && !company.archived_at)
      return (
        <CourseRunOfferLink
          runId={run.id}
          additional={Boolean(run.jobs?.length)}
          compact={compact}
        />
      );
    if (!orgs.data.some((org) => !org.archived_at)) {
      return (
        <>
          <p className="muted">{t("offerNeedsActiveOrganisation")}</p>
          {permissions.data.includes("organisations.manage") && (
            <Button asChild variant="secondary">
              <Link to="/clients">{t("translation:companies")}</Link>
            </Button>
          )}
        </>
      );
    }
    return (
      <Button
        type="button"
        variant={compact ? "ghost" : "secondary"}
        disabled={!online}
        onClick={() => {
          if (detail) setCourseView({}, true);
          editRun(run, "organisation");
        }}
      >
        {t("assignOrganisationForOffer")}
      </Button>
    );
  };
  const total = tab === "runs" ? filteredRuns.length : filteredTemplates.length;
  const shownCount = Math.min(visibleList.count, total);
  const canPlanSeries =
    canCreateTemplate &&
    visibleTemplates.some((template) => !template.archived_at);
  const activeFilters =
    Number(phase !== "all") +
    (manage
      ? Number(Boolean(company)) +
        Number(canPrepareOffer && Boolean(lecturer)) +
        Number(selectedRunStatus !== "all")
      : 0);
  return (
    <>
      <PageHeading
        title={t("courses")}
        action={
          <div className="operations-header-actions">
            {(tab === "templates" ? canCreateTemplate : manage) ? (
              <Button
                disabled={!online}
                onClick={() => {
                  if (tab === "templates") setTemplateEdit(null);
                  else {
                    setInitialTemplateId(undefined);
                    editRun(null);
                  }
                }}
              >
                <Plus size={17} />
                {t(tab === "templates" ? "newTemplate" : "newCourse")}
              </Button>
            ) : (
              <Button asChild variant="secondary">
                <Link to="/learning">{t("translation:myCourses")}</Link>
              </Button>
            )}
            <details className="course-tools">
              <summary className="button button-secondary">
                {t("courseTools")} <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <div className="course-tools-actions">
                {canPlanSeries && (
                  <Button
                    variant="secondary"
                    disabled={!online}
                    onClick={() => setSeriesTemplate(null)}
                  >
                    {t("courseSeries:title")}
                  </Button>
                )}
                <Button asChild variant="secondary">
                  <Link to="/learning?view=materials">
                    {t("learning:materialLibrary")}
                  </Link>
                </Button>
                {manage && tab === "templates" && (
                  <TableImport
                    inDialog
                    label={
                      i18n.language.startsWith("de")
                        ? "Kursvorlagen importieren"
                        : "Import course templates"
                    }
                    filename="course-templates"
                    columns={[
                      "title",
                      "description",
                      "syllabus",
                      "prerequisites",
                    ]}
                    example={[
                      "Excel Grundlagen",
                      "Einführung in Tabellen",
                      "Formatierung und Formeln",
                      "",
                    ]}
                    parse={(row) =>
                      templateSchema.parse({
                        ...row,
                        topic_ids: [],
                        archived: false,
                      })
                    }
                    save={(row, key) =>
                      importTableRow(key, "course-template", row)
                    }
                    refresh={() =>
                      client.invalidateQueries({ queryKey: ["operations"] })
                    }
                  />
                )}
                {manage &&
                  tab === "runs" &&
                  visibleTemplates.some(
                    (template) => !template.archived_at,
                  ) && (
                    <TableImport
                      inDialog
                      label={
                        i18n.language.startsWith("de")
                          ? "Kursentwürfe mit einem Termin importieren"
                          : "Import course drafts with one session"
                      }
                      filename="course-drafts"
                      columns={[
                        "template_title",
                        "company_name",
                        "time_zone",
                        "delivery_type",
                        "venue",
                        "starts_at",
                        "ends_at",
                      ]}
                      example={[
                        "Excel Grundlagen",
                        "",
                        "Europe/Berlin",
                        "online",
                        "",
                        "2027-01-11T09:00",
                        "2027-01-11T12:00",
                      ]}
                      parse={(row) => {
                        const matchingTemplates = visibleTemplates.filter(
                          (item) =>
                            !item.archived_at &&
                            item.title === row.template_title.trim(),
                        );
                        const companyName = row.company_name.trim();
                        const companies = orgs.data.filter(
                          (item) =>
                            !item.archived_at && item.name === companyName,
                        );
                        if (
                          matchingTemplates.length !== 1 ||
                          (companyName && companies.length !== 1)
                        )
                          throw new Error("ambiguous course references");
                        const values = runSchema.parse({
                          template_id: matchingTemplates[0].id,
                          organisation_id: companyName ? companies[0].id : "",
                          time_zone: row.time_zone,
                          delivery_type: row.delivery_type,
                          venue: row.venue,
                          published: false,
                          archived: false,
                          sessions: [
                            { starts_at: row.starts_at, ends_at: row.ends_at },
                          ],
                        });
                        const starts_at = zonedInstantForScheduleEdit(
                          row.starts_at,
                          values.time_zone,
                        );
                        const ends_at = zonedInstantForScheduleEdit(
                          row.ends_at,
                          values.time_zone,
                        );
                        if (
                          !starts_at ||
                          !ends_at ||
                          (compareScheduleInstants(ends_at, starts_at) ?? 0) <=
                            0
                        )
                          throw new Error("invalid course session");
                        return {
                          ...values,
                          sessions: [{ starts_at, ends_at }],
                        };
                      }}
                      save={(row, key) =>
                        importTableRow(key, "course-draft", row)
                      }
                      refresh={() =>
                        client.invalidateQueries({ queryKey: ["operations"] })
                      }
                    />
                  )}
              </div>
            </details>
          </div>
        }
      />
      {manage && tab === "runs" && (
        <Suspense fallback={<Loading />}>
          <CourseCreatorDraftLibrary
            actor={actor}
            onStart={startCreator}
            onOpen={openCreator}
            onContinue={continueCreator}
          />
        </Suspense>
      )}
      <section className="panel course-toolbar" aria-label={t("catalogue")}>
        <div className="course-toolbar-header">
          <div
            className="course-view-switch"
            role="group"
            aria-label={t("catalogue")}
          >
            <Button
              variant={tab === "runs" ? "default" : "secondary"}
              aria-pressed={tab === "runs"}
              onClick={() => setTab("runs")}
            >
              {t("runs")}
            </Button>
            {(manage || companyViewer) && (
              <Button
                variant={tab === "templates" ? "default" : "secondary"}
                aria-pressed={tab === "templates"}
                onClick={() => setTab("templates")}
              >
                {t("templates")}
              </Button>
            )}
          </div>
        </div>
        <div className="course-search-row">
          {companyViewer &&
            tab === "templates" &&
            companyOrganisations.length > 0 && (
              <Field id="template-library-company" label={t("organisation")}>
                <select
                  id="template-library-company"
                  value={templateCompany?.id ?? ""}
                  onChange={(event) => {
                    setTemplateEdit(undefined);
                    setSeriesTemplate(undefined);
                    setRunEdit(undefined);
                    setParams(
                      { tab: "templates", company: event.target.value },
                      { replace: true },
                    );
                  }}
                >
                  <option value="" disabled>
                    {t("none")}
                  </option>
                  {companyOrganisations.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          <Field id="course-search" label={t("search")}>
            <input
              id="course-search"
              type="search"
              placeholder={
                canPrepareOffer && tab === "runs"
                  ? t("searchCoursesAndLecturers")
                  : undefined
              }
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </Field>
        </div>
        {tab === "runs" && (
          <details className="course-filters">
            <summary className="button button-secondary">
              <SlidersHorizontal size={16} aria-hidden="true" />
              {activeFilters
                ? t("courseActiveFilters", { count: activeFilters })
                : t("courseFilters")}
            </summary>
            <div className="course-toolbar-filters">
              <CoursePhaseFilter
                id="catalogue-course-phase"
                value={phase}
                onChange={setPhase}
              />
              {manage && (
                <>
                  <Field
                    id="course-company-filter"
                    label={t("courseCompanyFilter")}
                  >
                    <select
                      id="course-company-filter"
                      value={company}
                      onChange={(event) => {
                        const next = new URLSearchParams(params);
                        if (event.target.value)
                          next.set("company", event.target.value);
                        else next.delete("company");
                        setParams(next, { replace: true });
                      }}
                    >
                      <option value="">{t("allCourseCompanies")}</option>
                      {orgs.data.map(({ id, name }) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {canPrepareOffer && (
                    <Field
                      id="course-lecturer-filter"
                      label={t("courseLecturerFilter")}
                    >
                      <select
                        id="course-lecturer-filter"
                        value={lecturer}
                        onChange={(event) => {
                          setLecturer(event.target.value);
                        }}
                      >
                        <option value="">{t("allCourseLecturers")}</option>
                        {lecturerOptions.map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field
                    id="course-staffing-filter"
                    label={t("courseRunStatusFilter")}
                  >
                    <select
                      id="course-staffing-filter"
                      value={runStatus}
                      onChange={(event) => {
                        setRunStatus(event.target.value);
                      }}
                    >
                      <option value="all">{t("allCourseRunStatuses")}</option>
                      <option value="planning">
                        {t("courseDraftCount", { count: draftCount })}
                      </option>
                      <option value="published">{t("published")}</option>
                      <option value="archived">{t("archive")}</option>
                      {canPrepareOffer && (
                        <option value="assigned">
                          {t("onlyAssignedRuns")}
                        </option>
                      )}
                    </select>
                  </Field>
                </>
              )}
            </div>
          </details>
        )}
      </section>
      {manage && tab === "templates" && blockPlanning.isError && (
        <ErrorState retry={() => void blockPlanning.refetch()} />
      )}
      {message && (
        <Notice>
          {message}
          {savedRun && runs.data?.some(({ id }) => id === savedRun) && (
            <>
              {" "}
              <Link to={`/courses?run=${encodeURIComponent(savedRun)}`}>
                {t("openSavedRun")}
              </Link>
            </>
          )}
        </Notice>
      )}
      {archiveRun.isError && (
        <Notice kind="error">
          {t(archiveRun.error.message === "course_locked" ? "locked" : "error")}
        </Notice>
      )}
      {tab === "runs" && filteredRuns.length === 0 ? (
        <div className="empty-state">
          {t(
            onlyAssignedRuns
              ? "noAssignedRuns"
              : selectedRunStatus !== "all"
                ? "noCoursesWithStatus"
                : phase === "all"
                  ? "learning:noCourses"
                  : "learning:noCoursesInPhase",
          )}
        </div>
      ) : tab === "runs" ? (
        <div className="operations-courses-grid">
          {filteredRuns.slice(0, shownCount).map(({ run, status }) => {
            const template = findTemplate(run);
            const jobs = run.jobs ?? [];
            const offers = courseOfferState(run, runs.dataUpdatedAt);
            const { liveOffers, closedReason } = offers;
            const customer =
              organisationName(run.organisation_id) ?? t("noCustomer");
            return (
              <article className="panel operations-course" key={run.id}>
                <div className="section-heading">
                  <BookOpen className="blue" />
                  <div className="tags course-run-badges">
                    <span className="badge">
                      {t(
                        status === "archived"
                          ? "archive"
                          : status === "published"
                            ? "published"
                            : "draft",
                      )}
                    </span>
                    {manage && (
                      <>
                        <span className="badge">{customer}</span>
                        <span className="badge">
                          {t(
                            `courseCreationOrigin.${run.creation_origin ?? "unknown"}`,
                          )}
                        </span>
                      </>
                    )}
                    {status !== "archived" && liveOffers.length > 0 && (
                      <span className="badge">
                        {t(
                          liveOffers.every(
                            (offer) =>
                              offer.company_internal || run.own_lecturers_only,
                          )
                            ? "listedCompany"
                            : "listedMarketplace",
                        )}
                      </span>
                    )}
                    {!manage &&
                      status === "published" &&
                      closedReason === "marketplaceAssigned" && (
                        <span className="badge">{t("courseRunAssigned")}</span>
                      )}
                    {status !== "archived" &&
                      liveOffers.length === 0 &&
                      (closedReason === "marketplaceExpired" ||
                        closedReason === "marketplaceStarted" ||
                        closedReason === "marketplaceClosed") && (
                        <span className="badge">{t("closedCourseOffer")}</span>
                      )}
                  </div>
                </div>
                <h2>{template?.title ?? t("template")}</h2>
                {manage && offerStatus(run, offers, true)}
                {canPrepareOffer &&
                  assignmentsByRun
                    .get(run.id)
                    ?.filter(
                      ({ count, capacity }) => capacity > 1 || count < capacity,
                    )
                    .map((assignment) => (
                      <p key={assignment.id} className="muted">
                        {assignment.title} ·{" "}
                        {t("assignmentCoverage", assignment)}
                      </p>
                    ))}
                <p className="muted">
                  {!manage && `${customer} · `}
                  {t(run.delivery_type)}
                </p>
                <p>{template?.description}</p>
                <div className="tags">
                  {template?.course_template_topics.map((item) => {
                    const topic = topicsById.get(item.topic_id);
                    return topic ? (
                      <span className="badge" key={topic.id}>
                        {i18n.language.startsWith("de")
                          ? topic.label_de
                          : topic.label_en}
                      </span>
                    ) : null;
                  })}
                </div>
                <p className="operations-session-summary">
                  <CalendarDays size={17} />
                  {run.course_sessions.length} · {run.time_zone}
                </p>
                <div className="course-card-actions">
                  <div className="operations-actions">
                    <Button
                      variant="secondary"
                      onClick={() => setCourseView({ run: run.id })}
                    >
                      {t("viewCourseRun")}
                    </Button>
                    {manage && jobs.length === 1 && (
                      <Button
                        asChild
                        variant="secondary"
                        className="course-run-job-link"
                      >
                        <Link to={`/jobs/${jobs[0].id}`}>
                          {t("viewCourseAssignment")}
                        </Link>
                      </Button>
                    )}
                  </div>
                  {manage && (
                    <CourseActionDisclosure>
                      {jobs.length > 1 &&
                        jobs.map((job) => (
                          <Button
                            key={job.id}
                            asChild
                            variant="secondary"
                            className="course-run-job-link"
                          >
                            <Link to={`/jobs/${job.id}`}>
                              {t("viewCourseJob", { title: job.title })}
                            </Link>
                          </Button>
                        ))}
                      {marketplaceAction(run, true)}
                      <Button
                        variant="ghost"
                        disabled={!online}
                        onClick={() => {
                          duplicate.reset();
                          setCopy({
                            type: "run",
                            id: run.id,
                            title: template?.title ?? "",
                            run,
                          });
                        }}
                      >
                        <Copy size={15} />
                        {t("duplicate")}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!online || archiveRun.isPending}
                        onClick={() =>
                          archiveRun.mutate({
                            run,
                            archived: !run.archived_at,
                          })
                        }
                      >
                        {t(run.archived_at ? "restore" : "archiveAction")}
                      </Button>
                      <PermanentDeleteAction
                        shortLabel
                        kind="course_run"
                        id={run.id}
                        label={template?.title ?? t("courses")}
                        linkedJobs={run.jobs}
                        onReviewSessions={() => reviewSchedule(run)}
                      />
                    </CourseActionDisclosure>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="empty-state">{t("noCourseTemplates")}</div>
      ) : (
        <div className="operations-courses-grid">
          {filteredTemplates.slice(0, shownCount).map((template) => (
            <article className="panel operations-course" key={template.id}>
              <h2>{template.title}</h2>
              {template.building_block_id &&
                blockCodes.has(template.building_block_id) && (
                  <span className="badge">
                    {blockCodes.get(template.building_block_id)}
                  </span>
                )}
              {template.archived_at && (
                <span className="badge">{t("archive")}</span>
              )}
              <p className="muted">
                {organisationName(template.owner_organisation_id) ??
                  (template.owner_organisation_id
                    ? t("templateOwner")
                    : t("internalTemplate"))}
              </p>
              <p>{template.description}</p>
              <div className="operations-actions">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setCourseView({ tab: "templates", template: template.id })
                  }
                >
                  {t("view")}
                </Button>
                {!template.archived_at && (
                  <Button
                    disabled={!online}
                    onClick={() => planRun(template.id)}
                  >
                    {t("createRunFromTemplate")}
                  </Button>
                )}
                {canEditTemplate(template) && (
                  <Button
                    variant="secondary"
                    disabled={!online}
                    onClick={() => setTemplateEdit(template)}
                  >
                    {t("edit")}
                  </Button>
                )}
                {(!template.archived_at || manage) && (
                  <CourseActionDisclosure>
                    {!template.archived_at && (
                      <Button
                        variant="secondary"
                        disabled={!online}
                        onClick={() => setSeriesTemplate(template)}
                      >
                        {t("courseSeries:title")}
                      </Button>
                    )}
                    {manage && (
                      <Button
                        variant="ghost"
                        disabled={!online}
                        onClick={() => {
                          duplicate.reset();
                          setCopy({
                            type: "template",
                            id: template.id,
                            title: template.title,
                          });
                          setCopyTitle(
                            `${template.title} · ${t("copySuffix")}`,
                          );
                        }}
                      >
                        <Copy size={16} />
                        {t("duplicate")}
                      </Button>
                    )}
                  </CourseActionDisclosure>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {total > batchSize && (
        <div className="page-actions course-list-footer">
          <p role="status">
            {t("courseListCount", { count: shownCount, total })}
          </p>
          {shownCount < total && (
            <LoadMore
              pageKey={`${listKey}:${shownCount}`}
              onLoad={() =>
                setVisibleList({ key: listKey, count: shownCount + batchSize })
              }
            >
              {t(tab === "runs" ? "loadMoreRuns" : "loadMoreTemplates")}
            </LoadMore>
          )}
        </div>
      )}
      <Dialog
        open={mayOpenSeries && seriesTemplate !== undefined}
        closeDisabled={seriesBusy}
        onOpenChange={(open) => {
          if (!open && !seriesBusy) setSeriesTemplate(undefined);
        }}
        title={t("courseSeries:title")}
        description={t("courseSeries:intro")}
      >
        {mayOpenSeries && seriesTemplate !== undefined && (
          <CourseSeriesForm
            key={templateCompanyId}
            actor={actor}
            organisations={planningOrganisations.filter(
              (organisation) =>
                !("archived_at" in organisation) || !organisation.archived_at,
            )}
            templates={visibleTemplates.filter(
              (template) => !template.archived_at,
            )}
            defaultTemplate={seriesTemplate?.id}
            defaultOrganisation={
              seriesTemplate?.owner_organisation_id ??
              (planningOrganisations.length === 1
                ? planningOrganisations[0].id
                : "")
            }
            onOpen={() => {
              setSeriesTemplate(undefined);
              setSearch("");
              setPhase("all");
            }}
            onBusy={setSeriesBusy}
          />
        )}
      </Dialog>
      <Dialog
        open={mayOpenTemplateEditor && templateEdit !== undefined}
        onOpenChange={(open) => {
          if (!open) setTemplateEdit(undefined);
        }}
        title={t(templateEdit ? "edit" : "newTemplate")}
        description={t("template")}
      >
        <TemplateForm
          key={`${templateCompany?.id ?? "global"}:${templateEdit?.id ?? "new"}`}
          original={templateEdit ?? undefined}
          organisations={planningOrganisations}
          companyOnly={!manage}
          onDone={() => {
            setTemplateEdit(undefined);
            setMessage(t("saved"));
          }}
        />
      </Dialog>
      <Dialog
        open={Boolean(creatorId)}
        onOpenChange={(open) => {
          if (!open && !runSaving)
            setCourseView(
              tab === "templates" ? { tab: "templates" } : {},
              true,
            );
        }}
        closeDisabled={runSaving}
        title={creatorText("start")}
        description={creatorText("offerHint")}
      >
        {creatorId &&
          (!online && !creatorRecord && !creatorFresh ? (
            <Notice kind="error">{creatorText("offline")}</Notice>
          ) : creatorRead.isPending && online ? (
            <Loading />
          ) : creatorRead.isError ? (
            <ErrorState retry={() => void creatorRead.refetch()} />
          ) : creatorRecord?.state === "created" ? (
            <Button
              type="button"
              onClick={() => continueCreator(creatorRecord)}
            >
              {creatorText(
                creatorRecord.next_action === "offer"
                  ? "continueOffer"
                  : "openCourse",
              )}
            </Button>
          ) : creatorSourceUnavailable ? (
            <Notice kind="error">{t("courseRecordUnavailable")}</Notice>
          ) : creatorRecord?.state === "editing" || creatorFresh ? (
            <RunForm
              key={`${creatorId}:${creatorEpoch}`}
              creator={{ id: creatorId, saved: creatorRecord }}
              initialTemplateId={creatorTemplate?.id}
              initialSchedule={calendarPlan}
              reloadCreator={() => {
                void creatorRead.refetch().then((result) => {
                  if (result.isSuccess) setCreatorEpoch((epoch) => epoch + 1);
                });
              }}
              templates={templates.data ?? []}
              organisations={planningOrganisations}
              companyOnly={false}
              canPrepareOffer={canPrepareOffer}
              canReadBlockPlanning
              onBusy={setRunSaving}
              onDone={(_result, offer, run) => {
                if (run) setSavedRun(run);
                setCourseView(offer ? { offer } : {});
                if (!offer) setMessage(t("courseDraftCreated"));
              }}
            />
          ) : (
            <Notice kind="error">{creatorText("error")}</Notice>
          ))}
      </Dialog>
      <Dialog
        open={
          mayOpenRunEditor &&
          (runEdit !== undefined || Boolean(calendarPlan && !creatorRoute))
        }
        onOpenChange={(open) => {
          if (!open && !runSaving) {
            setRunEdit(undefined);
            if (calendarPlan) setCourseView({}, true);
          }
        }}
        closeDisabled={runSaving}
        title={t(runEdit ? "edit" : "newCourse")}
        description={
          runEdit
            ? (findTemplate(runEdit)?.title ?? t("courseRecordUnavailable"))
            : t(
                initialTemplateId && !calendarPlan
                  ? "courseDraftFromTemplateHint"
                  : "publishedHint",
              )
        }
      >
        <RunForm
          key={
            runEdit?.id ??
            `new:${calendarPlan ? `${calendarPlan.starts_at}/${calendarPlan.ends_at}/${calendarPlan.time_zone}` : (initialTemplateId ?? "default")}`
          }
          original={runEdit ?? undefined}
          templates={manage ? (templates.data ?? []) : visibleTemplates}
          organisations={planningOrganisations}
          initialTemplateId={calendarPlan ? undefined : initialTemplateId}
          initialSchedule={calendarPlan}
          companyOnly={!manage}
          focusTarget={focusTarget}
          canPrepareOffer={canPrepareOffer}
          canReadBlockPlanning={manage}
          onBusy={setRunSaving}
          onDone={(result, offerRun, savedId) => {
            setRunEdit(undefined);
            setSavedRun(savedId);
            if (offerRun) {
              navigate(`/courses?offer=${encodeURIComponent(offerRun)}`);
              return;
            }
            setTab(result === "template" ? "templates" : "runs");
            if (initialTemplateId && !calendarPlan && !runEdit) {
              setSearch("");
              setPhase("all");
              setMessage(t("courseDraftCreated"));
            } else {
              setMessage(t("saved"));
            }
          }}
        />
      </Dialog>
      <Dialog
        open={Boolean(templateDetail)}
        onOpenChange={(open) => {
          if (!open) setCourseView({ tab: "templates" }, true);
        }}
        title={templateDetail?.title ?? t("template")}
        description={t("template")}
      >
        {templateDetail && (
          <>
            <h3>{t("description")}</h3>
            <p className="curriculum-syllabus">{templateDetail.description}</p>
            <h3>{t("syllabus")}</h3>
            <p className="curriculum-syllabus">{templateDetail.syllabus}</p>
            {templateDetail.prerequisites && (
              <>
                <h3>{t("prerequisites")}</h3>
                <p className="curriculum-syllabus">
                  {templateDetail.prerequisites}
                </p>
              </>
            )}
            {canManageTemplate(templateDetail) && (
              <div className="form-actions">
                <Button
                  disabled={!online || Boolean(templateDetail.archived_at)}
                  onClick={() => planRun(templateDetail.id)}
                >
                  {t("createRunFromTemplate")}
                </Button>
                {canEditTemplate(templateDetail) && (
                  <Button
                    variant="secondary"
                    disabled={!online}
                    onClick={() => {
                      setTab("templates");
                      setTemplateEdit(templateDetail);
                    }}
                  >
                    {t("edit")}
                  </Button>
                )}
                {manage && (
                  <PermanentDeleteAction
                    shortLabel
                    kind="course_template"
                    id={templateDetail.id}
                    label={templateDetail.title}
                    linkedRuns={(runs.data ?? [])
                      .filter((run) => run.template_id === templateDetail.id)
                      .map((run) => ({
                        id: run.id,
                        title: run.course_sessions.length
                          ? dateTime(
                              run.course_sessions[0].starts_at,
                              i18n.language,
                              run.time_zone,
                            )
                          : t("courseRunWithoutSessions"),
                      }))}
                  />
                )}
              </div>
            )}
            {manage && templateDetail.building_block_id && (
              <BuildingBlockReference
                buildingBlockId={templateDetail.building_block_id}
                sourceId={templateDetail.building_block_source_id}
              />
            )}
            <ResourceComments kind="template" resourceId={templateDetail.id} />
          </>
        )}
      </Dialog>
      <Dialog
        open={Boolean(copy)}
        onOpenChange={(open) => {
          if (!open) setCopy(undefined);
        }}
        title={t("duplicate")}
        description={t(
          copy?.type === "template" ? "templateCopyHint" : "copyHint",
        )}
      >
        {copy?.type === "run" ? (
          <Suspense fallback={<Loading />}>
            <CourseReuseForm
              key={copy.id}
              title={copy.title}
              run={copy.run}
              onSaved={async (runId) => {
                await client.invalidateQueries({ queryKey: ["operations"] });
                setCopy(undefined);
                setMessage(t("copied"));
                setCourseView({ run: runId });
              }}
            />
          </Suspense>
        ) : (
          copy?.type === "template" && (
            <>
              <p>{copy.title}</p>
              <Field id="copy-title" label={t("copyTitle")}>
                <input
                  id="copy-title"
                  value={copyTitle}
                  onChange={(event) => setCopyTitle(event.target.value)}
                  maxLength={200}
                />
              </Field>
              <Button
                disabled={!online || duplicate.isPending || !copyTitle.trim()}
                onClick={() => duplicate.mutate()}
              >
                {t("duplicate")}
              </Button>
              {duplicate.isError && <Notice kind="error">{t("error")}</Notice>}
            </>
          )
        )}
      </Dialog>
      <Dialog
        open={Boolean(offerRunId)}
        onOpenChange={(open) => {
          if (!open) setCourseView({ run: offerRunId ?? "" }, true);
        }}
        title={t("createRunOffer")}
        description={t("offerEditorDescription")}
      >
        {offerRunId && (
          <Suspense fallback={<Loading />}>
            <CourseOfferForm runId={offerRunId} />
          </Suspense>
        )}
      </Dialog>
      <Dialog
        open={Boolean(detail) && !offerRunId}
        onOpenChange={(open) => {
          if (!open) setCourseView({}, true);
        }}
        title={
          detail ? (findTemplate(detail)?.title ?? t("courses")) : t("courses")
        }
        description={t("readOnly")}
      >
        {detail && (
          <>
            <div className="page-actions course-record-actions">
              {manage && (
                <Button
                  disabled={!online}
                  onClick={() => {
                    setCourseView({}, true);
                    editRun(detail);
                  }}
                >
                  {t("edit")}
                </Button>
              )}
              {manage && (
                <Button
                  variant="secondary"
                  disabled={!online || archiveRun.isPending}
                  onClick={() =>
                    archiveRun.mutate({
                      run: detail,
                      archived: !detail.archived_at,
                    })
                  }
                >
                  {t(detail.archived_at ? "restore" : "archiveAction")}
                </Button>
              )}
              <PermanentDeleteAction
                shortLabel
                kind="course_run"
                id={detail.id}
                label={findTemplate(detail)?.title ?? t("courses")}
                linkedJobs={detail.jobs}
                onReviewSessions={
                  manage ? () => reviewSchedule(detail) : undefined
                }
              />
            </div>
            {manage && (
              <div className="course-marketplace-state">
                {offerStatus(
                  detail,
                  courseOfferState(detail, runs.dataUpdatedAt),
                )}
                {marketplaceAction(detail)}
              </div>
            )}
            {!detail.archived_at && (
              <div className="page-actions">
                {workspaceEntitlement.isPending ? (
                  <Loading />
                ) : workspaceEntitlement.isSuccess ? (
                  <>
                    <Button asChild variant="secondary">
                      <Link to={`/courses/${detail.id}/workspace`}>
                        {t("learning:openWorkspace")}
                      </Link>
                    </Button>
                    {!workspaceEntitlement.data.lms_enabled && (
                      <span className="badge">
                        {t("learning:premiumOffCourseBadge")}
                      </span>
                    )}
                  </>
                ) : (
                  <Notice>{t("workspaceUnavailable")}</Notice>
                )}
              </div>
            )}
            <h3>{t("syllabus")}</h3>
            <p className="preserve-text">
              {findTemplate(detail)?.syllabus || "—"}
            </p>
            {detail.teaching_language && (
              <p>
                <strong>{t("teachingLanguage")}</strong>{" "}
                {t(
                  detail.teaching_language === "de"
                    ? "teachingLanguageGerman"
                    : "teachingLanguageEnglish",
                )}
              </p>
            )}
            <h3>{t("prerequisites")}</h3>
            <p className="preserve-text">
              {findTemplate(detail)?.prerequisites || "—"}
            </p>
            <h3>{t("sessions")}</h3>
            <SessionScroll label={t("sessions")}>
              <ol className="session-list">
                {[...detail.course_sessions]
                  .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                  .map((s) => (
                    <li key={s.id}>
                      <CalendarDays size={18} />
                      <div>
                        <strong>
                          {dateTime(
                            s.starts_at,
                            i18n.language,
                            detail.time_zone,
                          )}
                        </strong>
                        <span>
                          {dateTime(s.ends_at, i18n.language, detail.time_zone)}
                        </span>
                      </div>
                    </li>
                  ))}
              </ol>
            </SessionScroll>
            <p>
              {detail.time_zone} · {detail.venue}
            </p>
          </>
        )}
      </Dialog>
    </>
  );
}
