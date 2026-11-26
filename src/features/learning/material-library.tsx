/** Permission-filtered course catalogue and the exact-share metadata editor. */
import { useDeferredValue, useId, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ErrorState,
  Field,
  Loading,
  NextPageError,
  Notice,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { canRetryNextPage, throwPagedReadError } from "../../lib/paged-read";
import { db } from "../../lib/supabase";
import {
  courseAction,
  courseMaterialLibraryKey,
  courseWorkspaceKey,
  readPortalDocument,
  shareAcademyCourseMaterial,
  type CourseOverview,
  type CourseResource,
} from "./api";
import {
  materialLanguage,
  materialMetadataSchema,
  type MaterialMetadata,
  type MaterialCompetency,
} from "./material-metadata-schema";
import { DownloadButton } from "./resources";
import { uploadAcademyCourseMaterial, uploadDocument } from "../files/api";
import { courseCompetenciesSchema } from "./competency-schema";

const pageSize = 24;
const categories = ["material", "report"] as const;
const catalogueFilters = {
  archived: "materialLibraryArchive",
  master: "materialLibraryMasters",
} as const;
const courseAudiences = ["all", "staff", "client", "participants"];

type Material = Pick<CourseResource, "id" | "name" | "version" | "category"> & {
  audience: string;
  course_id: string;
  course_title: string;
  organisation_name: string | null;
  can_upload: boolean;
  can_edit_metadata: boolean;
  can_read_metadata_history?: boolean;
  can_reuse?: boolean;
  metadata: MaterialMetadata | null;
  metadata_revision: number;
};

const emptyMetadata: MaterialMetadata = {
  title: "",
  description: "",
  subject: "",
  licence: "",
  language: "",
  tags: [],
};
const languageLabels = {
  "": "materialLanguageUnspecified",
  de: "materialLanguageGerman",
  en: "materialLanguageEnglish",
  other: "materialLanguageOther",
} as const;

function competencyKey(link: MaterialCompetency) {
  return `${link.framework_id}:${link.id}`;
}

function MaterialCompetencies({
  actor,
  course,
  selected,
  onChange,
}: {
  actor: string;
  course: string;
  selected: MaterialCompetency[];
  onChange: (links: MaterialCompetency[]) => void;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const framework = useQuery({
    queryKey: [
      ...courseMaterialLibraryKey(actor),
      "competency-options",
      course,
    ],
    enabled: open && online,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_competencies", { p_run_id: course }, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return courseCompetenciesSchema.parse(data).pinned_framework;
    },
    retry: false,
  });
  const choices = new Map(selected.map((link) => [competencyKey(link), link]));
  if (framework.data) {
    const { id, revision, content } = framework.data;
    for (const competency of content.competencies) {
      const link = {
        ...competency,
        framework_id: id,
        framework_revision: revision,
      };
      if (!choices.has(competencyKey(link)))
        choices.set(competencyKey(link), link);
    }
  }
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("materialCompetencies")}</summary>
      {open && online && framework.isPending && <Loading />}
      {framework.isError && (
        <ErrorState retry={() => void framework.refetch()} />
      )}
      {framework.isSuccess && choices.size === 0 && (
        <p>{t("materialCompetenciesEmpty")}</p>
      )}
      {choices.size > 0 && (
        <fieldset>
          <legend>{t("materialCompetencySelect")}</legend>
          {[...choices].map(([key, link]) => {
            const checked = selected.some(
              (item) => competencyKey(item) === key,
            );
            return (
              <label key={key} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!online || (!checked && selected.length >= 12)}
                  onChange={(event) =>
                    onChange(
                      event.currentTarget.checked
                        ? [...selected, link]
                        : selected.filter(
                            (item) => competencyKey(item) !== key,
                          ),
                    )
                  }
                />
                {link.code} · {link.title}
              </label>
            );
          })}
        </fieldset>
      )}
    </details>
  );
}

async function saveMaterialMetadata(
  material: Material,
  metadata: MaterialMetadata,
  revision = material.metadata_revision,
) {
  requireOnline();
  const { error } = await db().rpc("set_course_material_metadata", {
    p_resource_id: material.id,
    p_expected_revision: revision,
    p_metadata: metadata,
  });
  if (error) throw error;
}

/** Keep the revision that opened the form; background refreshes must not rebase unsaved text. */
function MaterialMetadataEditor({
  actor,
  material,
  onClose,
}: {
  actor: string;
  material: Material;
  onClose: (saved?: boolean) => void;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const online = useOnline();
  const queryClient = useQueryClient();
  const [revision] = useState(material.metadata_revision);
  const [metadata, setMetadata] = useState(material.metadata ?? emptyMetadata);
  const [tags, setTags] = useState(metadata.tags.join(", "));
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    networkMode: "always",
    mutationFn: (data: MaterialMetadata) =>
      saveMaterialMetadata(material, data, revision),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: courseMaterialLibraryKey(actor),
      });
      onClose(true);
    },
  });
  const conflict =
    material.metadata_revision !== revision ||
    (save.error && "code" in save.error && save.error.code === "PT409");

  return (
    <form
      className="material-metadata-form"
      aria-label={t("materialEditMetadata")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!online || save.isPending || conflict) return;
        const data = materialMetadataSchema.safeParse({
          ...metadata,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        });
        setInvalid(!data.success);
        if (data.success) save.mutate(data.data);
      }}
    >
      <fieldset disabled={save.isPending}>
        <p>{t("materialMetadataVisibility")}</p>
        <Field id={`${id}-title`} label={t("materialMetadataTitle")}>
          <input
            maxLength={160}
            value={metadata.title}
            onChange={(event) =>
              setMetadata({ ...metadata, title: event.target.value })
            }
          />
        </Field>
        <Field
          id={`${id}-description`}
          label={t("materialMetadataDescription")}
        >
          <textarea
            rows={3}
            maxLength={2000}
            value={metadata.description}
            onChange={(event) =>
              setMetadata({ ...metadata, description: event.target.value })
            }
          />
        </Field>
        <Field id={`${id}-subject`} label={t("materialMetadataSubject")}>
          <input
            maxLength={120}
            value={metadata.subject}
            onChange={(event) =>
              setMetadata({ ...metadata, subject: event.target.value })
            }
          />
        </Field>
        <Field id={`${id}-objectives`} label={t("lessonObjectives")}>
          <textarea
            maxLength={1000}
            value={metadata.learning_objectives ?? ""}
            onChange={(event) =>
              setMetadata({
                ...metadata,
                learning_objectives: event.target.value,
              })
            }
          />
        </Field>
        <MaterialCompetencies
          actor={actor}
          course={material.course_id}
          selected={metadata.competencies ?? []}
          onChange={(competencies) =>
            setMetadata({ ...metadata, competencies })
          }
        />
        <Field id={`${id}-review-on`} label={t("materialReviewOn")}>
          <input
            type="date"
            min="1000-01-01"
            max="9999-12-31"
            value={metadata.review_on ?? ""}
            onChange={(event) =>
              setMetadata({ ...metadata, review_on: event.target.value })
            }
          />
        </Field>
        <Field
          id={`${id}-tags`}
          label={t("materialMetadataTags")}
          hint={t("materialMetadataTagHelp")}
          error={invalid}
        >
          <input
            maxLength={420}
            value={tags}
            onChange={(event) => {
              setTags(event.target.value);
              setInvalid(false);
            }}
          />
        </Field>
        <Field id={`${id}-language`} label={t("materialMetadataLanguage")}>
          <select
            value={metadata.language}
            onChange={(event) =>
              setMetadata({
                ...metadata,
                language: materialLanguage.parse(event.target.value),
              })
            }
          >
            {materialLanguage.options.map((value) => (
              <option key={value} value={value}>
                {t(languageLabels[value])}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-licence`} label={t("materialMetadataLicence")}>
          <input
            maxLength={160}
            value={metadata.licence}
            onChange={(event) =>
              setMetadata({ ...metadata, licence: event.target.value })
            }
          />
        </Field>
      </fieldset>
      {conflict ? (
        <Notice kind="error">{t("materialMetadataConflict")}</Notice>
      ) : (
        save.isError && (
          <Notice kind="error">{t("materialMetadataSaveFailed")}</Notice>
        )
      )}
      {!online && <p role="status">{t("materialMetadataOffline")}</p>}
      <div className="form-actions">
        <Button
          type="submit"
          disabled={!online || save.isPending || Boolean(conflict)}
        >
          {t("materialSaveMetadata")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={save.isPending}
          onClick={() => {
            if (conflict)
              void queryClient.invalidateQueries({
                queryKey: courseMaterialLibraryKey(actor),
              });
            onClose();
          }}
        >
          {t("materialCancelMetadata")}
        </Button>
      </div>
    </form>
  );
}

type MetadataRevision = {
  revision: number;
  content: MaterialMetadata;
  changed_at: string;
};
const metadataHistoryPageSize = 20;

/** Fetch history only on demand. Cursor pages stay scoped to the signed-in actor and share. */
function MaterialMetadataHistory({
  actor,
  resourceId,
  revision,
}: {
  actor: string;
  resourceId: string;
  revision: number;
}) {
  const { t, i18n } = useTranslation("learning");
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const query = useInfiniteQuery({
    queryKey: [
      ...courseMaterialLibraryKey(actor),
      "history",
      resourceId,
      revision,
    ],
    enabled: open && online,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error, status } = await db()
        .rpc("course_material_metadata_history", {
          p_resource_id: resourceId,
          p_before: pageParam,
        })
        .abortSignal(signal);
      if (error) throwPagedReadError(error, status);
      return data as MetadataRevision[];
    },
    getNextPageParam: (rows) =>
      rows.length > metadataHistoryPageSize
        ? rows[metadataHistoryPageSize - 1].revision
        : undefined,
    retry: false,
    staleTime: 0,
  });
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("materialHistory")}</summary>
      {open &&
        (!online ? (
          <p>{t("materialMetadataOffline")}</p>
        ) : query.isPending ? (
          <Loading />
        ) : query.isError && !canRetryNextPage(query) ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : (
          <>
            <ol className="space-y-4">
              {query.data?.pages
                .flatMap((page) => page.slice(0, metadataHistoryPageSize))
                .map((item) => (
                  <li key={item.revision}>
                    <strong>{t("version", { version: item.revision })}</strong>
                    {" · "}
                    <time dateTime={item.changed_at}>
                      {new Date(item.changed_at).toLocaleString(i18n.language)}
                    </time>
                    {item.content.title && <p>{item.content.title}</p>}
                    <MaterialMetadataDetails metadata={item.content} />
                  </li>
                ))}
            </ol>
            {canRetryNextPage(query) ? (
              <NextPageError
                retry={() => void query.fetchNextPage({ cancelRefetch: false })}
                disabled={query.isFetching}
              />
            ) : (
              query.hasNextPage && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={query.isFetching}
                  onClick={() =>
                    void query.fetchNextPage({ cancelRefetch: false })
                  }
                >
                  {t("materialMoreRevisions")}
                </Button>
              )
            )}
          </>
        ))}
    </details>
  );
}

/** Latest catalogue card and historical snapshots render the same documented fields. */
function MaterialMetadataDetails({ metadata }: { metadata: MaterialMetadata }) {
  const { t, i18n } = useTranslation("learning");
  const detail = [
    metadata.subject,
    metadata.language && t(languageLabels[metadata.language]),
    metadata.licence,
  ].filter(Boolean);
  return (
    <>
      {metadata.description && (
        <p className="material-metadata-description">{metadata.description}</p>
      )}
      {detail.length > 0 && <p>{detail.join(" · ")}</p>}
      {metadata.learning_objectives && (
        <p>
          {t("lessonObjectives")}: {metadata.learning_objectives}
        </p>
      )}
      {metadata.review_on && (
        <p>
          {t("materialReviewOn")}:{" "}
          <time dateTime={metadata.review_on}>
            {new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "medium",
              timeZone: "UTC",
            }).format(new Date(metadata.review_on))}
          </time>
        </p>
      )}
      {Boolean(metadata.competencies?.length) && (
        <ul aria-label={t("materialCompetencies")}>
          {metadata.competencies?.map((link) => (
            <li key={competencyKey(link)}>
              {link.code} · {link.title}
            </li>
          ))}
        </ul>
      )}
      {metadata.tags.length > 0 && (
        <small>
          {t("materialMetadataTags")}: {metadata.tags.join(", ")}
        </small>
      )}
    </>
  );
}

type ReuseTarget = { id: string; title: string; shared: boolean };
const reuseTargetLimit = 50;

/** Clone through the normal scanner and publish the new independent version. */
async function copyCourseMaterial({
  actor,
  academy,
  material,
  target,
  requestId,
  copyMetadata,
}: {
  actor: string;
  academy: boolean;
  material: Material;
  target: string;
  requestId: string;
  copyMetadata: boolean;
}) {
  if (!courseAudiences.includes(material.audience))
    throw new Error("invalid_material_audience");
  const bytes = await readPortalDocument(
    { kind: "resource", id: material.id },
    AbortSignal.timeout(30_000),
    actor,
  );
  if (bytes.size === 0 || bytes.size > 10 * 1024 * 1024)
    throw new Error("file_size");
  const file = new File([bytes], material.name, { type: bytes.type });
  const document = academy
    ? await uploadAcademyCourseMaterial(
        file,
        target,
        requestId,
        undefined,
        actor,
      )
    : await uploadDocument(file, {
        scope: "personal",
        kind: "material",
        clientId: requestId,
        expectedActor: actor,
      });
  const version = document.current_version_id;
  if (document.status !== "clean" || !version)
    throw new Error("missing_clean_version");
  const session = (await db().auth.getSession()).data.session;
  if (session?.user.id !== actor) throw new Error("account_changed");
  const share = academy
    ? await shareAcademyCourseMaterial(
        target,
        version,
        material.audience,
        "material",
      )
    : await courseAction(target, "resource_share", {
        version_id: version,
        audience: material.audience,
        category: "material",
      });
  if (!share.id) throw new Error("unconfirmed");
  if (copyMetadata && material.metadata) {
    const metadata = { ...material.metadata };
    delete metadata.library_archived;
    delete metadata.library_master;
    // A new destination may pin a different competency framework.
    delete metadata.competencies;
    await saveMaterialMetadata({ ...material, id: share.id }, metadata, 0);
  }
  return share.id;
}

/** Reuse the exact existing share in another scoped course with independent metadata. */
function MaterialReuse({
  actor,
  academy,
  material,
  onClose,
}: {
  actor: string;
  academy: boolean;
  material: Material;
  onClose: () => void;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const cache = useQueryClient();
  const fieldId = useId();
  const [search, setSearch] = useState("");
  const pendingSearch = useDeferredValue(search.trim());
  const [choice, setChoice] = useState("");
  const [copyMetadata, setCopyMetadata] = useState(false);
  const [independent, setIndependent] = useState(false);
  const copyRequest = useRef<{ target: string; id: string } | null>(null);
  const targets = useQuery({
    queryKey: [
      ...courseMaterialLibraryKey(actor),
      "reuse",
      material.id,
      pendingSearch,
    ],
    enabled: online,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_material_reuse_targets", {
          p_resource_id: material.id,
          p_search: pendingSearch,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as ReuseTarget[];
    },
    retry: false,
  });
  const rows = targets.data ?? [];
  const selected = rows
    .slice(0, reuseTargetLimit)
    .find(({ id }) => id === choice);
  const share = useMutation({
    mutationFn: async (target: string) => {
      requireOnline();
      if (independent) {
        if (copyRequest.current?.target !== target)
          copyRequest.current = { target, id: crypto.randomUUID() };
        return copyCourseMaterial({
          actor,
          academy,
          material,
          target,
          requestId: copyRequest.current.id,
          copyMetadata,
        });
      }
      const { data, error } = await db().rpc("reuse_course_material", {
        p_resource_id: material.id,
        p_target_run_id: target,
        p_copy_metadata: copyMetadata,
      });
      if (error || typeof data !== "string")
        throw error ?? new Error("Missing share receipt");
      return data;
    },
    onSuccess: (_, target) =>
      Promise.all([
        cache.invalidateQueries({ queryKey: courseMaterialLibraryKey(actor) }),
        cache.invalidateQueries({
          queryKey: courseWorkspaceKey(actor, target),
        }),
      ]),
  });
  return (
    <Dialog
      open
      title={t("materialReuse")}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      description={t("materialReuseHelp", { name: material.name })}
      closeDisabled={share.isPending}
    >
      {share.isSuccess ? (
        <>
          <Notice>
            {t(
              independent
                ? "materialReuseIndependentSuccess"
                : "materialReuseSuccess",
            )}
          </Notice>
          <Link to={`/courses/${share.variables}/workspace#course-materials`}>
            {t("workspaceMaterials")}
          </Link>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              selected &&
              (!selected.shared || independent) &&
              online &&
              pendingSearch === search.trim() &&
              !share.isPending
            )
              share.mutate(selected.id);
          }}
        >
          {!online ? (
            <p role="status">{t("materialMetadataOffline")}</p>
          ) : (
            <fieldset disabled={share.isPending}>
              <legend>{t("materialReuseTarget")}</legend>
              {courseAudiences.includes(material.audience) && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={independent}
                    onChange={(event) => {
                      setIndependent(event.target.checked);
                      setChoice("");
                    }}
                  />
                  {t("materialReuseIndependent")}
                </label>
              )}
              <Field id={`${fieldId}-search`} label={t("materialReuseSearch")}>
                <input
                  type="search"
                  maxLength={150}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setChoice("");
                  }}
                />
              </Field>
              {targets.isError ? (
                <ErrorState retry={() => void targets.refetch()} />
              ) : targets.isPending || pendingSearch !== search.trim() ? (
                <Loading />
              ) : (
                <>
                  {rows.length === 0 ? (
                    <p>{t("materialReuseNoTargets")}</p>
                  ) : (
                    <Field
                      id={`${fieldId}-target`}
                      label={t("materialReuseTarget")}
                    >
                      <select
                        value={choice}
                        onChange={(event) => setChoice(event.target.value)}
                      >
                        <option value="">{t("materialReuseChoose")}</option>
                        {rows
                          .slice(0, reuseTargetLimit)
                          .map(({ id, title, shared }) => (
                            <option
                              key={id}
                              value={id}
                              disabled={shared && !independent}
                            >
                              {shared && !independent
                                ? t("materialReuseAlreadyShared", { title })
                                : title}
                            </option>
                          ))}
                      </select>
                    </Field>
                  )}
                  {rows.length > reuseTargetLimit && (
                    <p>{t("materialReuseRefine")}</p>
                  )}
                </>
              )}
              {material.metadata && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={copyMetadata}
                    onChange={(event) => setCopyMetadata(event.target.checked)}
                  />
                  {t("materialReuseCopyMetadata")}
                </label>
              )}
            </fieldset>
          )}
          {share.isError && (
            <Notice kind="error">{t("materialReuseError")}</Notice>
          )}
          <Button
            type="submit"
            disabled={
              !online ||
              !selected ||
              (selected.shared && !independent) ||
              share.isPending
            }
          >
            {t(
              independent
                ? "materialReuseIndependentConfirm"
                : "materialReuseConfirm",
            )}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

type MaterialUsagePage = {
  items: { id: string; title: string; audiences: string[] }[];
  next: string | null;
};

/** Read current exact-version uses when course staff open the disclosure. */
function MaterialUsage({
  actor,
  resource,
}: {
  actor: string;
  resource: string;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const query = useInfiniteQuery({
    queryKey: [...courseMaterialLibraryKey(actor), resource, "usage"],
    enabled: open && online,
    retry: false,
    initialPageParam: null as string | null,
    getNextPageParam: (page: MaterialUsagePage) => page.next ?? undefined,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
        .rpc("course_material_usage", {
          p_resource_id: resource,
          p_after: pageParam,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as MaterialUsagePage;
    },
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("materialUsage")}</summary>
      {open &&
        (online ? (
          query.isError ? (
            <ErrorState retry={() => void query.refetch()} />
          ) : query.isPending ? (
            <Loading />
          ) : (
            <>
              {rows.length ? (
                <ul>
                  {rows.map(({ id, title, audiences }) => (
                    <li key={id}>
                      <Link to={`/courses/${id}/workspace#course-materials`}>
                        {title}
                      </Link>
                      <p>
                        {audiences.map((audience) => t(audience)).join(", ")}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t("materialUsageEmpty")}</p>
              )}
              {query.hasNextPage && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t("materialUsageMore")}
                </Button>
              )}
            </>
          )
        ) : (
          <p role="status">{t("materialMetadataOffline")}</p>
        ))}
    </details>
  );
}

type CatalogueChange = Partial<
  Pick<MaterialMetadata, "library_archived" | "library_master">
>;

function MaterialStatusActions({
  material,
  onChange,
}: {
  material: Material;
  onChange: (change: CatalogueChange) => void;
}) {
  const { t } = useTranslation("learning");
  const status = useMutation({
    mutationFn: (change: CatalogueChange) =>
      saveMaterialMetadata(material, {
        ...emptyMetadata,
        ...material.metadata,
        ...change,
      }),
    onSuccess: (_, change) => onChange(change),
  });
  const archived = material.metadata?.library_archived === true;
  const master = material.metadata?.library_master === true;
  return (
    <details>
      <summary>{t("materialLibraryManage")}</summary>
      <p>{t("materialLibraryStatusHelp")}</p>
      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={status.isPending}
          onClick={() => status.mutate({ library_archived: !archived })}
        >
          {t(
            archived
              ? "materialLibraryRestore"
              : "materialLibraryArchiveAction",
          )}
        </Button>
        {!archived && (material.can_reuse || master) && (
          <Button
            type="button"
            variant="secondary"
            disabled={status.isPending}
            onClick={() => status.mutate({ library_master: !master })}
          >
            {t(
              master
                ? "materialLibraryRemoveMaster"
                : "materialLibraryMarkMaster",
            )}
          </Button>
        )}
      </div>
      {status.isError && (
        <Notice kind="error">{t("materialMetadataSaveFailed")}</Notice>
      )}
    </details>
  );
}

/** Presentation and editing share the same row; downloads always use the original resource ID. */
function MaterialItem({
  actor,
  academy,
  material,
  readOnly,
  onStatusChange,
}: {
  actor: string;
  academy: boolean;
  material: Material;
  readOnly: boolean;
  onStatusChange: (change: CatalogueChange) => void;
}) {
  const { t } = useTranslation("learning");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reuseOpen, setReuseOpen] = useState(false);
  const edit = useRef<HTMLButtonElement>(null);
  const metadata = material.metadata;
  const active = !metadata?.library_archived;
  return (
    <li>
      {metadata?.title && <h3>{metadata.title}</h3>}
      <strong>{material.name}</strong>
      <small>
        {t(material.category)} · {t("version", { version: material.version })}
      </small>
      {metadata && <MaterialMetadataDetails metadata={metadata} />}
      {metadata?.library_master && material.can_read_metadata_history && (
        <p>{t("materialLibraryMasterSource")}</p>
      )}
      {material.can_read_metadata_history && (
        <MaterialMetadataHistory
          actor={actor}
          resourceId={material.id}
          revision={material.metadata_revision}
        />
      )}
      {material.can_read_metadata_history && (
        <MaterialUsage actor={actor} resource={material.id} />
      )}
      <div className="form-actions">
        <DownloadButton
          kind="resource"
          id={material.id}
          name={material.name}
          label={t("materialDownload", { name: material.name })}
        />
        {!readOnly && active && material.can_reuse && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setReuseOpen(true)}
          >
            {t("materialReuse")}
          </Button>
        )}
        {!readOnly && material.can_edit_metadata && (
          <Button
            ref={edit}
            type="button"
            variant="secondary"
            aria-expanded={editing}
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            {t("materialEditMetadata")}
          </Button>
        )}
      </div>
      {!readOnly && !editing && material.can_edit_metadata && (
        <MaterialStatusActions material={material} onChange={onStatusChange} />
      )}
      {reuseOpen && !readOnly && active && material.can_reuse && (
        <MaterialReuse
          actor={actor}
          academy={academy}
          material={material}
          onClose={() => setReuseOpen(false)}
        />
      )}
      {saved && <Notice>{t("materialMetadataSaved")}</Notice>}
      {!readOnly && material.can_edit_metadata && editing && (
        <MaterialMetadataEditor
          actor={actor}
          material={material}
          onClose={(confirmed) => {
            setSaved(Boolean(confirmed));
            setEditing(false);
            edit.current?.focus();
          }}
        />
      )}
    </li>
  );
}

export function MaterialLibrary({
  actor,
  courses,
  readOnly,
  academy,
  canBrowseCatalogue,
}: {
  actor: string;
  courses: CourseOverview[];
  readOnly: boolean;
  academy: boolean;
  canBrowseCatalogue: boolean;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const cache = useQueryClient();
  const filter = useRef<HTMLSelectElement>(null);
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<{ id: string; title: string }>();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const activeCategory =
    !canBrowseCatalogue && category in catalogueFilters ? "" : category;
  const needle = useDeferredValue(search.trim());
  const courseId = selection?.id ?? "";
  const query = useInfiniteQuery({
    queryKey: [
      ...courseMaterialLibraryKey(actor),
      courseId,
      needle,
      activeCategory,
    ],
    queryFn: async ({ pageParam, signal }) => {
      const { data, error, status } = await db()
        .rpc("search_course_materials", {
          p_course_id: courseId || null,
          p_search: needle,
          p_category: activeCategory || null,
          p_offset: pageParam,
        })
        .abortSignal(signal);
      if (error) throwPagedReadError(error, status);
      return data as Material[];
    },
    initialPageParam: 0,
    getNextPageParam: (last, _pages, offset) =>
      last.length > pageSize ? offset + pageSize : undefined,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
  const retryNext = canRetryNextPage(query);
  const groups = new Map<string, Material[]>();
  const seen = new Set<string>();
  for (const page of query.data?.pages ?? []) {
    for (const material of page.slice(0, pageSize)) {
      if (seen.has(material.id)) continue;
      seen.add(material.id);
      const group = groups.get(material.course_id) ?? [];
      group.push(material);
      groups.set(material.course_id, group);
    }
  }

  function handleStatusChange(change: CatalogueChange) {
    const announcement =
      change.library_archived !== undefined
        ? t(
            change.library_archived
              ? "materialLibraryArchived"
              : "materialLibraryRestored",
          )
        : t(
            change.library_master
              ? "materialLibraryMasterAdded"
              : "materialLibraryMasterRemoved",
          );
    if (change.library_archived !== undefined || activeCategory === "master")
      filter.current?.focus();
    setNotice(announcement);
    void cache.invalidateQueries({ queryKey: courseMaterialLibraryKey(actor) });
  }

  return (
    <section className="course-hub-groups" aria-label={t("materialLibrary")}>
      <div className="panel course-hub-filter">
        <Field id={id + "-course"} label={t("materialCourseFilter")}>
          <select
            id={id + "-course"}
            value={courseId}
            onChange={(event) =>
              setSelection(
                courses.find((course) => course.id === event.target.value),
              )
            }
          >
            <option value="">{t("materialAllCourses")}</option>
            {selection && !courses.some((course) => course.id === courseId) && (
              <option value={courseId}>{selection.title}</option>
            )}
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {[course.title, course.organisation_name]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id={id + "-search"}
          label={t("materialSearch")}
          hint={t("materialSearchHint")}
        >
          <input
            id={id + "-search"}
            type="search"
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field id={id + "-category"} label={t("category")}>
          <select
            id={id + "-category"}
            value={activeCategory}
            ref={filter}
            onChange={(event) => {
              setNotice("");
              setCategory(event.target.value);
            }}
          >
            <option value="">{t("materialAllCategories")}</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
            {canBrowseCatalogue &&
              Object.entries(catalogueFilters).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {query.isError && !retryNext ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : query.isPending ||
        !query.isFetchedAfterMount ||
        needle !== search.trim() ? (
        <Loading />
      ) : groups.size === 0 ? (
        <p className="empty-state">
          {t(needle || activeCategory ? "materialNoMatches" : "noResources")}
        </p>
      ) : (
        [...groups].map(([run, resources]) => {
          const first = resources[0];
          const workspace = `/courses/${run}/workspace#course-materials`;
          return (
            <article key={run} className="panel learning-panel">
              <h2>{first.course_title}</h2>
              {first.organisation_name && <p>{first.organisation_name}</p>}
              <ul className="learning-resources">
                {resources.map((resource) => (
                  <MaterialItem
                    key={resource.id}
                    actor={actor}
                    academy={academy}
                    material={resource}
                    readOnly={readOnly}
                    onStatusChange={handleStatusChange}
                  />
                ))}
              </ul>
              <div className="button-row">
                {!courseId && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setSelection({ id: run, title: first.course_title })
                    }
                  >
                    {t("materialOnlyThisCourse")}
                  </Button>
                )}
                <Link to={workspace}>
                  {t(
                    first.can_upload && !readOnly
                      ? "uploadCourseFile"
                      : "workspaceMaterials",
                  )}
                </Link>
              </div>
            </article>
          );
        })
      )}
      {retryNext ? (
        <NextPageError
          retry={() => void query.fetchNextPage({ cancelRefetch: false })}
          disabled={query.isFetching}
        />
      ) : (
        !query.isError &&
        query.hasNextPage && (
          <Button
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
          >
            {t("materialMoreFiles")}
          </Button>
        )
      )}
      {selection && !readOnly && query.isSuccess && groups.size === 0 && (
        <Link to={`/courses/${selection.id}/workspace#course-materials`}>
          {t("workspaceMaterials")}
        </Link>
      )}
    </section>
  );
}
