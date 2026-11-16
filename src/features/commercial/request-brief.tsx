/** Customer request brief editor, explicit scanned-version sharing and immutable history. */
import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import {
  acceptedFiles,
  uploadDocument,
  type PortalDocument,
} from "../files/api";
import { downloadPortalDocument } from "../learning/api";
import type { ClientRequest } from "./commission-api";
import {
  initialRequestBrief,
  cleanRequestBrief,
  requestBriefKey,
  requestBriefQuery,
  requestHistory,
  saveRequestBrief,
  validRequestBrief,
  type RequestBrief,
  type RequestBriefView,
} from "./request-brief-api";
import "./request-brief-i18n";

/** Shared DE/EN fields for initial submission and pre-publication revisions. */
export function RequestBriefFields({
  value,
  onChange,
  disabled = false,
  prefix = "request-brief",
}: {
  value: RequestBrief;
  onChange: (value: RequestBrief) => void;
  disabled?: boolean;
  prefix?: string;
}) {
  const { t } = useTranslation("requestBrief");
  return (
    <fieldset className="platform-sessions">
      <legend>{t("title")}</legend>
      <div className="form-row">
        <Field id={`${prefix}-units`} label={t("units")}>
          <input
            id={`${prefix}-units`}
            type="number"
            min={1}
            max={9999}
            step={1}
            value={
              Number.isFinite(value.teaching_units) ? value.teaching_units : ""
            }
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, teaching_units: e.target.valueAsNumber })
            }
          />
        </Field>
        <Field id={`${prefix}-minutes`} label={t("unitMinutes")}>
          <select
            id={`${prefix}-minutes`}
            value={value.unit_minutes}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                unit_minutes: Number(e.target.value) as 45 | 60,
              })
            }
          >
            {[45, 60].map((n) => (
              <option key={n} value={n}>
                {t("minutes", { count: n })}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="muted">{t("timeHint")}</p>
      <p>
        {t("total", {
          minutes: Number.isFinite(value.teaching_units)
            ? value.teaching_units * value.unit_minutes
            : 0,
        })}
      </p>
      <Field id={`${prefix}-requirements`} label={t("requirements")}>
        <textarea
          id={`${prefix}-requirements`}
          rows={4}
          value={value.required_documents.join("\n")}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              required_documents: e.target.value.split("\n"),
            })
          }
        />
      </Field>
      <Field id={`${prefix}-instructions`} label={t("instructions")}>
        <textarea
          id={`${prefix}-instructions`}
          rows={3}
          maxLength={4000}
          value={value.instructions}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, instructions: e.target.value })}
        />
      </Field>
    </fieldset>
  );
}
/** Displays all retained history through bounded cursor pages without author identity or object paths. */
function History({
  request,
  actor,
  zone,
}: {
  request: string;
  actor: string;
  zone: string;
}) {
  const { t, i18n } = useTranslation("requestBrief");
  const history = useInfiniteQuery({
    queryKey: ["client-request-history", actor, request],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) =>
      requestHistory(request, pageParam, signal),
    getNextPageParam: (page) =>
      page.length === 25 ? page.at(-1)!.id : undefined,
  });
  if (history.isPending) return <Loading />;
  if (history.isError)
    return <ErrorState retry={() => void history.refetch()} />;
  return (
    <section>
      <h4>{t("history")}</h4>
      <ol className="platform-session-list">
        {history.data.pages.flat().map((row) => (
          <li key={row.id}>
            <div>
              <strong>{t(row.event)}</strong>
              <small>
                {dateTime(row.created_at, i18n.language, zone)} ·{" "}
                {t("revision", { version: row.snapshot.brief_version })}
              </small>
              <p>{row.snapshot.payload.title}</p>
              {row.snapshot.brief && (
                <>
                  <p>
                    {t("total", {
                      minutes:
                        row.snapshot.brief.teaching_units *
                        row.snapshot.brief.unit_minutes,
                    })}{" "}
                    ({row.snapshot.brief.teaching_units} ×{" "}
                    {row.snapshot.brief.unit_minutes})
                  </p>
                  <ul>
                    {row.snapshot.brief.required_documents.map(
                      (label, index) => (
                        <li key={index}>{label}</li>
                      ),
                    )}
                  </ul>
                  <p className="preserve-text">
                    {row.snapshot.brief.instructions}
                  </p>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {history.hasNextPage && (
        <Button
          variant="secondary"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {t("more")}
        </Button>
      )}
    </section>
  );
}
/** Keeps draft and expected version together until server confirmation or explicit reload. */
function BriefEditor({
  actor,
  request,
  view,
  onSaved,
  onReload,
}: {
  actor: string;
  request: ClientRequest;
  view: RequestBriefView;
  onSaved: () => Promise<void>;
  onReload: () => void;
}) {
  const { t } = useTranslation("requestBrief"),
    common = useTranslation().t;
  const online = useOnline();
  const [draft, setDraft] = useState<RequestBrief>(
    () => view.brief ?? initialRequestBrief(),
  );
  const [editing, setEditing] = useState(!view.brief),
    [file, setFile] = useState<File | null>(null),
    [category, setCategory] = useState<"material" | "report">("material"),
    [saved, setSaved] = useState(false);
  const uploaded = useRef<{ file: File; document: PortalDocument } | null>(
    null,
  );
  const save = useMutation({
    mutationFn: async (next: RequestBrief) => {
      requireOnline();
      const clean = cleanRequestBrief(next);
      if (!validRequestBrief(clean, request.sessions))
        throw new Error("invalid_brief");
      await saveRequestBrief(request.id, clean, view.version);
    },
    onSuccess: async () => {
      setSaved(true);
      setEditing(false);
      await onSaved();
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!file) throw new Error("invalid_brief");
      const document =
        uploaded.current?.file === file
          ? uploaded.current.document
          : await uploadDocument(file, { scope: "personal", kind: "material" });
      uploaded.current = { file, document };
      const next = {
        ...draft,
        documents: draft.documents.some(
          (item) => item.version_id === document.current_version_id,
        )
          ? draft.documents
          : [
              ...draft.documents,
              { version_id: document.current_version_id, category },
            ],
      };
      setDraft(next);
      if (!validRequestBrief(cleanRequestBrief(next), request.sessions))
        throw new Error("invalid_brief");
      await saveRequestBrief(request.id, cleanRequestBrief(next), view.version);
    },
    onSuccess: async () => {
      setFile(null);
      uploaded.current = null;
      setSaved(true);
      await onSaved();
    },
  });
  const download = useMutation({
    mutationFn: async (item: RequestBriefView["documents"][number]) =>
      downloadPortalDocument(
        {
          kind: "request_resource",
          request_id: request.id,
          id: item.version_id,
        },
        item.name,
      ),
  });
  const editable =
    view.editable && request.status === "submitted" && !request.job_id;
  const busy = save.isPending || upload.isPending;
  const failure = save.error ?? upload.error ?? download.error;
  return (
    <div data-request-brief={request.id}>
      {view.brief ? (
        <>
          <p>
            <strong>
              {t("total", {
                minutes: view.brief.teaching_units * view.brief.unit_minutes,
              })}
            </strong>{" "}
            ({view.brief.teaching_units} × {view.brief.unit_minutes})
          </p>
          <ul>
            {view.brief.required_documents.map((label, index) => (
              <li key={index}>{label}</li>
            ))}
          </ul>
          <p className="preserve-text">{view.brief.instructions}</p>
        </>
      ) : (
        <p>{t("missing")}</p>
      )}
      {editable ? (
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setEditing(!editing)}
          >
            {editing ? common("cancel") : t("edit")}
          </Button>
          {editing && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(draft);
              }}
            >
              <RequestBriefFields
                value={draft}
                onChange={setDraft}
                disabled={busy}
                prefix={`brief-${request.id}`}
              />
              <Button disabled={!online || busy}>{t("save")}</Button>
            </form>
          )}
        </>
      ) : (
        <p className="muted">{t("locked")}</p>
      )}
      <h4>{t("files")}</h4>
      <p className="muted">{t("fileHint")}</p>
      <ul>
        {view.documents.map((item) => (
          <li key={item.version_id}>
            <span>
              {item.name} · {t(item.category)}
            </span>
            <div className="form-actions">
              <Button
                variant="secondary"
                disabled={!online || download.isPending}
                onClick={() => download.mutate(item)}
              >
                {t("download")}
              </Button>
              {editable && (
                <Button
                  variant="ghost"
                  disabled={!online || busy}
                  onClick={() => {
                    const next = {
                      ...draft,
                      documents: draft.documents.filter(
                        (d) => d.version_id !== item.version_id,
                      ),
                    };
                    setDraft(next);
                    save.mutate(next);
                  }}
                >
                  {t("remove")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            upload.mutate();
          }}
        >
          <Field id={`file-${request.id}`} label={t("file")}>
            <input
              id={`file-${request.id}`}
              type="file"
              accept={acceptedFiles}
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field id={`category-${request.id}`} label={t("category")}>
            <select
              id={`category-${request.id}`}
              value={category}
              disabled={busy}
              onChange={(e) =>
                setCategory(e.target.value as "material" | "report")
              }
            >
              <option value="material">{t("material")}</option>
              <option value="report">{t("report")}</option>
            </select>
          </Field>
          <Button
            disabled={!online || busy || !file || draft.documents.length >= 20}
          >
            {t("upload")}
          </Button>
        </form>
      )}
      {saved && <Notice kind="success">{t("saved")}</Notice>}
      {failure && (
        <Notice kind="error">
          {failure instanceof Error && failure.message === "invalid_brief"
            ? t("invalid")
            : t("failed")}
        </Notice>
      )}
      <Button variant="ghost" disabled={busy} onClick={onReload}>
        {t("reload")}
      </Button>
      <p className="muted">{t("repeatHint")}</p>
      <History request={request.id} actor={actor} zone={request.time_zone} />
    </div>
  );
}
/** Loads details on demand so a large request list does not issue one RPC per card. */
export function RequestBriefPanel({
  actor,
  request,
}: {
  actor: string;
  request: ClientRequest;
}) {
  const { t } = useTranslation("requestBrief");
  const [open, setOpen] = useState(false),
    [refresh, setRefresh] = useState(0);
  const client = useQueryClient();
  const query = useQuery({
    ...requestBriefQuery(actor, request.id),
    enabled: open,
  });
  const saved = async () => {
    await Promise.all([
      client.invalidateQueries({
        queryKey: requestBriefKey(actor, request.id),
      }),
      client.invalidateQueries({
        queryKey: ["client-request-history", actor, request.id],
      }),
    ]);
  };
  return (
    <section>
      <Button
        variant="secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t("title")}
      </Button>
      {open &&
        (query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : (
          <BriefEditor
            key={`${actor}-${request.id}-${query.data.version}-${refresh}`}
            actor={actor}
            request={request}
            view={query.data}
            onSaved={saved}
            onReload={() => {
              void query.refetch().then(() => setRefresh((n) => n + 1));
            }}
          />
        ))}
    </section>
  );
}
