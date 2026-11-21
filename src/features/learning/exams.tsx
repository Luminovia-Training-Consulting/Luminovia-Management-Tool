/** Optional course exam PDFs, attached only after the existing scanner confirms clean bytes. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Field, Notice } from "../../components/common";
import { db } from "../../lib/supabase";
import { useOnline } from "../../lib/online";
import { uploadDocument } from "../files/api";
import {
  courseWorkspaceKey,
  downloadCourseDocument,
  type CourseWorkspace,
} from "./api";
import "./exam-i18n";

export function CourseExams({
  course,
  actor,
  academy,
}: {
  course: CourseWorkspace;
  actor: string;
  academy?: "active" | "grace";
}) {
  const { t } = useTranslation("learningExams");
  const online = useOnline();
  const queries = useQueryClient();
  const [required, setRequired] = useState(course.exams.required);
  const [audience, setAudience] = useState<"students" | "exam_staff">(
    "students",
  );
  const [file, setFile] = useState<File | null>(null);
  const canEdit = course.exams.can_edit && academy !== "grace";
  const refresh = () =>
    queries.invalidateQueries({
      queryKey: courseWorkspaceKey(actor, course.id),
    });
  const setting = useMutation({
    mutationFn: async (choice: boolean) => {
      const version = course.exams.version;
      if (!online || !canEdit || version === null)
        throw new Error("exam_editor_required");
      const { data, error } = await db().rpc("set_course_exam_required", {
        p_run_id: course.id,
        p_required: choice,
        p_expected_version: version,
      });
      if (error) throw error;
      if (data?.required !== choice || data.version !== version + 1)
        throw new Error("unconfirmed");
    },
    onSuccess: refresh,
  });
  const share = useMutation({
    mutationFn: async () => {
      if (!file || file.type !== "application/pdf")
        throw new Error("pdf_required");
      const document = await uploadDocument(file, {
        scope: "personal",
        kind: "material",
      });
      if (!document.current_version_id)
        throw new Error("clean_version_required");
      const { error } = await db().rpc("share_course_exam_pdf", {
        p_run_id: course.id,
        p_version_id: document.current_version_id,
        p_audience: audience,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setFile(null);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db().rpc("remove_course_exam_pdf", {
        p_run_id: course.id,
        p_exam_id: id,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const download = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      downloadCourseDocument("exam", id, name),
  });
  const stale =
    setting.isError &&
    "code" in setting.error &&
    setting.error.code === "PT409";

  // No exam area is rendered for a participant while this course's switch is OFF.
  if (
    !canEdit &&
    !course.exams.required &&
    !(academy && (course.access.staff || course.access.client))
  )
    return null;
  return (
    <section className="panel learning-panel" aria-label={t("title")}>
      <h2>{t("title")}</h2>
      {academy && (
        <p>{t(course.exams.required ? "required" : "notRequired")}</p>
      )}
      {canEdit && (
        <>
          {!academy && <p>{t("settingHelp")}</p>}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !stale &&
                !setting.isPending &&
                required !== course.exams.required
              )
                setting.mutate(required);
            }}
          >
            <Field id="exam-required" label={t("title")}>
              <select
                id="exam-required"
                value={required ? "yes" : "no"}
                onChange={(event) => setRequired(event.target.value === "yes")}
                disabled={!online || setting.isPending || stale}
              >
                <option value="yes">{t("required")}</option>
                <option value="no">{t("notRequired")}</option>
              </select>
            </Field>
            <Button
              disabled={
                !online ||
                setting.isPending ||
                stale ||
                required === course.exams.required
              }
            >
              {t("saveSetting")}
            </Button>
          </form>
          {!academy && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                share.mutate();
              }}
            >
              <Field id="exam-file" label={t("file")}>
                <input
                  id="exam-file"
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  disabled={!online || share.isPending}
                />
              </Field>
              <Field id="exam-audience" label={t("audience")}>
                <select
                  id="exam-audience"
                  value={audience}
                  onChange={(event) =>
                    setAudience(event.target.value as "students" | "exam_staff")
                  }
                  disabled={!online || share.isPending}
                >
                  <option value="students">{t("students")}</option>
                  {course.access.staff && (
                    <option value="exam_staff">{t("exam_staff")}</option>
                  )}
                </select>
              </Field>
              <Button disabled={!online || share.isPending || !file}>
                {t("upload")}
              </Button>
            </form>
          )}
        </>
      )}
      {!academy && !course.exams.documents.length && <p>{t("empty")}</p>}
      {!academy && course.exams.documents.length > 0 && (
        <ul className="learning-resources">
          {course.exams.documents.map((document) => (
            <li key={document.id}>
              <strong>{document.name}</strong>
              <span>
                {t("version", { version: document.version })} ·{" "}
                {t(document.audience)}
              </span>
              <div className="page-actions">
                <Button
                  variant="secondary"
                  disabled={!online || download.isPending}
                  onClick={() =>
                    download.mutate({ id: document.id, name: document.name })
                  }
                >
                  {t("download")}
                </Button>
                {canEdit && (
                  <Button
                    variant="ghost"
                    disabled={!online || remove.isPending}
                    onClick={() => remove.mutate(document.id)}
                  >
                    {t("remove")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {(setting.isSuccess || share.isSuccess || remove.isSuccess) && (
        <Notice>{t("saved")}</Notice>
      )}
      {(setting.isError ||
        share.isError ||
        remove.isError ||
        download.isError) && (
        <Notice kind="error">{t(stale ? "conflict" : "error")}</Notice>
      )}
      {stale && (
        <Button variant="secondary" onClick={() => void refresh()}>
          {t("refresh")}
        </Button>
      )}
    </section>
  );
}
