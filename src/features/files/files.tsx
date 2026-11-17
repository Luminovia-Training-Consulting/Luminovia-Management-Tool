/**
 * File centre with drop uploads, version-bound previews and history. Captured
 * dialogs recheck exact resource access independently of filtered result pages;
 * transferred upload bytes alone do not confirm scan clearance.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  focusManager,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FileDown,
  FileUp,
  FolderOpen,
  History,
  Image,
  Info,
  Tags,
  Trash2,
} from "lucide-react";
import { ArchivedPersonalMaterials } from "./archived-personal";
import { deletionAccessQuery } from "../deletions/api";
import { PermanentDeleteAction } from "../deletions/deletions";
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
  documentQuery,
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
/** Map upload failures to the known translated UI keys. */
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
/** Keep file selection and retry identity together; clear the draft only after successful upload/scan completion. */
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
      // An initial in-flight list or version read can predate this committed
      // upload. Cancel it before refetching so its older snapshot cannot hide
      // the newly confirmed document or replacement.
      await client.cancelQueries({ queryKey: ["documents"] });
      await client.cancelQueries({ queryKey: ["document"] });
      await client.cancelQueries({ queryKey: ["document-versions"] });
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
/** Bind metadata and bytes to the same version and dispose Blob URLs created by late responses. */
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
/** Load authorized history and offer downloads only for clean versions. */
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
/** A captured target has an independent query generation per successful list
 * epoch/focus. An older in-flight grant cannot satisfy the newer ACL check.
 */
function CapturedDocumentGuard({
  file,
  actor,
  epoch,
  onRevoked,
  children,
}: {
  file: PortalDocument;
  actor: string;
  epoch?: string;
  onRevoked: () => void;
  children: (
    authorised: boolean,
    status: ReactNode,
    exact: PortalDocument | null,
  ) => ReactNode;
}) {
  const online = useOnline();
  const [focusEpoch, setFocusEpoch] = useState(0);
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (focused) setFocusEpoch((previous) => previous + 1);
      }),
    [],
  );
  const base = documentQuery(actor, file.id);
  const exact = useQuery({
    ...base,
    queryKey: [
      ...base.queryKey,
      "captured-dialog",
      epoch ?? "opening",
      String(focusEpoch),
    ],
    enabled: online,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
  const valid = Boolean(
    exact.data &&
    typeof exact.data === "object" &&
    exact.data.id === file.id &&
    exact.data.deleted_at === null,
  );
  const rejected =
    !exact.isFetching &&
    ((exact.isSuccess && !valid) || documentPermissionDenied(exact.error));
  useEffect(() => {
    if (rejected) onRevoked();
  }, [rejected, onRevoked]);
  if (rejected) return null;
  const authorised = online && exact.isSuccess && !exact.isFetching && valid;
  return children(
    authorised,
    exact.isError ? (
      <ErrorState retry={() => void exact.refetch()} />
    ) : !authorised ? (
      <Loading />
    ) : null,
    authorised ? exact.data! : null,
  );
}
function documentPermissionDenied(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "42501",
  );
}
/** Render only freshly authorized metadata; resolve the exact current version through RLS. */
export function DocumentDetails({
  file,
  actor,
}: {
  file: PortalDocument;
  actor: string;
}) {
  const { t, i18n } = useTranslation("files");
  const version = useQuery({
    queryKey: [
      "document-details-version",
      actor,
      file.id,
      file.current_version_id,
    ],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .from("document_versions")
        .select("version")
        .eq("document_id", file.id)
        .eq("id", file.current_version_id!)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      return data as { version: number } | null;
    },
    enabled: Boolean(file.current_version_id),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  return (
    <dl className="document-details">
      <dt>{t("name")}</dt>
      <dd>{file.original_name}</dd>
      <dt>{t("detailsType")}</dt>
      <dd>{file.mime_type}</dd>
      <dt>{t("detailsSize")}</dt>
      <dd>
        {file.size_bytes.toLocaleString(i18n.language)} {t("detailsBytes")}
      </dd>
      <dt>{t("detailsVersion")}</dt>
      <dd>
        {!file.current_version_id
          ? "—"
          : version.isFetching
            ? t("detailsLoading")
            : version.isError || !version.data
              ? t("detailsUnavailable")
              : version.data.version}
      </dd>
      <dt>{t("detailsScan")}</dt>
      <dd>{t(file.status)}</dd>
      <dt>{t("scope")}</dt>
      <dd>{t(file.scope)}</dd>
      <dt>{t("kind")}</dt>
      <dd>{t(file.kind)}</dd>
      <dt>{t("uploaded")}</dt>
      <dd>{dateTime(file.created_at, i18n.language, "UTC")} UTC</dd>
    </dl>
  );
}
/** Keep captured dialogs independent of filtered lists while revalidating their exact targets. */
function DocumentList({
  files,
  pending = false,
  verificationEpoch,
  renewalEpoch,
}: {
  files: PortalDocument[];
  pending?: boolean;
  verificationEpoch?: string;
  renewalEpoch?: string;
}) {
  const { t, i18n } = useTranslation("files");
  const { session } = useAuth();
  const deletionAccess = useQuery(deletionAccessQuery(session!.user.id));
  const canDelete =
    !deletionAccess.isError &&
    Boolean(deletionAccess.data?.kinds.includes("document"));
  const client = useQueryClient();
  const online = useOnline();
  const [selected, setSelected] = useState<PortalDocument | null>(null);
  const [mode, setMode] = useState<
    "preview" | "versions" | "details" | "rename" | "archive" | "replace"
  >("preview");
  const [name, setName] = useState<{ id: string | null; value: string }>({
    id: null,
    value: "",
  });
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [organising, setOrganising] = useState<PortalDocument | null>(null);
  // Filter loading may remove the row DOM. Retain only one presentation ID;
  // the menu and its actions still require a current authorised list row.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [epochs, setEpochs] = useState<{
    current?: string;
    revision: number;
    observed: Record<string, number>;
  }>(() => ({
    current: verificationEpoch,
    revision: renewalEpoch === undefined ? 0 : 1,
    observed: renewalEpoch === undefined ? {} : { [renewalEpoch]: 1 },
  }));
  const newRenewal =
    renewalEpoch !== undefined && epochs.observed[renewalEpoch] === undefined;
  if (
    (verificationEpoch !== undefined && verificationEpoch !== epochs.current) ||
    newRenewal
  ) {
    const revision = newRenewal ? epochs.revision + 1 : epochs.revision;
    setEpochs({
      current: verificationEpoch ?? epochs.current,
      revision,
      observed: newRenewal
        ? { ...epochs.observed, [renewalEpoch]: revision }
        : epochs.observed,
    });
  }
  const currentEpoch = epochs.current;
  const currentRevision =
    renewalEpoch === undefined ? 0 : epochs.observed[renewalEpoch];
  const [revokedAt, setRevokedAt] = useState<Record<string, number>>({});
  // Returning to another already-observed filter cache is not a renewed grant.
  // Only a genuinely newer successful response may restore quarantined rows.
  const visibleFiles = files.filter(
    (file) =>
      !Object.hasOwn(revokedAt, file.id) ||
      currentRevision > revokedAt[file.id],
  );
  const discardTarget = (id: string) => {
    setRevokedAt((previous) => ({ ...previous, [id]: epochs.revision }));
    setOpenMenuId((previous) => (previous === id ? null : previous));
    setSelected((previous) => (previous?.id === id ? null : previous));
    setOrganising((previous) => (previous?.id === id ? null : previous));
    setName((previous) =>
      previous.id === id ? { id: null, value: "" } : previous,
    );
  };
  const change = useMutation({
    mutationFn: async (input: {
      id: string;
      name: string;
      archive: boolean;
    }) => {
      requireOnline();
      const { error } = await db().rpc("rename_document", {
        p_id: input.id,
        p_name: input.name,
        p_delete: input.archive,
      });
      if (error) throw error;
    },
    onSuccess: async (_result, input) => {
      if (input.archive)
        setOpenMenuId((previous) => (previous === input.id ? null : previous));
      // Invalidation alone reuses an initial fetch that has no cached data.
      // Cancel pre-commit reads explicitly so their older snapshot cannot
      // restore an archived row or an earlier filename after this write.
      await client.cancelQueries({ queryKey: ["documents"] });
      await client.invalidateQueries({ queryKey: ["documents"] });
      setSelected((previous) => (previous?.id === input.id ? null : previous));
    },
    onError: (error, input) => {
      if (documentPermissionDenied(error)) discardTarget(input.id);
    },
  });
  const select = (file: PortalDocument, value: typeof mode) => {
    change.reset();
    setFailed(false);
    setName({ id: file.id, value: file.original_name });
    setMode(value);
    setSelected(file);
  };
  return (
    <>
      {/* Empty results do not cancel an already captured operation. The
          explorer owns the access-error boundary and unmounts us on denial. */}
      {!visibleFiles.length && !pending && (
        <div className="empty-state">
          <FolderOpen size={32} />
          <p>{t("empty")}</p>
        </div>
      )}
      <ul className="document-list">
        {visibleFiles.map((file) => (
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
                aria-label={`${t("details")}: ${file.original_name}`}
                disabled={!online}
                onClick={() => select(file, "details")}
              >
                <Info size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t("versions")}: ${file.original_name}`}
                onClick={() => select(file, "versions")}
              >
                <History size={18} />
              </Button>
              {(file.owner_id === session!.user.id || canDelete) && (
                <details open={openMenuId === file.id}>
                  <summary
                    aria-label={`${t("name")}: ${file.original_name}`}
                    onClick={(event) => {
                      // Summary activation also covers Enter/Space. Keeping
                      // the native toggle out of state avoids queued events
                      // from a detached row closing a newer document's menu.
                      event.preventDefault();
                      setOpenMenuId((previous) =>
                        previous === file.id ? null : file.id,
                      );
                    }}
                  >
                    ···
                  </summary>
                  <div className="file-more">
                    {file.owner_id === session!.user.id && (
                      <>
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
                      </>
                    )}
                    <PermanentDeleteAction
                      kind="document"
                      id={file.id}
                      label={file.original_name}
                    />
                  </div>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>
      {failed && <Notice kind="error">{t("error")}</Notice>}
      {organising && (
        <CapturedDocumentGuard
          key={`organisation:${organising.id}:${organising.personal_version}`}
          file={organising}
          actor={session!.user.id}
          epoch={currentEpoch}
          onRevoked={() => discardTarget(organising.id)}
        >
          {(authorised, accessStatus) => (
            <DocumentOrganiser
              file={organising}
              onClose={() =>
                setOrganising((current) =>
                  current?.id === organising.id ? null : current,
                )
              }
              authorised={authorised}
              accessStatus={accessStatus}
              onDenied={() => discardTarget(organising.id)}
            />
          )}
        </CapturedDocumentGuard>
      )}
      {selected && (
        <CapturedDocumentGuard
          key={`selected:${selected.id}:${mode}`}
          file={selected}
          actor={session!.user.id}
          epoch={currentEpoch}
          onRevoked={() => discardTarget(selected.id)}
        >
          {(authorised, accessStatus, exact) => (
            <Dialog
              open={selected !== null}
              onOpenChange={(open) => {
                if (!open)
                  setSelected((current) =>
                    current?.id === selected.id ? null : current,
                  );
              }}
              title={
                mode === "archive"
                  ? t("archiveTitle")
                  : mode === "rename"
                    ? t("rename")
                    : mode === "replace"
                      ? t("replace")
                      : mode === "details"
                        ? t("details")
                        : mode === "versions"
                          ? t("versions")
                          : t("preview")
              }
              description={
                mode === "archive"
                  ? t("archiveDescription", { name: selected?.original_name })
                  : mode === "details"
                    ? ""
                    : (selected?.original_name ?? "")
              }
            >
              {accessStatus}
              {selected && (
                <fieldset
                  disabled={!authorised}
                  style={{ border: 0, padding: 0, margin: 0 }}
                >
                  {mode === "details" ? (
                    exact && (
                      <DocumentDetails file={exact} actor={session!.user.id} />
                    )
                  ) : mode === "preview" ? (
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
                      onDone={() =>
                        setSelected((current) =>
                          current?.id === selected.id ? null : current,
                        )
                      }
                    />
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (authorised)
                          change.mutate({
                            id: selected.id,
                            name: name.value,
                            archive: mode === "archive",
                          });
                      }}
                    >
                      {mode === "rename" && (
                        <Field id="document-name" label={t("name")}>
                          <input
                            id="document-name"
                            value={name.value}
                            maxLength={200}
                            onChange={(e) =>
                              setName({
                                id: selected.id,
                                value: e.target.value,
                              })
                            }
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
                      {change.isError &&
                        change.variables?.id === selected.id && (
                          <Notice kind="error">{t("error")}</Notice>
                        )}
                    </form>
                  )}
                </fieldset>
              )}
            </Dialog>
          )}
        </CapturedDocumentGuard>
      )}
    </>
  );
}
/** Bind files to a specific business context using the shared upload/list contract. */
export function SubjectDocuments({
  ownerId,
  kind,
}: {
  ownerId: string;
  kind?: string;
}) {
  const { session } = useAuth();
  const client = useQueryClient();
  const options = documentsQuery(session!.user.id, ownerId, kind);
  const files = useQuery(options);
  const epoch = `${JSON.stringify(options.queryKey)}:${client.getQueryState(options.queryKey)?.dataUpdateCount}`;
  if (files.isPending) return <Loading />;
  if (files.isError) return <ErrorState />;
  return (
    <DocumentList
      files={files.data}
      verificationEpoch={epoch}
      renewalEpoch={
        files.isFetchedAfterMount && !files.isFetching ? epoch : undefined
      }
    />
  );
}
/** Separate pre-/post-claim job materials and expose administrative uploads only as the applicable UI action. */
export function JobDocuments({
  jobId,
  canManage,
}: {
  jobId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation("files");
  const { session } = useAuth();
  const client = useQueryClient();
  const options = documentsQuery(session!.user.id, undefined, undefined, jobId);
  const files = useQuery(options);
  const epoch = `${JSON.stringify(options.queryKey)}:${client.getQueryState(options.queryKey)?.dataUpdateCount}`;
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
        <DocumentList
          files={files.data}
          verificationEpoch={epoch}
          renewalEpoch={
            files.isFetchedAfterMount && !files.isFetching ? epoch : undefined
          }
        />
      )}
    </section>
  );
}
/** Filter the currently loaded file set by name/context; complete server-side discovery remains separate work. */
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
        <ArchivedPersonalMaterials actor={session!.user.id} />
        <DocumentExplorer key={session!.user.id} actor={session!.user.id}>
          {(rows, pending, epoch, renewalEpoch) => (
            <DocumentList
              files={rows}
              pending={pending}
              verificationEpoch={epoch}
              renewalEpoch={renewalEpoch}
            />
          )}
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
