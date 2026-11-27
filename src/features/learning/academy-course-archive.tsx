import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import { db } from "../../lib/supabase";
import {
  CourseBulkArchiveActions,
  CourseBulkArchiveSelection,
} from "../operations/course-bulk-archive";
import { useCourseBulkArchive } from "../operations/use-course-bulk-archive";
import { academyCourseArchivePage } from "../operations/course-bulk-archive-schema";

const pageSize = 50;

export function AcademyCourseArchive({
  actor,
  readOnly,
}: {
  actor: string;
  readOnly: boolean;
}) {
  const { t, i18n } = useTranslation("operations");
  const filterId = useId();
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const query = useQuery<ReturnType<
    typeof academyCourseArchivePage.parse
  > | null>({
    queryKey: ["academy-course-archive", actor, archived, offset],
    refetchOnMount: "always",
    refetchInterval: 30_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === actor ? previous : undefined,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_course_archive_runs", {
          p_archived: archived,
          p_offset: offset,
        })
        .abortSignal(signal);
      if (error?.code === "42501") return null;
      if (error) throw error;
      return academyCourseArchivePage.parse(data);
    },
  });
  const items = query.isPlaceholderData ? [] : (query.data?.items ?? []);
  const controls = useCourseBulkArchive(items, () => {
    setSaved(true);
    setOffset(0);
  });
  if (
    query.data === null ||
    (!query.isFetchedAfterMount && !query.isPlaceholderData)
  )
    return null;
  return (
    <details
      className="panel academy-draft"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("academyCourseArchive")}</summary>
      <Field id={filterId} label={t("academyCourseArchiveFilter")}>
        <select
          id={filterId}
          value={archived ? "archived" : "current"}
          onChange={(event) => {
            setArchived(event.currentTarget.value === "archived");
            setOffset(0);
            setSaved(false);
            controls.clear();
          }}
        >
          <option value="current">{t("academyCourseArchiveCurrent")}</option>
          <option value="archived">{t("archive")}</option>
        </select>
      </Field>
      {saved && <Notice>{t("archiveSaved")}</Notice>}
      {!readOnly && <CourseBulkArchiveActions controls={controls} />}
      {query.isPlaceholderData ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <>
          {items.length ? (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong> · {item.organisation_name} ·{" "}
                  {t(
                    item.archived_at
                      ? "archive"
                      : item.published
                        ? "published"
                        : "draft",
                  )}
                  {item.starts_at && (
                    <>
                      {" "}
                      ·{" "}
                      {dateTime(item.starts_at, i18n.language, item.time_zone)}
                    </>
                  )}
                  {!readOnly && (
                    <CourseBulkArchiveSelection
                      item={item}
                      controls={controls}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Notice>{t("noCoursesWithStatus")}</Notice>
          )}
          <div className="page-actions">
            {offset > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOffset(offset - pageSize)}
              >
                {t("academyCourseArchivePrevious")}
              </Button>
            )}
            {query.data?.has_more && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOffset(offset + pageSize)}
              >
                {t("academyCourseArchiveNext")}
              </Button>
            )}
          </div>
        </>
      )}
    </details>
  );
}
