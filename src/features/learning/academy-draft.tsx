import { lazy, Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { CourseSeriesForm } from "../operations/course-series";
import { CourseCreatorDraftLibrary } from "../operations/course-creator-drafts";
import {
  courseCreatorDraftId,
  courseCreatorDraftsQuery,
  type CourseCreatorDraft,
} from "../operations/course-creator-drafts-api";
import { courseHubQuery } from "./api";
import { academyDraftOptions } from "./academy-draft-schema";

const CourseEditor = lazy(() =>
  import("../operations/course-editor").then(({ RunForm }) => ({
    default: RunForm,
  })),
);

function draftOptionsQuery(
  actor: string,
  organisation: string,
  template: string,
) {
  return {
    queryKey: ["academy-draft-options", actor, organisation, template],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const { data, error } = await db()
        .rpc("academy_course_draft_options", {
          p_organisation_query: organisation,
          p_template_query: template,
        })
        .abortSignal(signal);
      if (error) throw error;
      return academyDraftOptions.parse(data);
    },
    staleTime: 0,
    retry: false,
  };
}

/** Active Academy managers use the same personal draft store and course editor as the internal portal. */
export function AcademyCourseDraft({ actor }: { actor: string }) {
  const { t } = useTranslation(["learning", "courseSeries", "courseCreator"]);
  const online = useOnline();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const parsed = courseCreatorDraftId.safeParse(params.get("creator"));
  const draftId = parsed.success ? parsed.data : undefined;
  const fresh = params.get("startCreator") === "1";
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const options = useQuery({
    ...draftOptionsQuery(actor, "", ""),
    enabled: online,
    refetchOnMount: "always",
  });
  const enabled =
    online &&
    options.isSuccess &&
    options.isFetchedAfterMount &&
    Boolean(options.data);
  const draft = useQuery({
    ...courseCreatorDraftsQuery(actor, draftId),
    enabled: enabled && Boolean(draftId),
    retry: false,
  });
  const saved = draft.data?.[0];

  function changeDraft(id?: string, start = false) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id) next.set("creator", id);
        else next.delete("creator");
        if (start) next.set("startCreator", "1");
        else next.delete("startCreator");
        return next;
      },
      { replace: !id },
    );
  }

  async function openCourse(id: string) {
    await cache.invalidateQueries({ queryKey: courseHubQuery(actor).queryKey });
    void navigate(`/courses/${id}/workspace`);
  }

  if (!online || options.isError || options.data === null) return null;
  if (!enabled || !options.data) return <Loading />;
  return (
    <>
      <CourseCreatorDraftLibrary
        actor={actor}
        courseOnly
        onStart={() => changeDraft(crypto.randomUUID(), true)}
        onOpen={changeDraft}
        onContinue={(receipt) => {
          if (receipt.course_run_id) void openCourse(receipt.course_run_id);
        }}
      />
      <Dialog
        open={Boolean(draftId)}
        title={t("academyCreateDraft")}
        description={t("courseCreator:courseDraftDescription")}
        closeDisabled={busy}
        onOpenChange={(open) => {
          if (!open && !busy) changeDraft();
        }}
      >
        {draftId &&
          (draft.isPending ? (
            <Loading />
          ) : draft.isError ? (
            <ErrorState retry={() => void draft.refetch()} />
          ) : saved?.state === "created" && saved.course_run_id ? (
            <Button onClick={() => void openCourse(saved.course_run_id!)}>
              {t("courseCreator:openCourse")}
            </Button>
          ) : saved?.state === "editing" || fresh ? (
            <Suspense fallback={<Loading />}>
              <AcademyCreatorFields
                key={draftId + ":" + epoch}
                actor={actor}
                draftId={draftId}
                saved={saved}
                options={options.data}
                reload={() => {
                  void draft.refetch().then((result) => {
                    if (result.isSuccess) setEpoch((value) => value + 1);
                  });
                }}
                onBusy={setBusy}
                onOpen={openCourse}
              />
            </Suspense>
          ) : (
            <Notice kind="error">{t("courseCreator:error")}</Notice>
          ))}
      </Dialog>
      {options.data.templates.length > 0 &&
        options.data.organisations.length > 0 && (
          <details className="panel academy-draft">
            <summary>{t("courseSeries:title")}</summary>
            <p>{t("courseSeries:intro")}</p>
            <CourseSeriesForm
              actor={actor}
              organisations={options.data.organisations}
              templates={options.data.templates}
              defaultOrganisation={
                options.data.organisations.length === 1
                  ? options.data.organisations[0].id
                  : ""
              }
              academic
            />
          </details>
        )}
    </>
  );
}

type DraftOptions = NonNullable<ReturnType<typeof academyDraftOptions.parse>>;

function mergeOptions(
  base: DraftOptions,
  ...other: (DraftOptions | null | undefined)[]
): DraftOptions {
  const organisations = new Map(
    base.organisations.map((item) => [item.id, item]),
  );
  const templates = new Map(base.templates.map((item) => [item.id, item]));
  for (const group of other) {
    for (const item of group?.organisations ?? [])
      organisations.set(item.id, item);
    for (const item of group?.templates ?? []) templates.set(item.id, item);
  }
  return {
    organisations: [...organisations.values()],
    templates: [...templates.values()],
  };
}

function AcademyCreatorFields({
  actor,
  draftId,
  saved,
  options,
  reload,
  onBusy,
  onOpen,
}: {
  actor: string;
  draftId: string;
  saved?: CourseCreatorDraft;
  options: DraftOptions;
  reload: () => void;
  onBusy: (busy: boolean) => void;
  onOpen: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation("learning");
  const [companySearch, setCompanySearch] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [seen, setSeen] = useState(options);
  const lookup = useQuery({
    ...draftOptionsQuery(actor, companySearch, templateSearch),
    enabled: Boolean(companySearch || templateSearch),
  });
  const organisationId = saved?.payload?.run.organisation_id;
  const templateId = saved?.payload?.run.template_id;
  const missingCompany =
    organisationId &&
    !options.organisations.some(({ id }) => id === organisationId);
  const missingTemplate =
    templateId && !options.templates.some(({ id }) => id === templateId);
  const original = useQuery({
    ...draftOptionsQuery(
      actor,
      missingCompany ? organisationId : "",
      missingTemplate ? templateId : "",
    ),
    enabled: Boolean(missingCompany || missingTemplate),
  });
  // Keep prior choices available if a different remote search runs.
  const visible = mergeOptions(seen, original.data, lookup.data);
  const retainSources = () => {
    if (lookup.data) setSeen(visible);
  };
  if ((missingCompany || missingTemplate) && original.isPending)
    return <Loading />;
  if (original.isError)
    return <ErrorState retry={() => void original.refetch()} />;
  return (
    <CourseEditor
      creator={{ id: draftId, saved }}
      academy
      templates={visible.templates}
      organisations={visible.organisations}
      companyOnly={false}
      canPrepareOffer={false}
      canReadBlockPlanning={false}
      reloadCreator={reload}
      sourceSearch={
        <div className="form-row">
          <Field
            id="academy-draft-company-search"
            label={t("academySearchOrganisations")}
          >
            <input
              value={companySearch}
              maxLength={100}
              onChange={(event) => {
                retainSources();
                setCompanySearch(event.currentTarget.value);
              }}
            />
          </Field>
          <Field
            id="academy-draft-template-search"
            label={t("academySearchTemplates")}
          >
            <input
              value={templateSearch}
              maxLength={100}
              onChange={(event) => {
                retainSources();
                setTemplateSearch(event.currentTarget.value);
              }}
            />
          </Field>
          {lookup.isError && <ErrorState retry={() => void lookup.refetch()} />}
        </div>
      }
      onBusy={onBusy}
      onDone={(_result, _offer, run) => {
        if (run) void onOpen(run);
      }}
    />
  );
}
