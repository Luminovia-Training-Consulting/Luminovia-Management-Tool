import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { SessionScroll } from "../../components/session-scroll";
import { TimeZoneOptions } from "../../components/time-zone-options";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { topicsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import type { Topic } from "../../lib/types";
import type { calendarCourseSchedule } from "../../lib/course-calendar-link";
import {
  dateTime,
  validZone,
  zonedInstantForScheduleEdit,
  compareScheduleInstants,
  validScheduleIntervals,
} from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { selectableTopics } from "../taxonomy/selection";
import { useAuth } from "../auth/auth-context";
import {
  changeCandidatesQuery,
  lifecycleQuery,
  OfferPublicationAction,
  refreshJobState,
} from "@edition-course-offers";
import { CourseSessionRecurrence } from "../learning/course-session-recurrence";
import {
  buildingBlockPlanningQuery,
  type CourseRun,
  type Organisation,
  type Template,
} from "./data";
import { CourseSessionBulkEdit } from "./course-session-bulk-edit";
import { CourseSchedulePlanner } from "./course-schedule-planner";
import {
  useCourseCreatorDraftSaver,
  type CourseCreatorDraft,
} from "./course-creator-drafts-api";
import { runSchema } from "./course-editor-schema";
import { courseTemplateFormSchema as templateSchema } from "./course-building-block-schema";
import "./i18n";
import "./styles.css";
import "./course-creator-drafts-i18n";

const CourseCreatorDraftSaveBar = lazy(() =>
  import("./course-creator-drafts").then(({ CourseCreatorDraftSaveBar }) => ({
    default: CourseCreatorDraftSaveBar,
  })),
);

import { operationalPresetSelection } from "./operational-preset-schema";

const OperationalPresetPicker = lazy(() =>
  import("./operational-presets").then(({ OperationalPresetPicker }) => ({
    default: OperationalPresetPicker,
  })),
);

type TemplateValues = z.infer<typeof templateSchema>;
type PlanningOrganisation = Pick<Organisation, "id" | "name"> &
  Partial<Pick<Organisation, "archived_at">>;
const newCourseSchema = runSchema.extend({
  operational_preset: operationalPresetSelection.nullish(),
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
export function TemplateForm({
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
export function RunForm({
  original,
  templates,
  organisations,
  initialTemplateId,
  initialSchedule,
  creator,
  academy = false,
  sourceSearch,
  reloadCreator,
  companyOnly,
  focusTarget,
  canPrepareOffer,
  canReadBlockPlanning,
  onDone,
  onBusy,
}: {
  original?: CourseRun;
  templates: (Pick<Template, "id" | "title"> &
    Partial<
      Pick<
        Template,
        "owner_organisation_id" | "archived_at" | "building_block_id"
      >
    >)[];
  organisations: PlanningOrganisation[];
  initialTemplateId?: string;
  initialSchedule?: ReturnType<typeof calendarCourseSchedule>;
  creator?: { id: string; saved?: CourseCreatorDraft };
  academy?: boolean;
  sourceSearch?: ReactNode;
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
  const topics = useQuery({ ...topicsQuery, enabled: !academy });
  const topicsReady = academy || topics.isSuccess;
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
    formState: { errors, isDirty, dirtyFields },
  } = useForm<z.infer<typeof newCourseSchema>>({
    resolver: zodResolver(
      academy
        ? newCourseSchema.extend({ organisation_id: z.uuid() })
        : newCourseSchema,
    ),
    defaultValues: creator?.saved?.payload?.run ?? {
      template_id: original?.template_id ?? initialTemplateId ?? "",
      organisation_id:
        original?.organisation_id ??
        templates.find(({ id }) => id === initialTemplateId)
          ?.owner_organisation_id ??
        "",
      time_zone:
        original?.time_zone ??
        initialSchedule?.time_zone ??
        (academy
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : "Europe/Berlin"),
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
  const adoptedPreset = useWatch({ control, name: "operational_preset" });
  const legacyDelivery = useWatch({ control, name: "delivery_type" });
  const matchingPreset =
    adoptedPreset?.organisation_id === selectedOrganisationId
      ? adoptedPreset
      : undefined;
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
  const linkedJobs = academy ? [] : (original?.jobs ?? []);
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
        schedule.current?.focus();
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
        const adoption =
          values.operational_preset?.organisation_id === organisation_id
            ? values.operational_preset
            : null;
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
              ...(adoption
                ? {
                    operational_preset: {
                      id: adoption.id,
                      revision: adoption.revision,
                      apply_delivery: adoption.apply_delivery,
                    },
                  }
                : {}),
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
      {canEditCourseDetails && !linked && !academy && !companyOnly && (
        <Field id="run-teaching-language" label={t("teachingLanguage")}>
          <select id="run-teaching-language" {...register("teaching_language")}>
            <option value="">{t("teachingLanguageUnset")}</option>
            <option value="de">{t("teachingLanguageGerman")}</option>
            <option value="en">{t("teachingLanguageEnglish")}</option>
          </select>
        </Field>
      )}
      {sourceSearch}
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
                  if (companyOnly || creator?.saved?.from_enquiry) return;
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
                    (!template.archived_at ||
                      template.id === original?.template_id) &&
                    (!creator?.saved?.from_enquiry ||
                      !template.owner_organisation_id ||
                      template.owner_organisation_id ===
                        selectedOrganisationId),
                )
                .map((template) => (
                  <option value={template.id} key={template.id}>
                    {template.title}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {creator?.saved?.from_enquiry && needsContent && (
          <p className="muted">{creatorText("enquirySourceReview")}</p>
        )}
        {creator?.saved?.from_enquiry && (
          <div className="field">
            <input type="hidden" {...register("organisation_id")} />
            <strong>{t("organisation")}</strong>
            <span>
              {organisations.find(({ id }) => id === selectedOrganisationId)
                ?.name ?? t("courseRecordUnavailable")}
            </span>
          </div>
        )}
        {canEditCompany && !creator?.saved?.from_enquiry && (
          <Field
            id="run-org"
            label={t("organisation")}
            error={Boolean(errors.organisation_id)}
            hint={
              focusTarget === "organisation"
                ? t("offerOrganisationRequired")
                : undefined
            }
          >
            <select id="run-org" {...register("organisation_id")}>
              {!selectedTemplate?.owner_organisation_id &&
                (!linked || !original?.organisation_id) && (
                  <option value="" disabled={linked || academy}>
                    {t(academy ? "learning:choose" : "none")}
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
        {creator &&
          !academy &&
          !companyOnly &&
          activeOrganisation &&
          selectedOrganisationId && (
            <Suspense fallback={null}>
              <OperationalPresetPicker
                key={selectedOrganisationId}
                actor={actor}
                organisation={selectedOrganisationId}
                applied={matchingPreset}
                dirtyZone={Boolean(dirtyFields.time_zone || initialSchedule)}
                dirtyDelivery={Boolean(
                  dirtyFields.delivery_type || dirtyFields.venue,
                )}
                disabled={save.isPending}
                onApply={(preset, inheritZone, inheritDelivery) => {
                  const config = preset.config;
                  if (config.time_zone && inheritZone)
                    changeZone(config.time_zone);
                  if (config.delivery && inheritDelivery)
                    setValue(
                      "delivery_type",
                      config.delivery.mode === "onsite" ? "onsite" : "online",
                      { shouldDirty: true },
                    );
                  setValue(
                    "operational_preset",
                    {
                      id: preset.id,
                      revision: preset.revision,
                      organisation_id: selectedOrganisationId,
                      apply_delivery: Boolean(
                        config.delivery && inheritDelivery,
                      ),
                      starts_at: config.starts_at,
                      ends_at: config.ends_at,
                    },
                    { shouldDirty: true },
                  );
                }}
                onClear={() =>
                  setValue("operational_preset", null, { shouldDirty: true })
                }
              />
            </Suspense>
          )}
        {needsContent &&
          (!academy && topics.isPending ? (
            <Loading />
          ) : !academy && topics.isError ? (
            <ErrorState retry={() => void topics.refetch()} />
          ) : (
            <CourseContentFields
              register={content.register}
              errors={content.formState.errors}
              topics={topics.data ?? []}
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
              <select
                id="run-delivery"
                {...register("delivery_type", {
                  onChange: (event) => {
                    if (
                      matchingPreset &&
                      event.target.value !== legacyDelivery
                    ) {
                      setValue(
                        "operational_preset",
                        { ...matchingPreset, apply_delivery: false },
                        { shouldDirty: true },
                      );
                    }
                  },
                })}
              >
                <option value="online">{t("online")}</option>
                <option value="onsite">{t("onsite")}</option>
              </select>
            </Field>
          </div>
        )}
      </div>
      {creator && <h3>{creatorText("schedule")}</h3>}
      <Field id="run-venue" label={t("venue")} error={Boolean(errors.venue)}>
        <input
          id="run-venue"
          {...register("venue", {
            onChange: () =>
              matchingPreset?.apply_delivery &&
              setValue(
                "operational_preset",
                { ...matchingPreset, apply_delivery: false },
                { shouldDirty: true },
              ),
          })}
        />
      </Field>
      <fieldset
        className="operations-topic-field"
        ref={schedule}
        tabIndex={-1}
        aria-describedby={timeError ? "run-schedule-error" : undefined}
      >
        <legend>{t("sessions")}</legend>
        {timeError && (
          <div id="run-schedule-error">
            <Notice kind="error">{t("timeInvalid")}</Notice>
          </div>
        )}
        {canEditSchedule ? (
          <>
            <CourseSchedulePlanner
              zone={zone}
              suggestedDays={selectedBlock?.duration_days}
              suggestedStart={matchingPreset?.starts_at ?? undefined}
              suggestedEnd={matchingPreset?.ends_at ?? undefined}
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
                canApply={(rows) =>
                  Boolean(
                    resolveCourseSessions(
                      rows.filter(
                        ({ starts_at, ends_at }) => starts_at || ends_at,
                      ),
                      zone,
                      sessionOrigins.current,
                    ),
                  )
                }
                onApply={(changes) => {
                  const byId = new Map(
                    changes.map((entry) => [entry.id, entry.row]),
                  );
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
                    onClick={() => {
                      remove(index);
                      const next = Math.min(index, fields.length - 2);
                      requestAnimationFrame(() =>
                        setFocus(`sessions.${next}.starts_at`),
                      );
                    }}
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
              onClick={() =>
                append(
                  { starts_at: "", ends_at: "" },
                  {
                    focusName: `sessions.${fields.length}.starts_at`,
                  },
                )
              }
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
                  operational_preset: getValues("operational_preset"),
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
            disabled={!online || save.isPending || !topicsReady}
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
          variant={focusTarget === "organisation" ? "secondary" : "default"}
          disabled={
            !online ||
            save.isPending ||
            draftSaver.status === "conflict" ||
            (needsContent && !topicsReady)
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
              variant={focusTarget === "organisation" ? "default" : "secondary"}
              disabled={
                !online ||
                !activeOrganisation ||
                save.isPending ||
                draftSaver.status === "conflict" ||
                (needsContent && !topicsReady)
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
      {save.isError && !timeError && save.error?.message !== "time" && (
        <Notice kind="error">
          {creator?.saved?.from_enquiry &&
          save.error &&
          "code" in save.error &&
          save.error.code === "PT409" ? (
            <>
              {creatorText("enquirySourceConflict")}{" "}
              <Link to="/enquiries">{creatorText("backToEnquiries")}</Link>
            </>
          ) : (
            t(
              save.error?.message === "course_locked" ||
                (save.error &&
                  "code" in save.error &&
                  save.error.code === "40001")
                ? "linkedRunConflict"
                : "error",
            )
          )}
        </Notice>
      )}
    </form>
  );
}
