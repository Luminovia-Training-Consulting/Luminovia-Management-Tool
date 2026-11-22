import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading } from "../../components/common";
import { Button } from "../../components/ui/button";
import { courseWorkspaceQuery, type CourseOverview } from "./api";
import { DownloadButton } from "./resources";

const pageSize = 6;

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
  const [selection, setSelection] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const selected = courses.find((course) => course.id === selection);
  return (
    <section className="course-hub-groups" aria-label={t("materialLibrary")}>
      <div className="panel course-hub-filter">
        <Field id={id + "-course"} label={t("materialCourseFilter")}>
          <select
            value={selected?.id ?? ""}
            onChange={(event) => setSelection(event.target.value)}
          >
            <option value="">{t("materialAllCourses")}</option>
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
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
      </div>
      {!courses.length && <p className="empty-state">{t("noResources")}</p>}
      {(selected ? [selected] : courses.slice(0, limit)).map((course) => (
        <CourseMaterials
          key={course.id}
          actor={actor}
          course={course}
          search={search}
          readOnly={readOnly}
        />
      ))}
      {!selected && courses.length > limit && (
        <Button
          variant="secondary"
          onClick={() => setLimit((value) => value + pageSize)}
        >
          {t("materialMoreCourses")}
        </Button>
      )}
    </section>
  );
}

function CourseMaterials({
  actor,
  course,
  search,
  readOnly,
}: {
  actor: string;
  course: CourseOverview;
  search: string;
  readOnly: boolean;
}) {
  const { t, i18n } = useTranslation("learning");
  const query = useQuery({
    ...courseWorkspaceQuery(actor, course.id),
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
  const current =
    query.isSuccess && query.isFetchedAfterMount ? query.data : null;
  const needle = search.trim().toLocaleLowerCase(i18n.language);
  const resources = current?.lms_enabled
    ? current.resources.filter((item) =>
        item.name.toLocaleLowerCase(i18n.language).includes(needle),
      )
    : [];
  const access = current?.access;
  const canUpload =
    !readOnly &&
    current?.lms_enabled &&
    (access?.manager || access?.teacher || access?.client);
  const workspace = `/courses/${course.id}/workspace#course-materials`;

  return (
    <article className="panel learning-panel">
      <h2>{course.title}</h2>
      {course.organisation_name && <p>{course.organisation_name}</p>}
      {query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : !current ? (
        <Loading />
      ) : !resources.length ? (
        <p>{t(needle ? "materialNoMatches" : "noResources")}</p>
      ) : (
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
      )}
      {canUpload && <Link to={workspace}>{t("uploadCourseFile")}</Link>}
    </article>
  );
}
