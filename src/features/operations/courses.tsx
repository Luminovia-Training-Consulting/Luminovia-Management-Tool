import { SessionScroll } from "../../components/session-scroll";
import { PermanentDeleteAction } from "../deletions/deletions";
/**
 * Reusable templates and actual course runs with concrete sessions. Content, participant
 * management and versioned publication of linked teaching offers.
 */
import { selectableTopics } from "../taxonomy/selection";
import "../taxonomy/i18n";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import {
  scheduledCoursePhase,
  type CoursePhaseSelection,
} from "../learning/course-phase";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BookOpen, CalendarDays, Copy, Plus, Trash2 } from "lucide-react";
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
import { db } from "../../lib/supabase";
import {
  dateTime,
  validZone,
  zonedInstantForScheduleEdit,
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
  type BuildingBlock,
  buildingBlocksQuery,
  type CourseRun,
  type Organisation,
  orgQuery,
  runsQuery,
  type Template,
  templatesQuery,
} from "./data";
import { BuildingBlockSources, CourseRunOfferLink } from "./building-blocks";
import { weekdaySessions } from "./schedule";

import { courseTemplateFormSchema as templateSchema } from "./course-building-block-schema";

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

/** Compare absolute instants, retaining PostgreSQL microseconds when JavaScript milliseconds tie. Invalid endpoints return null. */
function compareCourseInstants(first: string, second: string): number | null {
  const firstMillis = Date.parse(first);
  const secondMillis = Date.parse(second);
  if (!Number.isFinite(firstMillis) || !Number.isFinite(secondMillis))
    return null;
  const difference = firstMillis - secondMillis;
  if (difference) return difference;
  // PostgreSQL timestamps retain up to six fractional digits. Equal JavaScript
  // milliseconds still need that precision; whole-minute ISO offsets do not
  // affect the fractional component within the same absolute second.
  const microseconds = (instant: string) =>
    Number(
      (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i.exec(instant)?.[1] ?? "")
        .padEnd(6, "0")
        .slice(0, 6),
    );
  return microseconds(first) - microseconds(second);
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
        original?.owner_organisation_id ? undefined : owner,
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
          disabled={Boolean(original?.owner_organisation_id)}
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
  companyOnly,
  focusTarget,
  blocks,
  canPrepareOffer,
  onDone,
  onBusy,
}: {
  original?: CourseRun;
  templates: Template[];
  organisations: PlanningOrganisation[];
  initialTemplateId?: string;
  companyOnly: boolean;
  focusTarget?: "schedule" | "organisation";
  blocks: BuildingBlock[];
  canPrepareOffer: boolean;
  onDone: (
    result: "template" | "run",
    offerRun?: string,
    savedRun?: string,
  ) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { t, i18n } = useTranslation("operations");
  const draftOnly = Boolean(initialTemplateId) && !original;
  const { session } = useAuth();
  const actor = session!.user.id;
  const online = useOnline();
  const client = useQueryClient();
  const topics = useQuery(topicsQuery);
  const content = useForm<TemplateValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
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
  const [planningDate, setPlanningDate] = useState("");
  const [planningStart, setPlanningStart] = useState("09:00");
  const [planningEnd, setPlanningEnd] = useState("17:00");
  const [planningError, setPlanningError] = useState(false);
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
    defaultValues: {
      template_id: original?.template_id ?? initialTemplateId ?? "",
      organisation_id:
        original?.organisation_id ??
        templates.find(({ id }) => id === initialTemplateId)
          ?.owner_organisation_id ??
        "",
      time_zone: original?.time_zone ?? "Europe/Berlin",
      delivery_type: original?.delivery_type ?? "online",
      venue: original?.venue ?? "",
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
        : [{ starts_at: "", ends_at: "" }],
    },
  });
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
  const selectedBlock = blocks.find(
    (item) => item.id === selectedTemplate?.building_block_id,
  );
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
      const origins = sessionOrigins.current;
      const sessions = values.sessions.map((s) => {
        const source = origins.sessions.get(s.source_session_id ?? "");
        const start = zonedInstantForScheduleEdit(
          s.starts_at,
          values.time_zone,
          source?.starts_at,
          origins.zone,
        );
        const end = zonedInstantForScheduleEdit(
          s.ends_at,
          values.time_zone,
          source?.ends_at,
          origins.zone,
        );
        const order = start && end ? compareCourseInstants(end, start) : null;
        if (!start || !end || order === null || order <= 0) {
          setTimeError(true);
          throw new Error("time");
        }
        return { starts_at: start, ends_at: end };
      });
      const ordered = [...sessions].sort(
        (a, b) => compareCourseInstants(a.starts_at, b.starts_at) ?? 0,
      );
      if (
        ordered.some(
          (session, index) =>
            index > 0 &&
            (compareCourseInstants(
              session.starts_at,
              ordered[index - 1].ends_at,
            ) ?? -1) < 0,
        )
      ) {
        setTimeError(true);
        throw new Error("time");
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
      const payload = {
        ...values,
        template_id: templateId,
        sessions,
        published: original?.published ?? false,
      };
      let offerChange:
        { expected_job_version: number; job_request_id: string } | undefined;
      if (linked && original) {
        const originalSessions = [...original.course_sessions].sort(
          (a, b) => compareCourseInstants(a.starts_at, b.starts_at) ?? 0,
        );
        const scheduleChanged =
          ordered.length !== originalSessions.length ||
          ordered.some(
            (row, index) =>
              compareCourseInstants(
                row.starts_at,
                originalSessions[index].starts_at,
              ) !== 0 ||
              compareCourseInstants(
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
        {selectedBlock && canEditSchedule && (
          <fieldset className="operations-schedule-planner">
            <legend>{t("blockSchedule", { code: selectedBlock.code })}</legend>
            <p>
              {t("scheduleHelp", {
                days: selectedBlock.duration_days,
                hours: selectedBlock.duration_hours,
              })}
            </p>
            <Field id="planning-start-date" label={t("firstDate")}>
              <input
                id="planning-start-date"
                type="date"
                value={planningDate}
                onChange={(event) => setPlanningDate(event.target.value)}
              />
            </Field>
            <div className="form-row">
              <Field id="planning-start-time" label={t("dailyStart")}>
                <input
                  id="planning-start-time"
                  type="time"
                  value={planningStart}
                  onChange={(event) => setPlanningStart(event.target.value)}
                />
              </Field>
              <Field id="planning-end-time" label={t("dailyEnd")}>
                <input
                  id="planning-end-time"
                  type="time"
                  value={planningEnd}
                  onChange={(event) => setPlanningEnd(event.target.value)}
                />
              </Field>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                try {
                  replace(
                    weekdaySessions(
                      planningDate,
                      planningStart,
                      planningEnd,
                      selectedBlock.duration_days,
                    ),
                  );
                  setPlanningError(false);
                } catch {
                  setPlanningError(true);
                }
              }}
            >
              {t("generateSchedule", { count: selectedBlock.duration_days })}
            </Button>
            {planningError && (
              <Notice kind="error">{t("scheduleInvalid")}</Notice>
            )}
          </fieldset>
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
      <Field id="run-venue" label={t("venue")} error={Boolean(errors.venue)}>
        <input id="run-venue" {...register("venue")} />
      </Field>
      <fieldset className="operations-topic-field" ref={schedule} tabIndex={-1}>
        <legend>{t("sessions")}</legend>
        {canEditSchedule ? (
          <>
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
          </>
        ) : (
          <>
            <ol className="course-run-retained-sessions">
              {[...(original?.course_sessions ?? [])]
                .sort(
                  (a, b) =>
                    compareCourseInstants(a.starts_at, b.starts_at) ?? 0,
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
      <div className="form-actions">
        {needsContent && (
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
            !online || save.isPending || (needsContent && !topics.isSuccess)
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
      ({ status, claim_deadline, job_sessions }) =>
        status === "published" &&
        (!claim_deadline || Date.parse(claim_deadline) > now) &&
        (!job_sessions ||
          (job_sessions.length > 0 &&
            job_sessions.every(
              ({ starts_at }) => Date.parse(starts_at) > now,
            ))),
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
            ({ status, job_sessions }) =>
              status === "published" &&
              job_sessions?.some(
                ({ starts_at }) => Date.parse(starts_at) <= now,
              ),
          )
        ? "marketplaceStarted"
        : jobs.some(({ status }) => status === "draft")
          ? "marketplaceDraft"
          : jobs.length
            ? "marketplaceClosed"
            : "marketplaceMissing";
  return { liveOffers, closedReason };
}

/** Combine templates/runs with explicitly requested publication/copy actions. */
export function CoursesPage() {
  const { t, i18n } = useTranslation("operations");
  const { session } = useAuth();
  const actor = session!.user.id;
  const permissions = useQuery(permissionsQuery(actor));
  const templates = useQuery(templatesQuery(actor));
  const manage = permissions.data?.includes("courses.manage") ?? false;
  const canPrepareOffer =
    manage && (permissions.data?.includes("jobs.manage") ?? false);
  const roles = useQuery(userRolesQuery(actor));
  const companyViewer = !manage && roles.data?.includes("client");
  const ownCompanies = useQuery({
    ...clientOrganisationsQuery(actor),
    enabled: Boolean(companyViewer),
  });
  const runs = useQuery({
    ...runsQuery(actor),
    refetchInterval: manage ? false : 10000,
    refetchOnMount: manage ? true : "always",
  });
  const orgs = useQuery(orgQuery(actor));
  const topics = useQuery(topicsQuery);
  const blocks = useQuery({ ...buildingBlocksQuery(actor), enabled: manage });
  const client = useQueryClient();
  const online = useOnline();
  const [search, setSearch] = useState("");
  const [phase, setPhase] = useState<CoursePhaseSelection>("all");
  const [showArchivedRuns, setShowArchivedRuns] = useState(false);
  const [initialTemplateId, setInitialTemplateId] = useState<string>();
  const [templateEdit, setTemplateEdit] = useState<Template | null>();
  const [runEdit, setRunEdit] = useState<CourseRun | null | undefined>();
  const [runSaving, setRunSaving] = useState(false);
  const [focusTarget, setFocusTarget] = useState<"schedule" | "organisation">();
  const [params, setParams] = useSearchParams();
  const tab =
    (manage || companyViewer) && params.get("tab") === "templates"
      ? "templates"
      : "runs";
  const setTab = (next: "runs" | "templates") => {
    setParams(next === "templates" ? { tab: next } : {});
  };
  const companyOrganisations = companyViewer ? (ownCompanies.data ?? []) : [];
  const canCreateTemplate = manage || companyOrganisations.length > 0;
  const canManageTemplate = (template: Template) =>
    manage ||
    companyOrganisations.some(
      ({ id }) => id === template.owner_organisation_id,
    );
  const canEditTemplate = (template: Template) =>
    manage ||
    (canManageTemplate(template) &&
      !template.building_block_id &&
      !template.building_block_source_id);
  const navigate = useNavigate();
  const detail = runs.data?.find((run) => run.id === params.get("run"));
  const offerRunId = canPrepareOffer ? params.get("offer") : null;
  const workspaceEntitlement = useQuery({
    ...courseWorkspaceEntitlementQuery(actor, detail?.id ?? ""),
    enabled: Boolean(detail && !detail.archived_at),
  });
  const templateDetail = templates.data?.find(
    (template) => template.id === params.get("template"),
  );
  const editRun = (
    run: CourseRun | null,
    target?: "schedule" | "organisation",
  ) => {
    setFocusTarget(target);
    setRunEdit(run);
  };
  const reviewSchedule = (run: CourseRun) => {
    setParams({}, { replace: true });
    editRun(run, "schedule");
  };
  const planRun = (templateId: string) => {
    setInitialTemplateId(templateId);
    setTab(tab);
    editRun(null);
  };
  const [copy, setCopy] = useState<{
    type: "template" | "run";
    id: string;
    title: string;
  }>();
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
      if (!copy) throw new Error("missing");
      const { error } = await db().rpc(
        copy.type === "template"
          ? "duplicate_course_template"
          : "duplicate_course_run",
        copy.type === "template"
          ? { p_id: copy.id, p_title: copyTitle.trim() }
          : { p_id: copy.id },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["operations"] });
      setCopy(undefined);
      setMessage(t("copied"));
    },
  });
  if (
    templates.isPending ||
    runs.isPending ||
    orgs.isPending ||
    topics.isPending ||
    permissions.isPending ||
    (manage && blocks.isPending)
  )
    return <Loading />;
  if (
    templates.isError ||
    runs.isError ||
    orgs.isError ||
    topics.isError ||
    permissions.isError ||
    (manage && blocks.isError)
  )
    return (
      <ErrorState
        retry={() => {
          void templates.refetch();
          void runs.refetch();
          void orgs.refetch();
          void topics.refetch();
          void permissions.refetch();
          void blocks.refetch();
        }}
      />
    );
  const findTemplate = (run: CourseRun) =>
    templates.data.find((template) => template.id === run.template_id);
  const filteredRuns = runs.data.filter(
    (run) =>
      (!run.archived_at || (manage && showArchivedRuns)) &&
      (phase === "all" ||
        scheduledCoursePhase(run.course_sessions, runs.dataUpdatedAt) ===
          phase) &&
      [
        findTemplate(run)?.title,
        findTemplate(run)?.description,
        orgs.data.find((org) => org.id === run.organisation_id)?.name,
        run.venue,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visibleTemplates = templates.data.filter(canManageTemplate);
  const planningOrganisations = manage ? orgs.data : companyOrganisations;
  const offerStatus = (run: CourseRun) => {
    const { liveOffers, closedReason } = courseOfferState(
      run,
      runs.dataUpdatedAt,
    );
    return (
      <>
        <strong>{t("marketplaceStatus")}</strong>
        {liveOffers.length
          ? liveOffers.map((job) => (
              <Link key={job.id} to={`/jobs/${job.id}`}>
                {t(
                  job.company_internal || run.own_lecturers_only
                    ? "openCompanyOffer"
                    : "openListedOffer",
                  { title: job.title },
                )}
              </Link>
            ))
          : t(closedReason)}
      </>
    );
  };
  const marketplaceAction = (run: CourseRun) => {
    if (!manage) return null;
    const draft = run.jobs?.find(({ status }) => status === "draft");
    if (draft)
      return (
        <div className="operations-actions">
          <Link to={`/jobs/${draft.id}`}>
            {t("openMarketplaceDraft", { title: draft.title })}
          </Link>
          {canPrepareOffer && !run.archived_at && (
            <PublishOfferDraft jobId={draft.id} />
          )}
        </div>
      );
    if (run.archived_at) return null;
    if (!canPrepareOffer)
      return <p className="muted">{t("offerPermissionRequired")}</p>;
    const hasCompany = orgs.data.some(
      (org) => org.id === run.organisation_id && !org.archived_at,
    );
    if (hasCompany) return <CourseRunOfferLink runId={run.id} />;
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
      <div className="operations-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={!online}
          onClick={() => {
            if (detail) setParams({}, { replace: true });
            editRun(run, "organisation");
          }}
        >
          {t("assignOrganisationForOffer")}
        </Button>
      </div>
    );
  };
  const templateBlock = blocks.data?.find(
    (block) => block.id === templateDetail?.building_block_id,
  );
  const blockCodes = new Map(
    blocks.data?.map((block) => [block.id, block.code]),
  );
  const filteredTemplates = visibleTemplates.filter((template) =>
    [
      template.title,
      template.description,
      template.syllabus,
      blockCodes.get(template.building_block_id ?? ""),
    ]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title={t("courses")}
        description={t(companyViewer ? "companyCoursesIntro" : "coursesIntro")}
        action={
          (tab === "templates" ? canCreateTemplate : manage) ? (
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
          )
        }
      />
      {manage && (
        <details className="panel course-catalogue-guide">
          <summary>{t("courseCatalogueGuide")}</summary>
          <p>
            <strong>{t("courseCatalogueExampleTitle")}</strong>{" "}
            {t("courseCatalogueExample")}
          </p>
          <p>{t("courseCatalogueVisibility")}</p>
        </details>
      )}
      {manage && tab === "templates" && (
        <TableImport
          label={
            i18n.language.startsWith("de")
              ? "Kursvorlagen importieren"
              : "Import course templates"
          }
          filename="course-templates"
          columns={["title", "description", "syllabus", "prerequisites"]}
          example={[
            "Excel Grundlagen",
            "Einführung in Tabellen",
            "Formatierung und Formeln",
            "",
          ]}
          parse={(row) =>
            templateSchema.parse({ ...row, topic_ids: [], archived: false })
          }
          save={(row, key) => importTableRow(key, "course-template", row)}
          refresh={() => client.invalidateQueries({ queryKey: ["operations"] })}
        />
      )}
      {manage &&
        tab === "runs" &&
        templates.data.some((template) => !template.archived_at) && (
          <TableImport
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
              const matchingTemplates = templates.data.filter(
                (item) =>
                  !item.archived_at && item.title === row.template_title.trim(),
              );
              const companyName = row.company_name.trim();
              const companies = orgs.data.filter(
                (item) => !item.archived_at && item.name === companyName,
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
                sessions: [{ starts_at: row.starts_at, ends_at: row.ends_at }],
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
                (compareCourseInstants(ends_at, starts_at) ?? 0) <= 0
              )
                throw new Error("invalid course session");
              return { ...values, sessions: [{ starts_at, ends_at }] };
            }}
            save={(row, key) => importTableRow(key, "course-draft", row)}
            refresh={() =>
              client.invalidateQueries({ queryKey: ["operations"] })
            }
          />
        )}
      <div className="page-actions">
        {(manage || companyViewer) && tab === "runs" && (
          <Button asChild variant="secondary">
            <Link to="/courses?tab=templates">{t("openTemplateLibrary")}</Link>
          </Button>
        )}
        <Button asChild variant="secondary">
          <Link to="/learning?view=materials">
            {t("learning:materialLibrary")}
          </Link>
        </Button>
      </div>
      <section className="panel operations-toolbar">
        <Field id="course-search" label={t("search")}>
          <input
            id="course-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        {tab === "runs" && (
          <CoursePhaseFilter
            id="catalogue-course-phase"
            value={phase}
            onChange={setPhase}
          />
        )}
        {manage && tab === "runs" && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showArchivedRuns}
              onChange={(event) => setShowArchivedRuns(event.target.checked)}
            />
            {t("showArchivedRuns")}
          </label>
        )}
        <div className="segmented" role="group" aria-label={t("catalogue")}>
          <Button
            variant={tab === "runs" ? "default" : "ghost"}
            aria-pressed={tab === "runs"}
            onClick={() => setTab("runs")}
          >
            {t("runs")}
          </Button>
          {(manage || companyViewer) && (
            <Button
              variant={tab === "templates" ? "default" : "ghost"}
              aria-pressed={tab === "templates"}
              onClick={() => setTab("templates")}
            >
              {t("templates")}
            </Button>
          )}
        </div>
        <p className="course-catalogue-tab-help">
          {t(
            tab === "templates" && companyViewer
              ? "companyTemplateHelp"
              : `courseCatalogueTab.${tab}`,
          )}
        </p>
      </section>
      {message && (
        <Notice>
          {message}
          {savedRun && runs.data.some(({ id }) => id === savedRun) && (
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
            phase === "all"
              ? "learning:noCourses"
              : "learning:noCoursesInPhase",
          )}
        </div>
      ) : tab === "runs" ? (
        <div className="operations-courses-grid">
          {filteredRuns.map((run) => {
            const template = findTemplate(run);
            const { liveOffers, closedReason } = courseOfferState(
              run,
              runs.dataUpdatedAt,
            );
            return (
              <article className="panel operations-course" key={run.id}>
                <div className="section-heading">
                  <BookOpen className="blue" />
                  <span className="badge">
                    {t(
                      run.archived_at
                        ? "archive"
                        : liveOffers.length > 0
                          ? liveOffers.every(
                              (offer) =>
                                offer.company_internal ||
                                run.own_lecturers_only,
                            )
                            ? "listedCompany"
                            : "listedMarketplace"
                          : closedReason === "marketplaceDraft" ||
                              closedReason === "marketplaceMissing"
                            ? "draft"
                            : closedReason === "marketplaceAssigned"
                              ? "courseRunAssigned"
                              : "courseRunClosed",
                    )}
                  </span>
                </div>
                <h2>{template?.title ?? t("template")}</h2>
                {manage && (
                  <div className="course-marketplace-state">
                    {offerStatus(run)}
                    {marketplaceAction(run)}
                  </div>
                )}
                <p className="muted">
                  {orgs.data.find((org) => org.id === run.organisation_id)
                    ?.name ??
                    companyOrganisations.find(
                      (org) => org.id === run.organisation_id,
                    )?.name ??
                    t("noCustomer")}{" "}
                  · {t(run.delivery_type)}
                </p>
                <p>{template?.description}</p>
                <div className="tags">
                  {template?.course_template_topics.map((item) => {
                    const topic = topics.data.find(
                      (topic) => topic.id === item.topic_id,
                    );
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
                <Button
                  variant="secondary"
                  onClick={() => setParams({ run: run.id })}
                >
                  {t("view")}
                </Button>
                {manage && (
                  <div className="operations-actions">
                    <Button
                      variant="ghost"
                      disabled={!online}
                      onClick={() => editRun(run)}
                    >
                      {t("edit")}
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
                    <Button
                      variant="ghost"
                      disabled={!online}
                      onClick={() => {
                        duplicate.reset();
                        setCopy({
                          type: "run",
                          id: run.id,
                          title: template?.title ?? "",
                        });
                      }}
                    >
                      <Copy size={15} />
                      {t("duplicate")}
                    </Button>
                    <PermanentDeleteAction
                      shortLabel
                      kind="course_run"
                      id={run.id}
                      label={template?.title ?? t("courses")}
                      linkedJobs={run.jobs}
                      onReviewSessions={() => reviewSchedule(run)}
                    />
                  </div>
                )}
              </article>
            );
          })}
          {!filteredRuns.length && (
            <div className="panel empty-state">
              <BookOpen />
              <p>{t("empty")}</p>
            </div>
          )}
        </div>
      ) : companyViewer && ownCompanies.isPending ? (
        <Loading />
      ) : companyViewer && ownCompanies.isError ? (
        <ErrorState retry={() => void ownCompanies.refetch()} />
      ) : filteredTemplates.length === 0 ? (
        <div className="empty-state">{t("noCourseTemplates")}</div>
      ) : (
        <div className="operations-courses-grid">
          {filteredTemplates.map((template) => (
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
                {orgs.data.find(
                  (org) => org.id === template.owner_organisation_id,
                )?.name ??
                  ownCompanies.data?.find(
                    (org) => org.id === template.owner_organisation_id,
                  )?.name ??
                  (template.owner_organisation_id
                    ? t("templateOwner")
                    : t("internalTemplate"))}
              </p>
              <p>{template.description}</p>
              <div className="operations-actions">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setParams({ tab: "templates", template: template.id })
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
                      setCopyTitle(`${template.title} · ${t("copySuffix")}`);
                    }}
                  >
                    <Copy size={16} />
                    {t("duplicate")}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog
        open={templateEdit !== undefined}
        onOpenChange={(open) => {
          if (!open) setTemplateEdit(undefined);
        }}
        title={t(templateEdit ? "edit" : "newTemplate")}
        description={t("template")}
      >
        <TemplateForm
          key={templateEdit?.id}
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
        open={runEdit !== undefined}
        onOpenChange={(open) => {
          if (!open && !runSaving) setRunEdit(undefined);
        }}
        closeDisabled={runSaving}
        title={t(runEdit ? "edit" : "newCourse")}
        description={
          runEdit
            ? (findTemplate(runEdit)?.title ?? t("courseRecordUnavailable"))
            : t(
                initialTemplateId
                  ? "courseDraftFromTemplateHint"
                  : "publishedHint",
              )
        }
      >
        <RunForm
          key={runEdit?.id ?? `new:${initialTemplateId ?? "default"}`}
          original={runEdit ?? undefined}
          templates={manage ? templates.data : visibleTemplates}
          organisations={planningOrganisations}
          initialTemplateId={initialTemplateId}
          companyOnly={!manage}
          focusTarget={focusTarget}
          blocks={blocks.data ?? []}
          canPrepareOffer={canPrepareOffer}
          onBusy={setRunSaving}
          onDone={(result, offerRun, savedId) => {
            setRunEdit(undefined);
            setSavedRun(savedId);
            if (offerRun) {
              navigate(`/courses?offer=${encodeURIComponent(offerRun)}`);
              return;
            }
            setTab(result === "template" ? "templates" : "runs");
            if (initialTemplateId && !runEdit) {
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
          if (!open) setParams({ tab: "templates" }, { replace: true });
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
                    linkedRuns={runs.data
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
            {manage && templateBlock && (
              <BuildingBlockSources
                block={templateBlock}
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
        <p>{copy?.title}</p>
        {copy?.type === "template" && (
          <Field id="copy-title" label={t("copyTitle")}>
            <input
              id="copy-title"
              value={copyTitle}
              onChange={(e) => setCopyTitle(e.target.value)}
              maxLength={200}
            />
          </Field>
        )}
        <Button
          disabled={
            !online ||
            duplicate.isPending ||
            (copy?.type === "template" && !copyTitle.trim())
          }
          onClick={() => duplicate.mutate()}
        >
          {t("duplicate")}
        </Button>
        {duplicate.isError && <Notice kind="error">{t("error")}</Notice>}
      </Dialog>
      <Dialog
        open={Boolean(offerRunId)}
        onOpenChange={(open) => {
          if (!open) setParams({ run: offerRunId ?? "" }, { replace: true });
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
          if (!open) setParams({}, { replace: true });
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
                <>
                  <Button
                    disabled={!online}
                    onClick={() => {
                      setParams({}, { replace: true });
                      editRun(detail);
                    }}
                  >
                    {t("edit")}
                  </Button>
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
                </>
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
                {offerStatus(detail)}
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
