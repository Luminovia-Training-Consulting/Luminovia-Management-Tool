import { PermanentDeleteAction } from "../deletions/deletions";
/**
 * Reusable templates and actual course runs with concrete sessions. Content, participant
 * management, course publication and job offers remain distinct operations.
 */
import { selectableTopics } from "../taxonomy/selection";
import "../taxonomy/i18n";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import "../learning/i18n";
import { courseWorkspaceEntitlementQuery } from "../learning/api";
import { ResourceComments } from "../comments/comments";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BookOpen, CalendarDays, Copy, Plus, Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import "./i18n";
import "./styles.css";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery, topicsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { dateTime, validZone, zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
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

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const templateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(12000),
  syllabus: z.string().max(30000),
  prerequisites: z.string().max(8000),
  topic_ids: z.array(z.string()),
  archived: z.boolean(),
});
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

/** Edit reusable content templates separately from particular customers and schedules. */
function TemplateForm({
  original,
  onDone,
}: {
  original?: Template;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation("operations");
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
    mutationFn: async (values: z.infer<typeof templateSchema>) => {
      requireOnline();
      const { error } = await db().rpc("save_course_template", {
        p_id: original?.id ?? null,
        p_payload: values,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["operations"] });
      onDone();
    },
  });
  if (topics.isPending) return <Loading />;
  if (topics.isError) return <ErrorState retry={() => void topics.refetch()} />;
  return (
    <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
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
      <fieldset className="operations-topic-field">
        <legend>{t("topics")}</legend>
        {selectableTopics(topics.data, selectedTopicIds).map((topic) => (
          <label className="checkbox-label" key={topic.id}>
            <input
              type="checkbox"
              value={topic.id}
              {...register("topic_ids")}
            />
            {i18n.language === "de" ? topic.label_de : topic.label_en}
            {topic.archived_at && <> ({t("taxonomy:archived")})</>}
          </label>
        ))}
      </fieldset>
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
}: {
  original?: CourseRun;
  templates: Template[];
  organisations: Organisation[];
  initialTemplateId?: string;
  blocks: BuildingBlock[];
  onDone: () => void;
}) {
  const { t } = useTranslation("operations");
  const online = useOnline();
  const client = useQueryClient();
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
  } = useForm<z.infer<typeof runSchema>>({
    resolver: zodResolver(runSchema),
    defaultValues: {
      template_id:
        original?.template_id ?? initialTemplateId ?? templates[0]?.id ?? "",
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
  const save = useMutation({
    mutationFn: async (values: z.infer<typeof runSchema>) => {
      requireOnline();
      setTimeError(false);
      const sessions = values.sessions.map((s) => {
        const source = sessionOrigins.sessions.get(s.source_session_id ?? "");
        const endpoint = (
          input: string,
          originalInstant: string | undefined,
        ) => {
          const previous = originalInstant
            ? DateTime.fromISO(originalInstant)
            : null;
          // The minute editor cannot express original seconds/microseconds or
          // identify a DST-fold offset. Keep that already-known instant until
          // this endpoint or its intended zone is actually changed.
          return previous?.isValid &&
            values.time_zone === sessionOrigins.zone &&
            previous
              .setZone(values.time_zone)
              .toFormat("yyyy-MM-dd'T'HH:mm") === input
            ? originalInstant!
            : zonedInstant(input, values.time_zone);
        };
        const start = endpoint(s.starts_at, source?.starts_at);
        const end = endpoint(s.ends_at, source?.ends_at);
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
      const { error } = await db().rpc("save_course_run", {
        p_id: original?.id ?? null,
        p_payload: { ...values, sessions },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["operations"] });
      onDone();
    },
  });
  return (
    <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
      <Field
        id="run-template"
        label={t("template")}
        error={Boolean(errors.template_id)}
      >
        <select id="run-template" {...register("template_id")}>
          <option value="">—</option>
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
      {selectedBlock && (
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
        <Button
          type="button"
          variant="secondary"
          disabled={fields.length >= 60}
          onClick={() => append({ starts_at: "", ends_at: "" })}
        >
          {t("addSession")}
        </Button>
      </fieldset>
      <label className="checkbox-label">
        <input type="checkbox" {...register("published")} />
        {t("published")}
      </label>
      <label className="checkbox-label">
        <input type="checkbox" {...register("archived")} />
        {t("archive")}
      </label>
      <Button disabled={!online || save.isPending}>{t("save")}</Button>
      {save.isError && (
        <Notice kind="error">
          {t(
            timeError
              ? "timeInvalid"
              : save.error.message === "course_locked"
                ? "locked"
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
  const runs = useQuery(runsQuery(actor));
  const orgs = useQuery(orgQuery(actor));
  const topics = useQuery(topicsQuery);
  const blocks = useQuery(buildingBlocksQuery(actor));
  const client = useQueryClient();
  const online = useOnline();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"runs" | "templates" | "blocks">("runs");
  const [initialTemplateId, setInitialTemplateId] = useState<string>();
  const [templateEdit, setTemplateEdit] = useState<
    Template | null | undefined
  >();
  const [runEdit, setRunEdit] = useState<CourseRun | null | undefined>();
  const [params, setParams] = useSearchParams();
  const detail = runs.data?.find((run) => run.id === params.get("run"));
  const workspaceEntitlement = useQuery({
    ...courseWorkspaceEntitlementQuery(actor, detail?.id ?? ""),
    enabled: Boolean(detail),
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
  const manage = permissions.data?.includes("courses.manage") ?? false;
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
  const filteredRuns = runs.data.filter((run) =>
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
          manage && (
            <div className="operations-actions">
              <Button
                variant="secondary"
                disabled={!online}
                onClick={() => setTemplateEdit(null)}
              >
                <Plus size={17} />
                {t("newTemplate")}
              </Button>
              <Button
                disabled={!online || !templates.data.length}
                onClick={() => {
                  setInitialTemplateId(undefined);
                  setRunEdit(null);
                }}
              >
                <Plus size={17} />
                {t("newRun")}
              </Button>
            </div>
          )
        }
      />
      <section className="panel operations-toolbar">
        <Field id="course-search" label={t("search")}>
          <input
            id="course-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
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
        <p className="muted">{t("publishedHint")}</p>
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
      ) : tab === "runs" ? (
        <div className="operations-courses-grid">
          {filteredRuns.map((run) => {
            const template = findTemplate(run);
            return (
              <article className="panel operations-course" key={run.id}>
                <div className="section-heading">
                  <BookOpen className="blue" />
                  <span className="badge">
                    {t(
                      run.archived_at
                        ? "archive"
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
                      {t(run.published ? "unpublish" : "publish")}
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
        title={t(templateEdit ? "edit" : "newTemplate")}
        description={t("template")}
      >
        <TemplateForm
          key={templateEdit?.id ?? "new"}
          original={templateEdit ?? undefined}
          onDone={() => {
            setTemplateEdit(undefined);
            setMessage(t("saved"));
          }}
        />
      </Dialog>
      <Dialog
        open={runEdit !== undefined}
        onOpenChange={(open) => {
          if (!open) setRunEdit(undefined);
        }}
        title={t(runEdit ? "edit" : "newRun")}
        description={t("publishedHint")}
      >
        <RunForm
          key={runEdit?.id ?? `new:${initialTemplateId ?? "default"}`}
          original={runEdit ?? undefined}
          templates={templates.data}
          organisations={orgs.data}
          initialTemplateId={initialTemplateId}
          blocks={blocks.data}
          onDone={() => {
            setRunEdit(undefined);
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
              />
            </div>
            <BuildingBlockReference
              buildingBlockId={findTemplate(detail)?.building_block_id}
              sourceId={findTemplate(detail)?.building_block_source_id}
            />
            {manage && !detail.archived_at && (
              <CourseRunOfferLink runId={detail.id} />
            )}
            {workspaceEntitlement.isPending ? (
              <Loading />
            ) : workspaceEntitlement.data?.lms_enabled ? (
              <Button asChild variant="secondary">
                <Link to={`/courses/${detail.id}/workspace`}>
                  {t("learning:openWorkspace")}
                </Link>
              </Button>
            ) : workspaceEntitlement.isError ? (
              <Notice>{t("workspaceUnavailable")}</Notice>
            ) : (
              <span className="badge">
                {t("learning:premiumOffCourseBadge")}
              </span>
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
