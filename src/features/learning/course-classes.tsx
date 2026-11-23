import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseClassName, courseClassOptions } from "./course-classes-schema";
import { attendanceSummariesKey } from "./attendance-api";
import "./i18n";

function CompanyClassEditor({
  selected,
  options,
  saving,
  confirm,
}: {
  selected: string;
  options: { id: string; name: string }[];
  saving: boolean;
  confirm: (id: string | null, name: string | null) => void;
}) {
  const { t } = useTranslation("learning");
  const field = useId();
  const [selection, setSelection] = useState(selected);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (selection === "new") {
          const name = courseClassName.safeParse(
            new FormData(event.currentTarget).get("name"),
          );
          if (name.success) confirm(null, name.data);
        } else {
          confirm(selection || null, null);
        }
      }}
    >
      <Field id={field} label={t("courseClassSelect")}>
        <select
          id={field}
          value={selection}
          disabled={saving}
          onChange={(event) => setSelection(event.target.value)}
        >
          <option value="">{t("courseClassNone")}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
          {options.length < 100 && (
            <option value="new">{t("courseClassNew")}</option>
          )}
        </select>
      </Field>
      {selection === "new" && (
        <Field id={field + "-name"} label={t("courseClassName")}>
          <input
            name="name"
            type="text"
            pattern={".*\\S.*"}
            maxLength={100}
            required
            disabled={saving}
          />
        </Field>
      )}
      <Button type="submit" disabled={saving || selection === selected}>
        {t("courseClassSave")}
      </Button>
    </form>
  );
}

export function CourseClasses({
  courseId,
  actor,
  editor,
}: {
  courseId: string;
  actor: string;
  editor: boolean;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const cache = useQueryClient();
  const heading = useId();
  const queryKey = ["course-class", actor, courseId];
  const options = useQuery({
    queryKey,
    enabled: online,
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_class_options", { p_course_id: courseId })
        .abortSignal(signal);
      if (error) throw error;
      return courseClassOptions.parse(data);
    },
  });
  const save = useMutation({
    mutationFn: async ({
      id,
      name,
      version,
    }: {
      id: string | null;
      name: string | null;
      version: number;
    }) => {
      requireOnline();
      const { data, error } = await db().rpc("set_course_class", {
        p_course_id: courseId,
        p_class_id: id,
        p_new_name: name,
        p_expected_version: version,
      });
      if (error) throw error;
      return courseClassOptions.parse(data);
    },
    onSuccess: async (receipt) => {
      cache.setQueryData(queryKey, receipt);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["course-class", actor] }),
        cache.invalidateQueries({ queryKey: attendanceSummariesKey(actor) }),
      ]);
    },
  });
  if (!online || (!editor && !options.data?.current)) return null;
  const current =
    options.isFetchedAfterMount && !options.isError ? options.data : undefined;
  if (!editor && !current?.current) return null;

  return (
    <section className="panel learning-panel" aria-labelledby={heading}>
      <h2 id={heading}>{t("courseClassHeading")}</h2>
      {options.isPending && <Loading />}
      {options.isError && <ErrorState retry={() => void options.refetch()} />}
      {current && (
        <>
          <p>{current.current?.name ?? t("courseClassNone")}</p>
          {editor &&
            current.courses.some((course) => course.id !== courseId) && (
              <ul>
                {current.courses
                  .filter((course) => course.id !== courseId)
                  .map((course) => (
                    <li key={course.id}>
                      <Link to={`/courses/${course.id}/workspace`}>
                        {course.title}
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          {editor && current.can_edit && (
            <CompanyClassEditor
              key={current.version}
              selected={current.current?.id ?? ""}
              options={current.classes}
              saving={save.isPending}
              confirm={(id, name) =>
                save.mutate({ id, name, version: current.version })
              }
            />
          )}
        </>
      )}
      {save.isSuccess && <Notice>{t("courseClassSaved")}</Notice>}
      {save.isError && (
        <Notice kind="error">
          {t("courseClassError")}
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              save.reset();
              void options.refetch();
            }}
          >
            {t("refresh")}
          </Button>
        </Notice>
      )}
    </section>
  );
}
