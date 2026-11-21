/** Shared course files use the existing scanned, versioned document pipeline. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Field, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import {
  acceptedFiles,
  uploadAcademyCourseMaterial,
  uploadDocument,
} from "../files/api";
import {
  courseAction,
  type CourseWorkspace,
  courseWorkspaceKey,
  downloadCourseDocument,
  shareAcademyCourseMaterial,
} from "./api";

/** Preserve the exact authorised byte gateway for resources and certificates. */
export function DownloadButton({
  kind,
  id,
  name,
  label,
}: {
  kind: "resource" | "attendance" | "completion";
  id: string;
  name: string;
  label?: string;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const download = useMutation({
    mutationFn: () => downloadCourseDocument(kind, id, name),
  });
  return (
    <>
      <Button
        variant="secondary"
        aria-label={label}
        disabled={!online || download.isPending}
        onClick={() => download.mutate()}
      >
        <Download size={16} aria-hidden="true" />
        {t("download")}
      </Button>
      {download.isError && (
        <Notice kind="error">
          {t(
            download.error.message === "unsupported_glyph"
              ? "unsupportedGlyph"
              : "downloadError",
          )}
        </Notice>
      )}
    </>
  );
}

/** Publish only a server-confirmed clean version; failed sharing leaves a private personal upload. */
export function Resources({
  course,
  actor,
  readOnly = false,
  academyCanUpload = false,
}: {
  course: CourseWorkspace;
  actor: string;
  readOnly?: boolean;
  academyCanUpload?: boolean;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const client = useQueryClient();
  const [file, setFile] = useState<{ bytes: File; uploadId: string } | null>(
    null,
  );
  const [cleanVersion, setCleanVersion] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [progress, setProgress] = useState(0);
  const [version, setVersion] = useState("");
  const [audience, setAudience] = useState("all");
  const [category, setCategory] = useState("material");
  const [reviewedAudience, setReviewedAudience] = useState("all");
  const [reviewedCategory, setReviewedCategory] = useState("material");
  const refresh = () =>
    client.invalidateQueries({
      queryKey: courseWorkspaceKey(actor, course.id),
    });
  const save = useMutation({
    mutationFn: ({
      action,
      payload,
    }: {
      action: string;
      payload: Record<string, unknown>;
    }) => courseAction(course.id, action, payload),
    onSuccess: refresh,
  });
  const upload = useMutation({
    mutationFn: async () => {
      let versionId = cleanVersion;
      if (!versionId) {
        if (!file || file.bytes.size < 1 || file.bytes.size > 10 * 1024 * 1024)
          throw new Error("file_size");
        setProgress(0);
        const document = academyCanUpload
          ? await uploadAcademyCourseMaterial(
              file.bytes,
              course.id,
              file.uploadId,
              setProgress,
            )
          : await uploadDocument(
              file.bytes,
              { scope: "personal", kind: "material", clientId: file.uploadId },
              setProgress,
            );
        if (document.status !== "clean" || !document.current_version_id)
          throw new Error("missing_clean_version");
        versionId = document.current_version_id;
        setCleanVersion(versionId);
      }
      if (academyCanUpload)
        return shareAcademyCourseMaterial(
          course.id,
          versionId,
          audience,
          category,
        );
      return courseAction(course.id, "resource_share", {
        version_id: versionId,
        audience,
        category,
      });
    },
    onSuccess: () => {
      setFile(null);
      setCleanVersion(null);
      setFileInputKey((value) => value + 1);
      void refresh();
    },
  });
  const canUpload =
    academyCanUpload ||
    (!readOnly &&
      (course.access.manager || course.access.teacher || course.access.client));
  return (
    <section className="panel learning-panel" aria-label={t("resources")}>
      <h2>{t("resources")}</h2>
      {!readOnly && <p>{t("resourceHelp")}</p>}
      {!course.resources.length && <p>{t("noResources")}</p>}
      <ul className="learning-resources">
        {course.resources.map((resource) => (
          <li key={resource.id}>
            <strong>{resource.name}</strong>
            <small>
              {t("version", { version: resource.version })} ·{" "}
              {t(resource.category)} · {t(`owner_${resource.ownership_kind}`)}
            </small>
            <div className="form-actions">
              <DownloadButton
                kind="resource"
                id={resource.id}
                name={resource.name}
              />
              {!readOnly && (
                <Button
                  variant="ghost"
                  disabled={!online || save.isPending || resource.acknowledged}
                  onClick={() =>
                    save.mutate({
                      action: "resource_acknowledge",
                      payload: { id: resource.id },
                    })
                  }
                >
                  {t(resource.acknowledged ? "acknowledged" : "acknowledge")}
                </Button>
              )}
              {!readOnly && resource.can_remove && (
                <Button
                  variant="ghost"
                  disabled={!online || save.isPending}
                  onClick={() =>
                    save.mutate({
                      action: "resource_remove",
                      payload: { id: resource.id },
                    })
                  }
                >
                  {t("unshare")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {canUpload && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (online && file && !upload.isPending && !save.isPending)
              upload.mutate();
          }}
        >
          <h3>{t("uploadCourseFile")}</h3>
          <p>{t("uploadCourseFileHelp")}</p>
          <Field id="course-file" label={t("chooseCourseFile")}>
            <input
              key={fileInputKey}
              id="course-file"
              type="file"
              accept={acceptedFiles}
              required
              disabled={upload.isPending}
              onChange={(event) => {
                const bytes = event.currentTarget.files?.[0];
                upload.reset();
                setCleanVersion(null);
                setFile(
                  bytes ? { bytes, uploadId: crypto.randomUUID() } : null,
                );
              }}
            />
          </Field>
          <Field id="upload-resource-audience" label={t("audience")}>
            <select
              id="upload-resource-audience"
              value={audience}
              disabled={upload.isPending || !!cleanVersion}
              onChange={(event) => setAudience(event.target.value)}
            >
              {["all", "staff", "client", "participants"].map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="upload-resource-category" label={t("category")}>
            <select
              id="upload-resource-category"
              value={category}
              disabled={upload.isPending || !!cleanVersion}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="material">{t("material")}</option>
              <option value="report">{t("report")}</option>
            </select>
          </Field>
          {upload.isPending && (
            <p role="status">
              {cleanVersion
                ? t("courseFileConfirmingShare")
                : t("uploadProgress", { progress })}
            </p>
          )}
          <Button
            type="submit"
            disabled={!online || !file || upload.isPending || save.isPending}
          >
            {t(cleanVersion ? "courseFileRetryShare" : "uploadAndShare")}
          </Button>
          {upload.isSuccess && <Notice>{t("courseFileShared")}</Notice>}
          {upload.isError && (
            <Notice kind="error">
              {t(
                cleanVersion ? "courseFileShareError" : "courseFileUploadError",
              )}
            </Notice>
          )}
        </form>
      )}
      {!readOnly && course.access.manager && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({
              action: "resource_share",
              payload: {
                version_id: version,
                audience: reviewedAudience,
                category: reviewedCategory,
              },
            });
          }}
        >
          <Field id="share-version" label={t("reviewedVersion")}>
            <select
              id="share-version"
              value={version}
              required
              onChange={(event) => setVersion(event.target.value)}
            >
              <option value="">{t("choose")}</option>
              {course.share_options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.version}
                </option>
              ))}
            </select>
          </Field>
          <Field id="resource-audience" label={t("audience")}>
            <select
              id="resource-audience"
              value={reviewedAudience}
              onChange={(event) => setReviewedAudience(event.target.value)}
            >
              {["all", "staff", "client", "participants"].map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="resource-category" label={t("category")}>
            <select
              id="resource-category"
              value={reviewedCategory}
              onChange={(event) => setReviewedCategory(event.target.value)}
            >
              <option value="material">{t("material")}</option>
              <option value="report">{t("report")}</option>
            </select>
          </Field>
          <Button disabled={!online || save.isPending || !version}>
            {t("share")}
          </Button>
        </form>
      )}
      {save.isError && <Notice kind="error">{t("saveError")}</Notice>}
    </section>
  );
}
