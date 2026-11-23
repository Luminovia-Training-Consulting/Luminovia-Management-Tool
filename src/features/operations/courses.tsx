import { PermanentDeleteAction } from "../deletions/deletions";
/**
 * Reusable templates and actual course runs with concrete sessions. Content, participant
 * management, course publication and job offers remain distinct operations.
 */
import { selectableTopics } from "../taxonomy/selection";
import "../taxonomy/i18n";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import "../learning/i18n";
import { courseWorkspaceEntitlementQuery } from "../learning/api";
import { ResourceComments } from "../comments/comments";
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
import { permissionsQuery, topicsQuery } from "../../lib/queries";
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
import {
  BuildingBlockCards,
  BuildingBlockReference,
  BuildingBlockSources,
  CourseRunOfferLink,
} from "./building-blocks";
import { weekdaySessions } from "./schedule";

import { courseTemplateFormSchema as templateSchema } from "./course-building-block-schema";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const runSchema = z.object({
  template_id: z.uuid(),
  organisation_id: z.string(),
  time_zone: z.string().refine(validZone),
  delivery_type: z.enum(["online", "onsite"]),
  venue: z.string().max(500),
  published: z.boolean(),
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
) {
  requireOnline();
  const { data, error } = await db().rpc("save_course_template", {
    p_id: id,
    p_payload: values,
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
                      {i18n.language === "de" ? topic.label_de : topic.label_en}
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
  onDone,
}: {
  original?: Template;
  onDone: () => void;
}) {
  const { t } = useTranslation("operations");
  const client = useQueryClient();
  const online = useOnline();
  const topics = useQuery(topicsQuery);
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
      saveCourseTemplate(values, original?.id ?? null),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["operations"] });
      onDone();
    },
  });
  if (topics.isPending) return <Loading />;
  if (topics.isError) return <ErrorState retry={() => void topics.refetch()} />;
  return (
    <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
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
      <Button disabled={!online || save.isPending}>{t("save")}</Button>
      {save.isError && (
        <Notice kind="error">
          {t(save.error.message === "course_locked" ? "locked" : "error")}
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
  blocks,
  onDone,
  onBusy,
}: {
  original?: CourseRun;
  templates: Template[];
  organisations: Organisation[];
  initialTemplateId?: string;
  blocks: BuildingBlock[];
  onDone: (result: "template" | "run") => void;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation("operations");
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
  const createdTemplate = useRef<{ id: string; value: string } | null>(null);
  const [timeError, setTimeError] = useState(false);
  const [planningDate, setPlanningDate] = useState("");
  const [planningStart, setPlanningStart] = useState("09:00");
  const [planningEnd, setPlanningEnd] = useState("17:00");
  const [planningError, setPlanningError] = useState(false);
  const [sessionOrigins] = useState(() => ({
    zone: original?.time_zone,
    sessions: new Map(
      original?.course_sessions.map((session) => [
        session.id,
        Object.freeze({ ...session }),
      ]) ?? [],
    ),
  }));
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof newCourseSchema>>({
    resolver: zodResolver(newCourseSchema),
    defaultValues: {
      template_id: original?.template_id ?? initialTemplateId ?? "",
      organisation_id: original?.organisation_id ?? "",
      time_zone: original?.time_zone ?? "Europe/Berlin",
      delivery_type: original?.delivery_type ?? "online",
      venue: original?.venue ?? "",
      published: original?.published ?? false,
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
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "sessions",
  });
  const selectedTemplateId = useWatch({ control, name: "template_id" });
  const selectedTemplate = templates.find(
    (item) => item.id === selectedTemplateId,
  );
  const selectedBlock = blocks.find(
    (item) => item.id === selectedTemplate?.building_block_id,
  );
  const needsContent = !original && !selectedTemplateId;
  const linkedJobs = original?.jobs ?? [];
  const linked = linkedJobs.length > 0;
  const hasActiveJob = linkedJobs.some(({ status }) => status === "published" || status === "filled");
  const save = useMutation({
    onMutate: () => onBusy(true),
    mutationFn: async (
      intent:
        | { kind: "template"; content: TemplateValues }
        | {
            kind: "run";
            values: z.infer<typeof newCourseSchema>;
            content?: TemplateValues;
          },
    ) => {
      requireOnline();
      setTimeError(false);
      if (intent.kind === "template") {
        await saveCourseTemplate(
          intent.content,
          createdTemplate.current?.id ?? null,
        );
        return "template" as const;
      }
      const { values } = intent;
      const sessions = values.sessions.map((s) => {
        const source = sessionOrigins.sessions.get(s.source_session_id ?? "");
        const start = zonedInstantForScheduleEdit(
          s.starts_at,
          values.time_zone,
          source?.starts_at,
          sessionOrigins.zone,
        );
        const end = zonedInstantForScheduleEdit(
          s.ends_at,
          values.time_zone,
          source?.ends_at,
          sessionOrigins.zone,
        );
        const unchanged =
          start === source?.starts_at && end === source?.ends_at;
        const order = start && end ? compareCourseInstants(end, start) : null;
        // Stored intervals already satisfy the database range constraint, even
        // below JavaScript's millisecond precision. Edited ranges are compared
        // as instants; ISO strings can legitimately contain different offsets.
        if (!start || !end || order === null || (!unchanged && order <= 0)) {
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
        const value = JSON.stringify(intent.content);
        const previous = createdTemplate.current;
        if (!previous || previous.value !== value) {
          const id = await saveCourseTemplate(
            intent.content,
            previous?.id ?? null,
          );
          if (!id) throw new Error("missing course template");
          createdTemplate.current = { id, value };
          setTemplateRetained(true);
        }
        templateId = createdTemplate.current!.id;
      }
      const { error } = await db().rpc("save_course_run", {
        p_id: original?.id ?? null,
        p_payload: { ...values, template_id: templateId, sessions },
      });
      if (error) throw error;
      return "run" as const;
    },
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ["operations"] });
      onDone(result);
    },
    onError: async () => {
      if (createdTemplate.current)
        await client.invalidateQueries({ queryKey: ["operations"] });
    },
    onSettled: () => onBusy(false),
  });

  const submitRun = (publish?: boolean) =>
    handleSubmit(async (values) => {
      if (save.isPending) return;
      const draft = !values.template_id
        ? await content.trigger(undefined, { shouldFocus: true })
        : true;
      if (!draft) return;
      const fields = !values.template_id
        ? templateSchema.parse(content.getValues())
        : undefined;
      save.mutate({
        kind: "run",
        values: { ...values, published: publish ?? values.published },
        content: fields,
      });
    });
  return (
    <form noValidate onSubmit={submitRun(original ? undefined : false)}>
      {linked && (
        <Notice>
          <p>{t("linkedRunHelp")}</p>
          <ul>
            {linkedJobs.map((job) => (
              <li key={job.id}><Link to={`/jobs/${job.id}`}>{job.title}</Link></li>
            ))}
          </ul>
        </Notice>
      )}
      <fieldset className="course-run-source-fields" disabled={linked}>
        <Field
          id="run-template"
          label={t("template")}
          error={Boolean(errors.template_id)}
        >
          <select id="run-template" {...register("template_id")}>
            {!original && <option value="">{t("newCourseContent")}</option>}
            {templates
              .filter(
                (template) =>
                  !template.archived_at || template.id === original?.template_id,
              )
              .map((template) => (
                <option value={template.id} key={template.id}>
                  {template.title}
                </option>
              ))}
          </select>
        </Field>
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
        {selectedBlock && !linked && (
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
        <Field id="run-org" label={t("organisation")}>
          <select id="run-org" {...register("organisation_id")}>
            <option value="">{t("none")}</option>
            {organisations.map((org) => (
              <option value={org.id} key={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-row">
          <Field
            id="run-zone"
            label={t("timezone")}
            error={Boolean(errors.time_zone)}
          >
            <input id="run-zone" {...register("time_zone")} />
          </Field>
          <Field id="run-delivery" label={t("delivery")}>
            <select id="run-delivery" {...register("delivery_type")}>
              <option value="online">{t("online")}</option>
              <option value="onsite">{t("onsite")}</option>
            </select>
          </Field>
        </div>
      </fieldset>
      <Field id="run-venue" label={t("venue")} error={Boolean(errors.venue)}>
        <input id="run-venue" {...register("venue")} />
      </Field>
      <fieldset className="operations-topic-field">
        <legend>{t("sessions")}</legend>
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
                readOnly={linked}
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
                readOnly={linked}
                {...register(`sessions.${index}.ends_at`)}
              />
            </Field>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`${t("remove")} ${index + 1}`}
              disabled={linked || fields.length < 2}
              onClick={() => remove(index)}
            >
              <Trash2 size={18} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={linked || fields.length >= 60}
          onClick={() => append({ starts_at: "", ends_at: "" })}
        >
          {t("addSession")}
        </Button>
      </fieldset>
      {original && (
        <fieldset className="course-run-visibility">
          <legend>{t("runVisibility")}</legend>
          <label className="checkbox-label">
            <input type="checkbox" {...register("published")} />
            {t("showInCourseCatalogue")}
          </label>
          <label className="checkbox-label">
            <input type="checkbox" disabled={hasActiveJob} {...register("archived")} />
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
              save.mutate({ kind: "template", content: values }),
            )}
          >
            {t("saveAsTemplate")}
          </Button>
        )}
        <Button
          type="submit"
          variant={original ? "default" : "secondary"}
          disabled={
            !online || save.isPending || (needsContent && !topics.isSuccess)
          }
        >
          {t(original ? "save" : "saveRunDraft")}
        </Button>
        {!original && (
          <Button
            type="button"
            disabled={
              !online || save.isPending || (needsContent && !topics.isSuccess)
            }
            onClick={submitRun(true)}
          >
            {t("publish")}
          </Button>
        )}
      </div>
      {save.isError && needsContent && templateRetained && (
        <Notice>{t("courseTemplateRetained")}</Notice>
      )}
      {save.isError && (
        <Notice kind="error">
          {t(
            timeError
              ? "timeInvalid"
              : save.error.message === "course_locked"
                ? "linkedRunConflict"
                : "error",
          )}
        </Notice>
      )}
    </form>
  );
}

/** Combine templates/runs with explicitly requested publication/copy actions. */
export function CoursesPage() {
  const { t, i18n } = useTranslation("operations");
  const { session } = useAuth();
  const actor = session!.user.id;
  const permissions = useQuery(permissionsQuery(actor));
  const templates = useQuery(templatesQuery(actor));
  const manage = permissions.data?.includes("courses.manage") ?? false;
  const runs = useQuery({
    ...runsQuery(actor),
    refetchInterval: manage ? false : 10000,
    refetchOnMount: manage ? true : "always",
  });
  const orgs = useQuery(orgQuery(actor));
  const topics = useQuery(topicsQuery);
  const blocks = useQuery(buildingBlocksQuery(actor));
  const client = useQueryClient();
  const online = useOnline();
  const [search, setSearch] = useState("");
  const [phase, setPhase] = useState<CoursePhaseSelection>("all");
  const [tab, setTab] = useState<"runs" | "templates" | "blocks">("runs");
  const [initialTemplateId, setInitialTemplateId] = useState<string>();
  const [templateEdit, setTemplateEdit] = useState<Template>();
  const [runEdit, setRunEdit] = useState<CourseRun | null | undefined>();
  const [runSaving, setRunSaving] = useState(false);
  const [params, setParams] = useSearchParams();
  const detail = runs.data?.find((run) => run.id === params.get("run"));
  const workspaceEntitlement = useQuery({
    ...courseWorkspaceEntitlementQuery(actor, detail?.id ?? ""),
    enabled: Boolean(detail && !detail.archived_at),
  });
  const templateDetail = templates.data?.find(
    (template) => template.id === params.get("template"),
  );
  const blockDetail = blocks.data?.find(
    (block) => block.id === params.get("block"),
  );
  const planRun = (templateId: string) => {
    setInitialTemplateId(templateId);
    setParams({});
    setRunEdit(null);
  };
  const [copy, setCopy] = useState<{
    type: "template" | "run";
    id: string;
    title: string;
  }>();
  const [copyTitle, setCopyTitle] = useState("");
  const [message, setMessage] = useState("");
  const visibility = useMutation({
    mutationFn: async ({
      run,
      published,
      archived,
    }: {
      run: CourseRun;
      published: boolean;
      archived: boolean;
    }) => {
      requireOnline();
      const { error } = await db().rpc("set_course_visibility", {
        p_id: run.id,
        p_published: published,
        p_archived: archived,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["operations"] });
      setMessage(t("visibilitySaved"));
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
    blocks.isPending
  )
    return <Loading />;
  if (
    templates.isError ||
    runs.isError ||
    orgs.isError ||
    topics.isError ||
    permissions.isError ||
    blocks.isError
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
  const filteredTemplates = templates.data.filter((template) =>
    [template.title, template.description, template.syllabus]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const filteredBlocks = blocks.data.filter((block) =>
    [block.code, block.title, block.syllabus]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title={t("courses")}
        description={t("coursesIntro")}
        action={
          manage ? (
            <Button
              disabled={!online}
              onClick={() => {
                setInitialTemplateId(undefined);
                setRunEdit(null);
              }}
            >
              <Plus size={17} />
              {t("newCourse")}
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link to="/learning">{t("translation:myCourses")}</Link>
            </Button>
          )
        }
      />
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
        <div className="segmented" role="group" aria-label={t("catalogue")}>
          <Button
            variant={tab === "runs" ? "default" : "ghost"}
            onClick={() => setTab("runs")}
          >
            {t("runs")}
          </Button>
          {manage && (
            <Button
              variant={tab === "templates" ? "default" : "ghost"}
              onClick={() => setTab("templates")}
            >
              {t("templates")}
            </Button>
          )}
          {blocks.data.length > 0 && (
            <Button
              variant={tab === "blocks" ? "default" : "ghost"}
              onClick={() => setTab("blocks")}
            >
              {t("buildingBlocks")}
            </Button>
          )}
        </div>
        {manage && <p className="muted">{t("publishedHint")}</p>}
      </section>
      {message && <Notice>{message}</Notice>}
      {visibility.isError && (
        <Notice kind="error">
          {t(visibility.error.message === "course_locked" ? "locked" : "error")}
        </Notice>
      )}
      {tab === "blocks" ? (
        <BuildingBlockCards
          blocks={filteredBlocks}
          canManage={manage}
          online={online}
          onView={(id) => setParams({ block: id })}
          onPlan={planRun}
        />
      ) : tab === "runs" && filteredRuns.length === 0 ? (
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
            const hasActiveJob = run.jobs?.some(({ status }) => status === "published" || status === "filled");
            return (
              <article className="panel operations-course" key={run.id}>
                <div className="section-heading">
                  <BookOpen className="blue" />
                  <span className="badge">
                    {t(
                      run.archived_at
                        ? "archive"
                        : hasActiveJob
                          ? "activeRunOrder"
                          : run.published
                            ? "published"
                            : "draft",
                    )}
                  </span>
                </div>
                <h2>{template?.title ?? t("template")}</h2>
                <p className="muted">
                  {orgs.data.find((org) => org.id === run.organisation_id)
                    ?.name ?? t("noCustomer")}{" "}
                  · {t(run.delivery_type)}
                </p>
                <p>{template?.description}</p>
                {template?.building_block_id && (
                  <span className="badge">
                    {t("buildingBlocks")}{" "}
                    {
                      blocks.data.find(
                        (block) => block.id === template.building_block_id,
                      )?.code
                    }
                  </span>
                )}
                <div className="tags">
                  {template?.course_template_topics.map((item) => {
                    const topic = topics.data.find(
                      (topic) => topic.id === item.topic_id,
                    );
                    return topic ? (
                      <span className="badge" key={topic.id}>
                        {i18n.language === "de"
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
                    {!run.archived_at && <CourseRunOfferLink runId={run.id} />}
                    <Button
                      variant="ghost"
                      disabled={!online}
                      onClick={() => setRunEdit(run)}
                    >
                      {t("edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!online || visibility.isPending}
                      onClick={() =>
                        visibility.mutate({
                          run,
                          published: !run.published,
                          archived: Boolean(run.archived_at),
                        })
                      }
                    >
                      {t(
                        run.published ? "hideFromCourseCatalogue" : "showInCourseCatalogue",
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!online || visibility.isPending}
                      onClick={() =>
                        visibility.mutate({
                          run,
                          published: run.published,
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
                      kind="course_run"
                      id={run.id}
                      label={template?.title ?? t("courses")}
                      linkedJobs={run.jobs}
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
      ) : (
        <div className="operations-courses-grid">
          {filteredTemplates.map((template) => (
            <article className="panel operations-course" key={template.id}>
              <h2>{template.title}</h2>
              {template.archived_at && (
                <span className="badge">{t("archive")}</span>
              )}
              <p>{template.description}</p>
              <div className="operations-actions">
                <Button
                  variant="secondary"
                  onClick={() => setParams({ template: template.id })}
                >
                  {t("view")}
                </Button>
                {!template.archived_at && (
                  <Button
                    disabled={!online}
                    onClick={() => planRun(template.id)}
                  >
                    {t("planRun")}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={!online}
                  onClick={() => setTemplateEdit(template)}
                >
                  {t("edit")}
                </Button>
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
        title={t("edit")}
        description={t("template")}
      >
        <TemplateForm
          key={templateEdit?.id}
          original={templateEdit}
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
        description={t("publishedHint")}
      >
        <RunForm
          key={runEdit?.id ?? `new:${initialTemplateId ?? "default"}`}
          original={runEdit ?? undefined}
          templates={templates.data}
          organisations={orgs.data}
          initialTemplateId={initialTemplateId}
          blocks={blocks.data}
          onBusy={setRunSaving}
          onDone={(result) => {
            setRunEdit(undefined);
            setTab(result === "template" ? "templates" : "runs");
            setMessage(t("saved"));
          }}
        />
      </Dialog>
      <Dialog
        open={Boolean(templateDetail || blockDetail)}
        onOpenChange={(open) => {
          if (!open) setParams({}, { replace: true });
        }}
        title={
          templateDetail?.title ??
          (blockDetail
            ? `${blockDetail.code} · ${blockDetail.title}`
            : t("template"))
        }
        description={t("reusableBlock")}
      >
        {(templateDetail || blockDetail) && (
          <>
            <h3>{t("description")}</h3>
            <p className="curriculum-syllabus">
              {templateDetail?.description ?? blockDetail?.description}
            </p>
            <h3>{t("syllabus")}</h3>
            <p className="curriculum-syllabus">
              {templateDetail?.syllabus ?? blockDetail?.syllabus}
            </p>
            {(templateDetail?.prerequisites || blockDetail?.prerequisites) && (
              <>
                <h3>{t("prerequisites")}</h3>
                <p className="curriculum-syllabus">
                  {templateDetail?.prerequisites ?? blockDetail?.prerequisites}
                </p>
              </>
            )}
            {templateDetail ? (
              <BuildingBlockReference
                buildingBlockId={templateDetail.building_block_id}
                sourceId={templateDetail.building_block_source_id}
              />
            ) : (
              blockDetail && <BuildingBlockSources block={blockDetail} />
            )}
            {manage && (
              <Button
                disabled={!online}
                onClick={() =>
                  planRun(
                    templateDetail?.id ?? blockDetail!.default_template_id,
                  )
                }
              >
                {t("planRun")}
              </Button>
            )}
            {templateDetail && (
              <PermanentDeleteAction
                kind="course_template"
                id={templateDetail.id}
                label={templateDetail.title}
              />
            )}
            <ResourceComments
              kind="template"
              resourceId={
                templateDetail?.id ?? blockDetail!.default_template_id
              }
            />
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
        open={Boolean(detail)}
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
                      setRunEdit(detail);
                    }}
                  >
                    {t("edit")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!online || visibility.isPending}
                    onClick={() =>
                      visibility.mutate({
                        run: detail,
                        published: detail.published,
                        archived: !detail.archived_at,
                      })
                    }
                  >
                    {t(detail.archived_at ? "restore" : "archiveAction")}
                  </Button>
                </>
              )}
              <PermanentDeleteAction
                kind="course_run"
                id={detail.id}
                label={findTemplate(detail)?.title ?? t("courses")}
                linkedJobs={detail.jobs}
              />
            </div>
            <BuildingBlockReference
              buildingBlockId={findTemplate(detail)?.building_block_id}
              sourceId={findTemplate(detail)?.building_block_source_id}
            />
            {manage && !detail.archived_at && (
              <CourseRunOfferLink runId={detail.id} />
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
            <ol className="session-list">
              {[...detail.course_sessions]
                .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                .map((s) => (
                  <li key={s.id}>
                    <CalendarDays size={18} />
                    <div>
                      <strong>
                        {dateTime(s.starts_at, i18n.language, detail.time_zone)}
                      </strong>
                      <span>
                        {dateTime(s.ends_at, i18n.language, detail.time_zone)}
                      </span>
                    </div>
                  </li>
                ))}
            </ol>
            <p>
              {detail.time_zone} · {detail.venue}
            </p>
          </>
        )}
      </Dialog>
    </>
  );
}
