import { useDeferredValue, useId, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading } from "../../components/common";
import { Button } from "../../components/ui/button";
import { db } from "../../lib/supabase";
import {
  courseMaterialLibraryKey,
  type CourseOverview,
  type CourseResource,
} from "./api";
import { DownloadButton } from "./resources";

const pageSize = 24;
const categories = ["material", "report"] as const;

type Material = Pick<CourseResource, "id" | "name" | "version" | "category"> & {
  course_id: string;
  course_title: string;
  organisation_name: string | null;
  can_upload: boolean;
};

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
      const { data, error } = await db()
        .rpc("search_course_materials", {
          p_course_id: courseId || null,
          p_search: needle,
          p_category: category || null,
          p_offset: pageParam,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as Material[];
    },
    initialPageParam: 0,
    getNextPageParam: (last, _pages, offset) =>
      last.length > pageSize ? offset + pageSize : undefined,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
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
        <Field id={id + "-search"} label={t("materialSearch")}>
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
      {query.isError && !query.isFetchNextPageError ? (
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
                  <li key={resource.id}>
                    <strong>{resource.name}</strong>
                    <small>
                      {t(resource.category)} ·{" "}
                      {t("version", { version: resource.version })}
                    </small>
                    <DownloadButton
                      kind="resource"
                      id={resource.id}
                      name={resource.name}
                      label={t("materialDownload", { name: resource.name })}
                    />
                  </li>
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
                {first.can_upload && !readOnly && (
                  <Link to={workspace}>{t("uploadCourseFile")}</Link>
                )}
              </div>
            </article>
          );
        })
      )}
      {query.isFetchNextPageError ? (
        <ErrorState retry={() => void query.fetchNextPage()} />
      ) : (
        query.hasNextPage && (
          <Button
            variant="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
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
