/** Permission-filtered course catalogue and the exact-share metadata editor. */
import { useDeferredValue, useId, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
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
import { requireOnline, useOnline } from "../../lib/online";
import { canRetryNextPage, throwPagedReadError } from "../../lib/paged-read";
import { db } from "../../lib/supabase";
import {
  courseMaterialLibraryKey,
  type CourseOverview,
  type CourseResource,
} from "./api";
import {
  materialLanguage,
  materialMetadataSchema,
  type MaterialMetadata,
} from "./material-metadata-schema";
import { DownloadButton } from "./resources";

const pageSize = 24;
const categories = ["material", "report"] as const;

type Material = Pick<CourseResource, "id" | "name" | "version" | "category"> & {
  course_id: string;
  course_title: string;
  organisation_name: string | null;
  can_upload: boolean;
  can_edit_metadata: boolean;
  can_read_metadata_history?: boolean;
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
    mutationFn: async (data: MaterialMetadata) => {
      requireOnline();
      const { error } = await db().rpc("set_course_material_metadata", {
        p_resource_id: material.id,
        p_expected_revision: revision,
        p_metadata: data,
      });
      if (error) throw error;
    },
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
      {metadata.tags.length > 0 && (
        <small>
          {t("materialMetadataTags")}: {metadata.tags.join(", ")}
        </small>
      )}
    </>
  );
}

/** Presentation and editing share the same row; downloads always use the original resource ID. */
function MaterialItem({
  actor,
  material,
  readOnly,
}: {
  actor: string;
  material: Material;
  readOnly: boolean;
}) {
  const { t } = useTranslation("learning");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const edit = useRef<HTMLButtonElement>(null);
  const metadata = material.metadata;
  return (
    <li>
      {metadata?.title && <h3>{metadata.title}</h3>}
      <strong>{material.name}</strong>
      <small>
        {t(material.category)} · {t("version", { version: material.version })}
      </small>
      {metadata && <MaterialMetadataDetails metadata={metadata} />}
      {material.can_read_metadata_history && (
        <MaterialMetadataHistory
          actor={actor}
          resourceId={material.id}
          revision={material.metadata_revision}
        />
      )}
      <div className="form-actions">
        <DownloadButton
          kind="resource"
          id={material.id}
          name={material.name}
          label={t("materialDownload", { name: material.name })}
        />
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
}: {
  actor: string;
  courses: CourseOverview[];
  readOnly: boolean;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const [selection, setSelection] = useState<{ id: string; title: string }>();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const needle = useDeferredValue(search.trim());
  const courseId = selection?.id ?? "";
  const query = useInfiniteQuery({
    queryKey: [...courseMaterialLibraryKey(actor), courseId, needle, category],
    queryFn: async ({ pageParam, signal }) => {
      const { data, error, status } = await db()
        .rpc("search_course_materials", {
          p_course_id: courseId || null,
          p_search: needle,
          p_category: category || null,
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
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">{t("materialAllCategories")}</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {query.isError && !retryNext ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : query.isPending ||
        !query.isFetchedAfterMount ||
        needle !== search.trim() ? (
        <Loading />
      ) : groups.size === 0 ? (
        <p className="empty-state">
          {t(needle || category ? "materialNoMatches" : "noResources")}
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
                    material={resource}
                    readOnly={readOnly}
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
