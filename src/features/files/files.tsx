import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FileDown,
  FileUp,
  FolderOpen,
  History,
  Image,
  Tags,
  Trash2,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { permissionsQuery } from "../../lib/queries";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import {
  acceptedFiles,
  downloadDocument,
  documentsQuery,
  maximumFileSize,
  saveDownload,
  uploadDocument,
  type PortalDocument,
  type UploadContext,
} from "./api";
import "./i18n";
import "./files.css";
import { DocumentExplorer, DocumentOrganiser } from "./discovery";
import { JobPicker } from "../jobs/picker";
function fileError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return [
    "file_size",
    "unsupported_type",
    "scan_rejected",
    "scanner_unavailable",
  ].includes(code)
    ? code
    : "error";
}
export function FileUpload({
  context,
  onDone,
}: {
  context: UploadContext;
  onDone?: (document: PortalDocument) => void;
}) {
  const { t } = useTranslation("files");
  const online = useOnline();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const clientId = useRef(crypto.randomUUID());
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("file_size");
      requireOnline();
      return await uploadDocument(
        file,
        { ...context, clientId: clientId.current },
        setProgress,
      );
    },
    onSuccess: async (document) => {
      await client.invalidateQueries({ queryKey: ["documents"] });
      await client.invalidateQueries({ queryKey: ["document"] });
      await client.invalidateQueries({ queryKey: ["document-versions"] });
      setFile(null);
      clientId.current = crypto.randomUUID();
      if (input.current) input.current.value = "";
      onDone?.(document);
    },
  });
  const choose = (value: File | undefined) => {
    if (!value) return;
    setError("");
    upload.reset();
    if (value.size < 1 || value.size > maximumFileSize) {
      setError("file_size");
      return;
    }
    setFile(value);
    setProgress(0);
    clientId.current = crypto.randomUUID();
  };
  return (
    <div>
      <div
        className={`file-drop ${drag ? "is-dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!upload.isPending) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!upload.isPending) choose(e.dataTransfer.files[0]);
        }}
      >
        <FileUp size={28} />
        <label
          htmlFor={`file-${context.replaceId ?? context.jobId ?? context.ownerId ?? context.kind ?? "personal"}`}
        >
          {t("choose")}
        </label>
        <input
          id={`file-${context.replaceId ?? context.jobId ?? context.ownerId ?? context.kind ?? "personal"}`}
          ref={input}
          type="file"
          accept={acceptedFiles}
          disabled={!online || upload.isPending}
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <small>{t("types")}</small>
      </div>
      {file && (
        <p className="selected-file">
          {file.name} ·{" "}
          {(file.size / 1024).toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}{" "}
          KB
        </p>
      )}
      {upload.isPending && (
        <div role="status" className="upload-progress">
          <progress max={100} value={progress} aria-label={t("upload")} />
          <span>{t("uploading", { percent: progress })}</span>
        </div>
      )}
      <Button
        type="button"
        disabled={!file || !online || upload.isPending}
        onClick={() => upload.mutate()}
      >
        <FileUp size={17} />
        {t(context.replaceId ? "replace" : "upload")}
      </Button>
      {upload.isSuccess && <Notice>{t("saved")}</Notice>}
      {(error || upload.isError) && (
        <Notice kind="error">{t(error || fileError(upload.error))}</Notice>
      )}
    </div>
  );
}
function Preview({ file }: { file: PortalDocument }) {
  const { t } = useTranslation("files");
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let object = "";
    // A row's name/MIME and bytes must describe the same reviewed version,
    // even if another client replaces the document during this download.
    void downloadDocument(file.id, file.current_version_id)
      .then((blob) => {
        object = URL.createObjectURL(blob);
        if (alive) setUrl(object);
        else URL.revokeObjectURL(object);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [file.id, file.current_version_id]);
  if (failed) return <Notice kind="error">{t("error")}</Notice>;
  if (!url) return <Loading />;
  return file.mime_type.startsWith("image/") ? (
    <img className="file-preview-image" src={url} alt={file.original_name} />
  ) : file.mime_type === "application/pdf" ? (
    <iframe
      className="file-preview-pdf"
      title={file.original_name}
      sandbox="allow-same-origin"
      src={url}
    />
  ) : (
    <p>{t("noPreview")}</p>
  );
}
function Versions({ file }: { file: PortalDocument }) {
  const { t, i18n } = useTranslation("files");
  const online = useOnline();
  const [failed, setFailed] = useState(false);
  const versions = useQuery({
    queryKey: ["document-versions", file.id],
    queryFn: async () => {
      const { data, error } = await db()
        .from("document_versions")
        .select("id,version,status,created_at,original_name,sha256")
        .eq("document_id", file.id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data as {
        id: string;
        version: number;
        status: string;
        created_at: string;
        original_name: string;
        sha256: string;
      }[];
    },
  });
  if (versions.isPending) return <Loading />;
  if (versions.isError) return <ErrorState />;
  return (
    <>
      <ul className="document-versions">
        {versions.data.map((v) => (
          <li key={v.id}>
            <div>
              <strong>
                {t("version", { number: v.version })} · {t(v.status)}
              </strong>
              <small>{dateTime(v.created_at, i18n.language, "UTC")} UTC</small>
              {v.sha256 && (
                <small className="file-hash">SHA-256 {v.sha256}</small>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t("download")} ${t("version", { number: v.version })}`}
              disabled={!online || v.status !== "clean"}
              onClick={async () => {
                try {
                  await saveDownload(file.id, v.original_name, v.id);
                } catch {
                  setFailed(true);
                }
              }}
            >
              <FileDown size={18} />
            </Button>
          </li>
        ))}
      </ul>
      {failed && <Notice kind="error">{t("error")}</Notice>}
    </>
  );
}
function DocumentList({ files }: { files: PortalDocument[] }) {
  const { t, i18n } = useTranslation("files");
  const { session } = useAuth();
  const client = useQueryClient();
  const online = useOnline();
  const [selected, setSelected] = useState<PortalDocument | null>(null);
  const [mode, setMode] = useState<
    "preview" | "versions" | "rename" | "archive" | "replace"
  >("preview");
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [organising, setOrganising] = useState<PortalDocument | null>(null);
  const change = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("rename_document", {
        p_id: selected!.id,
        p_name: name,
        p_delete: mode === "archive",
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["documents"] });
      setSelected(null);
    },
  });
  const select = (file: PortalDocument, value: typeof mode) => {
    change.reset();
    setFailed(false);
    setName(file.original_name);
    setMode(value);
    setSelected(file);
  };
  if (!files.length)
    return (
      <div className="empty-state">
        <FolderOpen size={32} />
        <p>{t("empty")}</p>
      </div>
    );
  return (
    <>
      <ul className="document-list">
        {files.map((file) => (
          <li key={file.id}>
            <div className="file-icon">
              <FolderOpen size={23} />
            </div>
            <div className="file-info">
              <strong>{file.original_name}</strong>
              <small>
                {t(file.kind)} · {t(file.scope)} ·{" "}
                {(file.size_bytes / 1024).toLocaleString(i18n.language, {
                  maximumFractionDigits: 1,
                })}{" "}
                KB
              </small>
              <span className={`file-status status-${file.status}`}>
                {t(file.status)}
              </span>
              {file.personal_folder && (
                <small className="file-personal-folder">
                  {t("ownFolder")}: {file.personal_folder}
                </small>
              )}
              {Boolean(file.personal_tags?.length) && (
                <div className="file-personal-tags">
                  {file.personal_tags!.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="file-actions">
              {file.personal_version !== undefined && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("organise")}: ${file.original_name}`}
                  disabled={!online}
                  onClick={() => setOrganising(file)}
                >
                  <Tags size={18} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t("download")}: ${file.original_name}`}
                disabled={!online || busy || file.status !== "clean"}
                onClick={async () => {
                  setBusy(true);
                  setFailed(false);
                  try {
                    await saveDownload(
                      file.id,
                      file.original_name,
                      file.current_version_id,
                    );
                  } catch {
                    setFailed(true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <FileDown size={18} />
              </Button>
              {[
                "application/pdf",
                "image/png",
                "image/jpeg",
                "image/webp",
              ].includes(file.mime_type) && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("preview")}: ${file.original_name}`}
                  disabled={!online || file.status !== "clean"}
                  onClick={() => select(file, "preview")}
                >
                  <Image size={18} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t("versions")}: ${file.original_name}`}
                onClick={() => select(file, "versions")}
              >
                <History size={18} />
              </Button>
              {file.owner_id === session!.user.id && (
                <details>
                  <summary aria-label={`${t("name")}: ${file.original_name}`}>
                    ···
                  </summary>
                  <div className="file-more">
                    <Button
                      variant="ghost"
                      onClick={() => select(file, "rename")}
                    >
                      {t("rename")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => select(file, "replace")}
                    >
                      {t("replace")}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => select(file, "archive")}
                    >
                      <Trash2 size={14} />
                      {t("archive")}
                    </Button>
                  </div>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>
      {failed && <Notice kind="error">{t("error")}</Notice>}
      {organising && (
        <DocumentOrganiser
          key={`${organising.id}:${organising.personal_version}`}
          file={organising}
          onClose={() => setOrganising(null)}
        />
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={
          mode === "archive"
            ? t("archiveTitle")
            : mode === "rename"
              ? t("rename")
              : mode === "replace"
                ? t("replace")
                : mode === "versions"
                  ? t("versions")
                  : t("preview")
        }
        description={
          mode === "archive"
            ? t("archiveDescription", { name: selected?.original_name })
            : (selected?.original_name ?? "")
        }
      >
        {selected && (
          <>
            {mode === "preview" ? (
              <Preview
                key={`${selected.id}:${selected.current_version_id}`}
                file={selected}
              />
            ) : mode === "versions" ? (
              <Versions file={selected} />
            ) : mode === "replace" ? (
              <FileUpload
                context={{
                  scope: selected.scope,
                  roomId: selected.room_id ?? undefined,
                  jobId: selected.job_id ?? undefined,
                  kind: selected.kind,
                  replaceId: selected.id,
                  ownerId: selected.owner_id,
                }}
                onDone={() => setSelected(null)}
              />
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  change.mutate();
                }}
              >
                {mode === "rename" && (
                  <Field id="document-name" label={t("name")}>
                    <input
                      id="document-name"
                      value={name}
                      maxLength={200}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </Field>
                )}
                <Button
                  disabled={!online || change.isPending}
                  variant={mode === "archive" ? "danger" : "default"}
                >
                  {t(mode === "archive" ? "archive" : "rename")}
                </Button>
                {change.isError && <Notice kind="error">{t("error")}</Notice>}
              </form>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
export function SubjectDocuments({
  ownerId,
  kind,
}: {
  ownerId: string;
  kind?: string;
}) {
  const { session } = useAuth();
  const files = useQuery(documentsQuery(session!.user.id, ownerId, kind));
  if (files.isPending) return <Loading />;
  if (files.isError) return <ErrorState />;
  return <DocumentList files={files.data} />;
}
export function JobDocuments({
  jobId,
  canManage,
}: {
  jobId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation("files");
  const { session } = useAuth();
  const files = useQuery(
    documentsQuery(session!.user.id, undefined, undefined, jobId),
  );
  const [scope, setScope] = useState<UploadContext["scope"]>("job_before");
  return (
    <section className="panel job-documents">
      <h2>{t("title")}</h2>
      {canManage && (
        <details>
          <summary>{t("upload")}</summary>
          <Field id="job-file-visibility" label={t("scope")}>
            <select
              id="job-file-visibility"
              value={scope}
              onChange={(e) =>
                setScope(e.target.value as UploadContext["scope"])
              }
            >
              <option value="job_before">{t("job_before")}</option>
              <option value="job_after">{t("job_after")}</option>
            </select>
          </Field>
          <FileUpload key={scope} context={{ scope, jobId }} />
        </details>
      )}
      {files.isPending ? (
        <Loading />
      ) : files.isError ? (
        <ErrorState />
      ) : (
        <DocumentList files={files.data} />
      )}
    </section>
  );
}
export function FilesPage() {
  const { t } = useTranslation("files");
  const { session } = useAuth();
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("material");
  const [scope, setScope] = useState<UploadContext["scope"]>("personal");
  const [job, setJob] = useState("");
  return (
    <>
      <PageHeading
        title={t("title")}
        description={t("description")}
        action={
          <Button onClick={() => setOpen(true)}>
            <FileUp size={18} />
            {t("upload")}
          </Button>
        }
      />
      <section className="panel">
        <DocumentExplorer key={session!.user.id} actor={session!.user.id}>
          {(rows) => <DocumentList files={rows} />}
        </DocumentExplorer>
      </section>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("upload")}
        description={t("types")}
      >
        <Field id="upload-scope" label={t("scope")}>
          <select
            id="upload-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as UploadContext["scope"])}
          >
            <option value="personal">{t("personal")}</option>
            {permissions.data?.includes("jobs.manage") && (
              <>
                <option value="job_before">{t("job_before")}</option>
                <option value="job_after">{t("job_after")}</option>
              </>
            )}
          </select>
        </Field>
        {scope === "personal" ? (
          <Field id="upload-kind" label={t("kind")}>
            <select
              id="upload-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {["material", "cv", "certificate", "contract", "invoice"].map(
                (k) => (
                  <option key={k} value={k}>
                    {t(k)}
                  </option>
                ),
              )}
            </select>
          </Field>
        ) : null}
        {scope === "personal" ? (
          <FileUpload
            key={`${scope}:${kind}`}
            context={{ scope, kind }}
            onDone={() => setOpen(false)}
          />
        ) : permissions.data?.includes("jobs.manage") ? (
          <JobPicker
            key={`${session!.user.id}:${scope}`}
            actor={session!.user.id}
            purpose="job_attachment"
            value={job}
            onChange={setJob}
          >
            {(selected) =>
              selected && (
                <FileUpload
                  key={`${scope}:${selected.id}`}
                  context={{ scope, kind: "material", jobId: selected.id }}
                  onDone={() => setOpen(false)}
                />
              )
            }
          </JobPicker>
        ) : (
          <Notice kind="error">{t("jobPicker:denied")}</Notice>
        )}
      </Dialog>
    </>
  );
}
