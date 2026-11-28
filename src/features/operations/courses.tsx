import {
  CourseBulkArchiveActions,
  CourseBulkArchiveSelection,
} from "./course-bulk-archive";
import { useCourseBulkArchive } from "./use-course-bulk-archive";
import { LoadMore } from "../../components/load-more";
import { CourseTimeline } from "../../components/course-timeline";
import { PermanentDeleteAction } from "../deletions/deletions";
/**
 * Reusable templates and actual course runs with concrete sessions. Content, participant
 * management and versioned publication of linked teaching offers.
 */
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
import { PublishOfferDraft } from "../jobs/publish-draft";
import { CoursePhaseFilter } from "../learning/course-phase-filter";
import {
  scheduledCourseSummary,
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
} from "lucide-react";
import "./i18n";
import "./styles.css";
import { useAuth } from "../auth/auth-context";
import { clientOrganisationsQuery } from "../commercial/commission-api";
import {
  permissionsQuery,
  topicsQuery,
  userRolesQuery,
} from "../../lib/queries";
import { calendarCourseSchedule } from "../../lib/course-calendar-link";
import { db } from "../../lib/supabase";
import {
  dateTime,
  zonedInstantForScheduleEdit,
  compareScheduleInstants,
  dateTimeOrNull,
  validZone,
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
  orgQuery,
  runsQuery,
  type Template,
  templatesQuery,
} from "./data";
import { BuildingBlockReference, CourseRunOfferLink } from "./building-blocks";
import "./course-creator-drafts-i18n";
import {
  courseCreatorDraftId,
  courseCreatorDraftsQuery,
  type CourseCreatorDraft,
} from "./course-creator-drafts-api";
import { CourseSeriesForm } from "./course-series";

import { courseTemplateFormSchema as templateSchema } from "./course-building-block-schema";

const CourseCreatorDraftLibrary = lazy(() =>
  import("./course-creator-drafts").then(({ CourseCreatorDraftLibrary }) => ({
    default: CourseCreatorDraftLibrary,
  })),
);
const CourseReuseForm = lazy(() =>
  import("./course-reuse").then((module) => ({
    default: module.CourseReuseForm,
  })),
);

const CourseSeriesRevision = lazy(() => import("./course-series-revision"));

const CourseOfferForm = lazy(() =>
  import("../admin/admin").then(({ CourseOfferForm }) => ({
    default: CourseOfferForm,
  })),
);

import { runSchema } from "./course-editor-schema";

const RunForm = lazy(() =>
  import("./course-editor").then(({ RunForm }) => ({ default: RunForm })),
);
const TemplateForm = lazy(() =>
  import("./course-editor").then(({ TemplateForm }) => ({
    default: TemplateForm,
  })),
);

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
  const scopeReady = permissions.isSuccess && roles.isSuccess;
  const companyViewer = !manage && roles.data?.includes("client");
  const ownCompanies = useQuery({
    ...clientOrganisationsQuery(actor),
    enabled: scopeReady && Boolean(companyViewer),
  });
  const client = useQueryClient();
  const online = useOnline();
  const [search, setSearch] = useState("");
  const searchField = useRef<HTMLInputElement>(null);
  const needle = useDeferredValue(search).trim().toLowerCase();
  const [phase, setPhase] = useState<CoursePhaseSelection>("all");
  const [runStatus, setRunStatus] = useState("all");
  const [lecturer, setLecturer] = useState("");
  const [templateEdit, setTemplateEdit] = useState<Template | null>();
  const [seriesTemplate, setSeriesTemplate] = useState<Template | null>();
  const [seriesBusy, setSeriesBusy] = useState(false);
  const [seriesResults, setSeriesResults] = useState<string[]>([]);
  const [runEdit, setRunEdit] = useState<CourseRun | null | undefined>();
  const [runSaving, setRunSaving] = useState(false);
  const [focusTarget, setFocusTarget] = useState<"schedule" | "organisation">();
  const [params, setParams] = useSearchParams();
  const creatorText = useTranslation("courseCreator").t;
  const creatorRoute = params.get("creator");
  const requestedCreatorId = courseCreatorDraftId.safeParse(creatorRoute).data;
  const creatorId = manage || companyViewer ? requestedCreatorId : undefined;
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
  // A company library already has its owner names. Taxonomy is needed by run
  // cards and is loaded separately by editors when their fields are opened.
  const needsOrganisationDirectory = manage || tab === "runs";
  const needsTopics = tab === "runs";
  const orgs = useQuery({
    ...orgQuery(actor),
    enabled: scopeReady && needsOrganisationDirectory,
  });
  const topics = useQuery({
    ...topicsQuery,
    enabled: scopeReady && needsTopics,
  });
  const recoveredCompany = companyViewer
    ? companyOrganisations.find(
        ({ id }) => id === creatorRecord?.payload?.run.organisation_id,
      )
    : undefined;
  const recoveredCompanyTemplates = useQuery({
    ...templatesQuery(actor, recoveredCompany?.id ?? ""),
    enabled: Boolean(
      creatorId &&
      recoveredCompany &&
      recoveredCompany.id !== templateCompanyId,
    ),
  });
  const companyLibrary = useQuery({
    ...templatesQuery(actor, templateCompanyId),
    enabled: Boolean(templateCompanyId),
  });
  // The run overview still needs authorized run titles across memberships, but
  // it is not a source of company library options or of scoped detail records.
  const useRunMetadata = !companyViewer || tab === "runs" || params.has("run");
  const templates = useQuery({
    ...templatesQuery(actor),
    enabled: scopeReady && useRunMetadata,
  });
  // Only the manager's template deletion preview needs linked runs.
  const needsRuns =
    tab === "runs" || params.has("run") || (manage && params.has("template"));
  const runs = useQuery({
    ...runsQuery(actor, canPrepareOffer),
    // Choose the projection once permissions resolve. Otherwise staff first
    // download the basic catalogue and then request it again with assignments.
    enabled: scopeReady && needsRuns,
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
  const editId = params.get("editRun");
  const editedRun =
    runEdit !== undefined
      ? runEdit
      : runs.data?.find((run) => run.id === editId && !run.archived_at);

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
    // Keep the validated template in the URL until the first acknowledged save.
    setCourseView({
      tab: "templates",
      creator: crypto.randomUUID(),
      startCreator: "1",
      creatorTemplate: templateId,
      ...(!manage && templateCompanyId ? { company: templateCompanyId } : {}),
    });
  };
  const [copy, setCopy] = useState<
    | { type: "template"; id: string; title: string }
    | { type: "run"; id: string; title: string; run: CourseRun }
  >();
  const [copyTitle, setCopyTitle] = useState("");
  const [message, setMessage] = useState("");
  const [savedRun, setSavedRun] = useState<string>();
  const bulkItem = (run: CourseRun) => ({
    id: run.id,
    title: templatesById.get(run.template_id)?.title ?? t("courses"),
    published: run.published,
    archived_at: run.archived_at,
    organisation_id: run.organisation_id,
    organisation_name: organisationName(run.organisation_id) ?? t("noCustomer"),
    starts_at: run.course_sessions[0]?.starts_at ?? null,
    time_zone: run.time_zone,
  });
  const bulkArchive = useCourseBulkArchive(
    (runs.data ?? []).map(bulkItem),
    () => setMessage(t("archiveSaved")),
  );
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
        ...scheduledCourseSummary(run.course_sessions, runs.dataUpdatedAt),
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
    (needsOrganisationDirectory && orgs.isError) ||
    (needsTopics && topics.isError) ||
    permissions.isError
  )
    return (
      <ErrorState
        retry={() => {
          if (scopeReady && useRunMetadata) void templates.refetch();
          if (templateCompany) void companyLibrary.refetch();
          if (companyViewer) void ownCompanies.refetch();
          void roles.refetch();
          if (scopeReady && needsRuns) void runs.refetch();
          if (scopeReady && needsOrganisationDirectory) void orgs.refetch();
          if (scopeReady && needsTopics) void topics.refetch();
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
    (needsOrganisationDirectory && orgs.isPending) ||
    (needsTopics && topics.isPending) ||
    permissions.isPending
  )
    return <Loading />;
  const findTemplate = (run: CourseRun) => templatesById.get(run.template_id);
  const creatorTemplate =
    creatorId && creatorFresh && !creatorRecord
      ? visibleTemplates.find(
          (template) =>
            template.id === creatorTemplateParam && !template.archived_at,
        )
      : undefined;
  const creatorSourceUnavailable =
    creatorFresh &&
    (creatorTemplateParam !== null || !manage) &&
    !creatorRecord &&
    !creatorTemplate;
  const directoryOrganisations = orgs.data ?? [];
  const planningOrganisations = manage
    ? directoryOrganisations
    : templateCompany
      ? [templateCompany]
      : [];
  // A browser history change can switch scope without using the company picker.
  const mayOpenTemplateEditor =
    canCreateTemplate && (!templateEdit || canEditTemplate(templateEdit));
  const mayOpenSeries =
    canCreateTemplate && (!seriesTemplate || canManageTemplate(seriesTemplate));
  const mayOpenRunEditor = manage;
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
    if (!directoryOrganisations.some((org) => !org.archived_at)) {
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
  const resetList = () => {
    setSearch("");
    if (tab === "runs") {
      setPhase("all");
      setLecturer("");
      setRunStatus("all");
      if (manage && company) {
        const next = new URLSearchParams(params);
        next.delete("company");
        setParams(next, { replace: true });
      }
    }
    searchField.current?.focus();
  };
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
            {manage &&
              tab === "runs" &&
              visibleTemplates.some((template) => !template.archived_at) && (
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
                    const companies = directoryOrganisations.filter(
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
                      (compareScheduleInstants(ends_at, starts_at) ?? 0) <= 0
                    )
                      throw new Error("invalid course session");
                    return {
                      ...values,
                      sessions: [{ starts_at, ends_at }],
                    };
                  }}
                  save={(row, key) => importTableRow(key, "course-draft", row)}
                  refresh={() =>
                    client.invalidateQueries({ queryKey: ["operations"] })
                  }
                />
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
              </div>
            </details>
          </div>
        }
      />
      {(manage ? tab === "runs" : Boolean(templateCompanyId)) && (
        <Suspense fallback={<Loading />}>
          <CourseCreatorDraftLibrary
            actor={actor}
            courseOnly={!manage}
            onStart={manage ? startCreator : undefined}
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
              ref={searchField}
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
                      {directoryOrganisations.map(({ id, name }) => (
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
      {manage && tab === "runs" && (
        <CourseBulkArchiveActions controls={bulkArchive} />
      )}
      {total === 0 ? (
        <div className="empty-state">
          <p role="status">
            {t(
              needle || (tab === "runs" && manage && company)
                ? "courseNoMatches"
                : tab === "templates"
                  ? "noCourseTemplates"
                  : onlyAssignedRuns
                    ? "noAssignedRuns"
                    : selectedRunStatus !== "all"
                      ? "noCoursesWithStatus"
                      : phase === "all"
                        ? "learning:noCourses"
                        : "learning:noCoursesInPhase",
            )}
          </p>
          {(needle || (tab === "runs" && activeFilters > 0)) && (
            <Button type="button" variant="secondary" onClick={resetList}>
              {t("courseResetList")}
            </Button>
          )}
        </div>
      ) : tab === "runs" ? (
        <div className="operations-courses-grid">
          {filteredRuns.slice(0, shownCount).map(({ run, status, first }) => {
            const template = findTemplate(run);
            const jobs = run.jobs ?? [];
            const offers = courseOfferState(run, runs.dataUpdatedAt);
            const { liveOffers, closedReason } = offers;
            const firstLabel =
              first && validZone(run.time_zone)
                ? dateTimeOrNull(
                    first.instant,
                    i18n.language,
                    run.time_zone,
                    "short",
                  )
                : null;
            const customer =
              organisationName(run.organisation_id) ?? t("noCustomer");
            return (
              <article className="panel operations-course" key={run.id}>
                {manage && (
                  <CourseBulkArchiveSelection
                    item={bulkItem(run)}
                    controls={bulkArchive}
                  />
                )}

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
                  <CalendarDays size={17} aria-hidden="true" />
                  <span>
                    {first && firstLabel && (
                      <>
                        <time dateTime={first.iso}>{firstLabel}</time>
                        {" · "}
                      </>
                    )}
                    {t("courseSessionCount", {
                      count: run.course_sessions.length,
                    })}
                    {first && ` · ${run.time_zone}`}
                  </span>
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
        open={mayOpenSeries && seriesTemplate !== undefined && !offerRunId}
        closeDisabled={seriesBusy}
        onOpenChange={(open) => {
          if (!open && !seriesBusy) {
            setSeriesTemplate(undefined);
            setSeriesResults([]);
          }
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
            canPrepareOffer={canPrepareOffer}
            savedRuns={seriesResults}
            onSaved={setSeriesResults}
            defaultOrganisation={
              seriesTemplate?.owner_organisation_id ??
              (planningOrganisations.length === 1
                ? planningOrganisations[0].id
                : "")
            }
            onOpen={() => {
              setSeriesTemplate(undefined);
              setSeriesResults([]);
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
        <Suspense fallback={<Loading />}>
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
        </Suspense>
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
        title={creatorText(manage ? "start" : "startCourse")}
        description={creatorText(
          manage ? "offerHint" : "courseDraftDescription",
        )}
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
          ) : recoveredCompany &&
            recoveredCompany.id !== templateCompanyId &&
            recoveredCompanyTemplates.isPending ? (
            <Loading />
          ) : recoveredCompanyTemplates.isError ? (
            <ErrorState
              retry={() => void recoveredCompanyTemplates.refetch()}
            />
          ) : !manage &&
            creatorRecord?.state === "editing" &&
            !recoveredCompany ? (
            <Notice kind="error">{t("courseRecordUnavailable")}</Notice>
          ) : creatorRecord?.state === "editing" || creatorFresh ? (
            <Suspense fallback={<Loading />}>
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
                templates={
                  recoveredCompany && recoveredCompany.id !== templateCompanyId
                    ? (recoveredCompanyTemplates.data ?? [])
                    : visibleTemplates
                }
                organisations={
                  recoveredCompany ? [recoveredCompany] : planningOrganisations
                }
                companyOnly={!manage}
                canPrepareOffer={canPrepareOffer}
                canReadBlockPlanning={manage}
                onBusy={setRunSaving}
                onDone={(_result, offer, run) => {
                  if (creatorRecord?.from_enquiry) {
                    void client.invalidateQueries({
                      queryKey: ["enquiry-detail", actor],
                    });
                    void client.invalidateQueries({
                      queryKey: ["enquiry-inbox", actor],
                    });
                  }
                  if (run) setSavedRun(run);
                  setCourseView(offer ? { offer } : {});
                  if (!offer) setMessage(t("courseDraftCreated"));
                }}
              />
            </Suspense>
          ) : (
            <Notice kind="error">{creatorText("error")}</Notice>
          ))}
      </Dialog>
      <Dialog
        open={
          mayOpenRunEditor &&
          (editedRun !== undefined || Boolean(calendarPlan && !creatorRoute))
        }
        onOpenChange={(open) => {
          if (!open && !runSaving) {
            setRunEdit(undefined);
            if (editId) setCourseView({ run: editId }, true);
            else if (calendarPlan) setCourseView({}, true);
          }
        }}
        closeDisabled={runSaving}
        title={t(editedRun ? "edit" : "newCourse")}
        description={
          editedRun
            ? (findTemplate(editedRun)?.title ?? t("courseRecordUnavailable"))
            : t("publishedHint")
        }
      >
        <Suspense fallback={<Loading />}>
          <RunForm
            key={
              editedRun?.id ??
              `new:${calendarPlan ? `${calendarPlan.starts_at}/${calendarPlan.ends_at}/${calendarPlan.time_zone}` : "default"}`
            }
            original={editedRun ?? undefined}
            templates={manage ? (templates.data ?? []) : visibleTemplates}
            organisations={planningOrganisations}
            initialSchedule={calendarPlan}
            companyOnly={!manage}
            focusTarget={focusTarget}
            canPrepareOffer={canPrepareOffer}
            canReadBlockPlanning={manage}
            onBusy={setRunSaving}
            onDone={(result, offerRun, savedId) => {
              setRunEdit(undefined);
              setSavedRun(savedId);
              if (editId && !offerRun)
                setCourseView({ run: savedId ?? editId }, true);
              if (offerRun) {
                navigate(`/courses?offer=${encodeURIComponent(offerRun)}`);
                return;
              }
              if (!editId) setTab(result === "template" ? "templates" : "runs");
              setMessage(t("saved"));
            }}
          />
        </Suspense>
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
                setCourseView({ editRun: runId });
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
          if (!open)
            setCourseView(
              seriesTemplate !== undefined && seriesResults.length
                ? {}
                : { run: offerRunId ?? "" },
              true,
            );
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
            <p className="badge">
              {t(
                courseRunStatus(detail) === "archived"
                  ? "archive"
                  : courseRunStatus(detail) === "published"
                    ? "published"
                    : "draft",
              )}
            </p>
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
            <h3>{t("courseTimeline")}</h3>
            <CourseTimeline
              sessions={detail.course_sessions}
              history={
                manage && !detail.archived_at
                  ? { actor, courseId: detail.id }
                  : undefined
              }
              milestones={[
                ...(detail.created_at
                  ? [
                      {
                        id: "created",
                        label: t("courseTimelineCreated"),
                        at: detail.created_at,
                      },
                    ]
                  : []),
                ...(detail.archived_at
                  ? [
                      {
                        id: "archived",
                        label: t("courseTimelineArchived"),
                        at: detail.archived_at,
                      },
                    ]
                  : []),
              ]}
              label={t("courseTimeline")}
              language={i18n.language}
              zone={detail.time_zone}
              className="session-list"
            />
            <p>
              {detail.time_zone} · {detail.venue}
            </p>
            {!detail.archived_at && (manage || companyViewer) && online && (
              <Suspense fallback={null}>
                <CourseSeriesRevision
                  key={actor + ":" + detail.id}
                  actor={actor}
                  courseId={detail.id}
                  startOpen={params.get("editSeries") === "1"}
                />
              </Suspense>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
