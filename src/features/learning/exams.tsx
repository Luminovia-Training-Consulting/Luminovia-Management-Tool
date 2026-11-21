/** Optional course exam PDFs, attached only after the existing scanner confirms clean bytes. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { db } from "../../lib/supabase";
import { useOnline } from "../../lib/online";
import {
  uploadAcademyAnswerKeyPdf,
  uploadAcademyStudentExamPdf,
  uploadDocument,
} from "../files/api";
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
  const [version, setVersion] = useState("");
  const [examFile, setExamFile] = useState<{
    bytes: File;
    uploadId: string;
  } | null>(null);
  const [scannedExamVersion, setScannedExamVersion] = useState<string | null>(
    null,
  );
  const [fileInputRevision, setFileInputRevision] = useState(0);
  const canEdit = course.exams.can_edit && academy !== "grace";
  const canPublishStudentPaper =
    academy === "active" && canEdit && course.exams.required;
  const options = useQuery({
    queryKey: ["academy-student-exam-pdf-options", actor, course.id],
    enabled: Boolean(canPublishStudentPaper && online),
    retry: false,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_student_exam_pdf_options", {
          p_run_id: course.id,
        })
        .abortSignal(signal);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("invalid_exam_options");
      return data as { id: string; name: string; version: number }[];
    },
  });
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
  const publishVersion = async (
    selected: string,
    target: "students" | "exam_staff" = "students",
  ) => {
    if (
      !online ||
      !canPublishStudentPaper ||
      (target === "exam_staff" && !course.access.staff)
    )
      throw new Error("exam_editor_required");
    const { data, error } = await db().rpc("share_course_exam_pdf", {
      p_run_id: course.id,
      p_version_id: selected,
      p_audience: target,
    });
    if (error || typeof data !== "string")
      throw error ?? new Error("unconfirmed");
  };
  const publish = useMutation({
    mutationFn: async (selected: string) => {
      if (!options.data?.some((option) => option.id === selected))
        throw new Error("exam_editor_required");
      await publishVersion(selected);
    },
    onSuccess: async () => {
      setVersion("");
      await Promise.all([refresh(), options.refetch()]);
    },
  });
  const uploadExam = useMutation({
    mutationFn: async () => {
      if (!online || !canPublishStudentPaper || !examFile)
        throw new Error("exam_editor_required");
      const upload =
        audience === "exam_staff"
          ? uploadAcademyAnswerKeyPdf
          : uploadAcademyStudentExamPdf;
      if (audience === "exam_staff" && !course.access.staff)
        throw new Error("exam_editor_required");
      let approved = scannedExamVersion;
      if (!approved) {
        if (
          !examFile.bytes.name.toLowerCase().endsWith(".pdf") ||
          examFile.bytes.size < 1 ||
          examFile.bytes.size > 10 * 1024 * 1024
        )
          throw new Error("pdf_required");
        const document = await upload(
          examFile.bytes,
          course.id,
          examFile.uploadId,
        );
        if (document.status !== "clean" || !document.current_version_id)
          throw new Error("clean_version_required");
        approved = document.current_version_id;
        setScannedExamVersion(approved);
      }
      await publishVersion(approved, audience);
    },
    onSuccess: async () => {
      setExamFile(null);
      setScannedExamVersion(null);
      setFileInputRevision((value) => value + 1);
      await Promise.all([refresh(), options.refetch()]);
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
  const documents = academy
    ? course.exams.documents.filter((item) =>
        item.audience === "students"
          ? course.exams.required
          : course.access.staff,
      )
    : course.exams.documents;

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
      {canPublishStudentPaper && online && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (examFile && !uploadExam.isPending && !publish.isPending)
                uploadExam.mutate();
            }}
          >
            {course.access.staff && (
              <Field id="academy-exam-audience" label={t("audience")}>
                <select
                  id="academy-exam-audience"
                  value={audience}
                  disabled={uploadExam.isPending || publish.isPending}
                  onChange={(event) => {
                    setAudience(
                      event.target.value === "exam_staff"
                        ? "exam_staff"
                        : "students",
                    );
                    setExamFile(null);
                    setScannedExamVersion(null);
                    setFileInputRevision((value) => value + 1);
                    uploadExam.reset();
                  }}
                >
                  <option value="students">{t("students")}</option>
                  <option value="exam_staff">{t("exam_staff")}</option>
                </select>
              </Field>
            )}
            <Field
              id="academy-new-exam-pdf"
              label={t(
                audience === "exam_staff"
                  ? "answerKeyFile"
                  : "studentUploadFile",
              )}
            >
              <input
                id="academy-new-exam-pdf"
                key={fileInputRevision}
                type="file"
                accept=".pdf,application/pdf"
                disabled={uploadExam.isPending || publish.isPending}
                onChange={(event) => {
                  const bytes = event.target.files?.[0];
                  uploadExam.reset();
                  setScannedExamVersion(null);
                  setExamFile(
                    bytes ? { bytes, uploadId: crypto.randomUUID() } : null,
                  );
                }}
              />
            </Field>
            <Button
              disabled={!examFile || uploadExam.isPending || publish.isPending}
            >
              {t(
                scannedExamVersion
                  ? "retryStudentPublication"
                  : audience === "exam_staff"
                    ? "scanAnswerKey"
                    : "scanStudentPdf",
              )}
            </Button>
            {uploadExam.isPending && (
              <p role="status">
                {t(
                  scannedExamVersion
                    ? "publishingStudentPdf"
                    : "scanningStudentPdf",
                )}
              </p>
            )}
            {uploadExam.isError && (
              <Notice kind="error">
                {t(
                  scannedExamVersion
                    ? "studentPublicationFailed"
                    : "studentScanFailed",
                )}
              </Notice>
            )}
          </form>
          {options.isPending && <Loading />}
          {options.isError && (
            <ErrorState retry={() => void options.refetch()} />
          )}
          {options.isSuccess && !options.data.length && (
            <p>{t("noRetainedPdf")}</p>
          )}
          {options.isSuccess && options.data.length > 0 && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (version && !publish.isPending && !uploadExam.isPending)
                  publish.mutate(version);
              }}
            >
              <Field id="academy-exam-pdf" label={t("retainedPdf")}>
                <select
                  id="academy-exam-pdf"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  disabled={publish.isPending || uploadExam.isPending}
                >
                  <option value="">{t("selectRetainedPdf")}</option>
                  {options.data.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} ·{" "}
                      {t("version", { version: option.version })}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                disabled={!version || publish.isPending || uploadExam.isPending}
              >
                {t("publishRetainedPdf")}
              </Button>
            </form>
          )}
        </>
      )}
      {(!academy || course.exams.required) && !documents.length && (
        <p>{t("empty")}</p>
      )}
      {documents.length > 0 && (
        <ul className="learning-resources">
          {documents.map((document) => (
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
                {canEdit && (!academy || document.can_remove === true) && (
                  <Button
                    variant="ghost"
                    aria-label={
                      academy
                        ? t("withdrawNamed", { name: document.name })
                        : undefined
                    }
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
      {(setting.isSuccess ||
        share.isSuccess ||
        remove.isSuccess ||
        publish.isSuccess ||
        uploadExam.isSuccess) && <Notice>{t("saved")}</Notice>}
      {(setting.isError ||
        share.isError ||
        publish.isError ||
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
