import { isDatabasePermissionDenied } from "../../lib/database-errors";
import { useRequestKey } from "../../lib/request-key";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery } from "../../lib/queries";
import { useOnline } from "../../lib/online";
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
  type AdminAnnouncement,
  adminAnnouncementQuery,
  adminAnnouncementsQuery,
  type AnnouncementForm,
  announcementFormSchema,
  announcementKeys,
  announcementPayload,
  type AnnouncementSummary,
  audienceRoles,
  manageAnnouncement,
} from "./api";
import { AnnouncementPagination } from "./announcement-pagination";
import { useAnnouncementPagination } from "./pagination-state";
import "./i18n";
import "./announcements.css";

const isConflict = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "40001",
  );
function Editor({
  record,
  onDone,
  onRevoked,
}: {
  record: AdminAnnouncement | null;
  onDone: () => void;
  onRevoked: () => void;
}) {
  const { t, i18n } = useTranslation("announcements"),
    online = useOnline();
  // A background detail refresh must not advance the version of an unsaved form.
  const [base] = useState(record),
    [invalid, setInvalid] = useState(false),
    retry = useRequestKey();
  const source = base?.draft,
    zone = source?.time_zone ?? "Europe/Berlin";
  const form = useForm<AnnouncementForm>({
    resolver: zodResolver(announcementFormSchema),
    defaultValues: source
      ? {
          ...source,
          starts_at: DateTime.fromISO(source.starts_at)
            .setZone(zone)
            .toFormat("yyyy-MM-dd'T'HH:mm"),
          ends_at: DateTime.fromISO(source.ends_at)
            .setZone(zone)
            .toFormat("yyyy-MM-dd'T'HH:mm"),
        }
      : {
          title_de: "",
          title_en: "",
          body_de: "",
          body_en: "",
          important: false,
          audience_roles: [],
          time_zone: zone,
          starts_at: DateTime.now()
            .setZone(zone)
            .minus({ minutes: 1 })
            .toFormat("yyyy-MM-dd'T'HH:mm"),
          ends_at: DateTime.now()
            .setZone(zone)
            .plus({ days: 7 })
            .toFormat("yyyy-MM-dd'T'HH:mm"),
        },
  });
  const save = useMutation({
    mutationFn: async (values: AnnouncementForm) => {
      setInvalid(false);
      let payload: ReturnType<typeof announcementPayload>;
      try {
        payload = announcementPayload(values, source);
      } catch {
        setInvalid(true);
        throw new Error("invalid-window");
      }
      const signature = JSON.stringify([
        base?.id ?? null,
        base?.version ?? 0,
        payload,
      ]);
      const retryId = retry.forInput(signature);
      return manageAnnouncement({
        id: base?.id ?? null,
        action: "save",
        version: base?.version ?? 0,
        requestId: retryId,
        payload,
      });
    },
    onSuccess: onDone,
    onError: (error) => {
      if (isDatabasePermissionDenied(error)) onRevoked();
    },
  });
  const fields = [
    ["title_de", "titleDe"],
    ["title_en", "titleEn"],
    ["body_de", "bodyDe"],
    ["body_en", "bodyEn"],
  ] as const;
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
    >
      <Notice>{t("draftPrivacy")}</Notice>
      <div className="announcement-editor-grid">
        {fields.map(([name, label]) => (
          <Field
            key={name}
            id={`announcement-${name}`}
            label={t(label)}
            error={Boolean(form.formState.errors[name])}
          >
            {name.startsWith("body") ? (
              <textarea
                id={`announcement-${name}`}
                rows={6}
                maxLength={8000}
                disabled={save.isPending}
                {...form.register(name)}
              />
            ) : (
              <input
                id={`announcement-${name}`}
                maxLength={200}
                disabled={save.isPending}
                {...form.register(name)}
              />
            )}
          </Field>
        ))}
        <Field id="announcement-start" label={t("start")}>
          <input
            id="announcement-start"
            type="datetime-local"
            disabled={save.isPending}
            {...form.register("starts_at")}
          />
        </Field>
        <Field id="announcement-end" label={t("end")}>
          <input
            id="announcement-end"
            type="datetime-local"
            disabled={save.isPending}
            {...form.register("ends_at")}
          />
        </Field>
        <Field id="announcement-zone" label={t("zone")}>
          <input
            id="announcement-zone"
            disabled={save.isPending}
            {...form.register("time_zone")}
          />
        </Field>
      </div>
      <fieldset className="announcement-roles" disabled={save.isPending}>
        <legend>{t("audience")}</legend>
        <p>{t("allRoles")}</p>
        {audienceRoles.map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              value={role}
              {...form.register("audience_roles")}
            />
            {t(role)}
          </label>
        ))}
      </fieldset>
      <label className="checkbox-label">
        <input
          type="checkbox"
          disabled={save.isPending}
          {...form.register("important")}
        />
        {t("important")}
      </label>
      <p>{t("importantHint")}</p>
      <p>{t("manual")}</p>
      {base?.published && (
        <details>
          <summary>{t("currentPublished")}</summary>
          <h3>
            {i18n.language === "de"
              ? base.published.title_de
              : base.published.title_en}
          </h3>
          <p className="announcement-body">
            {i18n.language === "de"
              ? base.published.body_de
              : base.published.body_en}
          </p>
        </details>
      )}
      {invalid && <Notice kind="error">{t("windowError")}</Notice>}
      {save.isError && !invalid && (
        <Notice kind="error">
          {t(isConflict(save.error) ? "conflict" : "operationError")}
        </Notice>
      )}
      <Button disabled={!online || save.isPending}>{t("save")}</Button>
    </form>
  );
}

function EditExisting({
  actor,
  id,
  onDone,
  onRevoked,
}: {
  actor: string;
  id: string;
  onDone: () => void;
  onRevoked: () => void;
}) {
  const query = useQuery(adminAnnouncementQuery(actor, id));
  useEffect(() => {
    if (query.isError && isDatabasePermissionDenied(query.error)) onRevoked();
  }, [query.isError, query.error, onRevoked]);
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  return <Editor record={query.data} onDone={onDone} onRevoked={onRevoked} />;
}

function Administration({ actor }: { actor: string }) {
  const { t, i18n } = useTranslation("announcements"),
    online = useOnline(),
    client = useQueryClient();
  const [draft, setDraft] = useState({ search: "", state: "" }),
    [filter, setFilter] = useState(draft),
    [editing, setEditing] = useState<string | null | undefined>(undefined),
    [saved, setSaved] = useState(false),
    [revoked, setRevoked] = useState(false);
  const pagination = useAnnouncementPagination();
  const query = useQuery({
    ...adminAnnouncementsQuery(
      actor,
      filter.search,
      filter.state,
      pagination.cursor,
    ),
    enabled: online && !revoked,
  });
  const retry = useRequestKey();
  const revoke = () => {
    setRevoked(true);
    setEditing(undefined);
    void client.invalidateQueries({
      queryKey: permissionsQuery(actor).queryKey,
    });
  };
  const refresh = async () => {
    setSaved(true);
    pagination.reset();
    await Promise.all([
      client.invalidateQueries({ queryKey: announcementKeys.all(actor) }),
      client.invalidateQueries({ queryKey: ["notifications", actor] }),
    ]);
  };
  const operation = useMutation({
    mutationFn: ({
      row,
      action,
    }: {
      row: AnnouncementSummary;
      action: "publish" | "archive" | "recover";
    }) => {
      const signature = JSON.stringify([row.id, row.version, action]);
      const retryId = retry.forInput(signature);
      return manageAnnouncement({
        id: row.id,
        version: row.version,
        action,
        requestId: retryId,
      });
    },
    onSuccess: async () => {
      retry.clear();
      await refresh();
    },
    onError: (error) => {
      if (isDatabasePermissionDenied(error)) revoke();
    },
  });
  if (revoked) return <Notice kind="error">{t("forbidden")}</Notice>;
  return (
    <>
      <div className="announcement-actions">
        <Button
          disabled={!online}
          onClick={() => {
            setSaved(false);
            setEditing(null);
          }}
        >
          {t("new")}
        </Button>
      </div>
      <Notice>{t("manual")}</Notice>
      <p>{t("importantHint")}</p>
      <form
        className="panel announcement-filters"
        onSubmit={(event) => {
          event.preventDefault();
          pagination.reset();
          setFilter({ ...draft, search: draft.search.trim() });
        }}
      >
        <Field id="admin-announcement-search" label={t("search")}>
          <input
            id="admin-announcement-search"
            type="search"
            maxLength={160}
            value={draft.search}
            onChange={(event) =>
              setDraft({ ...draft, search: event.target.value })
            }
          />
        </Field>
        <Field id="admin-announcement-state" label={t("filter")}>
          <select
            id="admin-announcement-state"
            value={draft.state}
            onChange={(event) =>
              setDraft({ ...draft, state: event.target.value })
            }
          >
            <option value="">{t("allStates")}</option>
            {["draft", "published", "archived"].map((state) => (
              <option key={state} value={state}>
                {t(state)}
              </option>
            ))}
          </select>
        </Field>
        <Button disabled={!online}>{t("apply")}</Button>
      </form>
      {saved && <Notice>{t("saved")}</Notice>}
      {operation.isError && (
        <Notice kind="error">
          {t(
            isConflict(operation.error)
              ? "conflict"
              : operation.error.message.includes("no scheduler")
                ? "manual"
                : "operationError",
          )}
        </Notice>
      )}
      {!online ? (
        <Notice kind="error">{t("offline", { ns: "translation" })}</Notice>
      ) : query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <>
          {!query.data.items.length && <Notice>{t("empty")}</Notice>}
          <div className="announcement-stack">
            {query.data.items.map((row) => (
              <article key={row.id} className="panel announcement-card">
                <span className="badge">{t(row.state)}</span>
                {row.has_draft && row.state === "published" && (
                  <span className="badge">{t("hasDraft")}</span>
                )}
                <h2>{i18n.language === "de" ? row.title_de : row.title_en}</h2>
                <div className="announcement-actions">
                  <Button
                    variant="secondary"
                    disabled={
                      !online || operation.isPending || row.state === "archived"
                    }
                    onClick={() => {
                      setSaved(false);
                      setEditing(row.id);
                    }}
                  >
                    {t("edit")}
                  </Button>
                  {row.state !== "archived" && (
                    <Button
                      disabled={
                        !online || operation.isPending || !row.has_draft
                      }
                      onClick={() =>
                        operation.mutate({ row, action: "publish" })
                      }
                    >
                      {t("publish")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={!online || operation.isPending}
                    onClick={() =>
                      operation.mutate({
                        row,
                        action:
                          row.state === "archived" ? "recover" : "archive",
                      })
                    }
                  >
                    {t(row.state === "archived" ? "recover" : "archive")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <AnnouncementPagination
            label={t("manage")}
            pagination={pagination}
            nextCursor={query.data.next_cursor}
            busy={query.isFetching}
          />
        </>
      )}
      <Dialog
        open={editing !== undefined && online && !query.isError}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        title={t(editing === null ? "new" : "edit")}
        description={t("draftPrivacy")}
      >
        {editing === null ? (
          <Editor
            record={null}
            onRevoked={revoke}
            onDone={() => {
              setEditing(undefined);
              void refresh();
            }}
          />
        ) : (
          editing && (
            <EditExisting
              actor={actor}
              id={editing}
              onRevoked={revoke}
              onDone={() => {
                setEditing(undefined);
                void refresh();
              }}
            />
          )
        )}
      </Dialog>
    </>
  );
}

export function AdminAnnouncementsPage() {
  const { t } = useTranslation("announcements"),
    actor = useAuth().session!.user.id,
    permissions = useQuery(permissionsQuery(actor));
  return (
    <>
      <PageHeading title={t("manage")} description={t("adminIntro")} />
      {permissions.isPending ? (
        <Loading />
      ) : permissions.isError ? (
        <ErrorState retry={() => void permissions.refetch()} />
      ) : permissions.data?.includes("announcements.manage") ? (
        <Administration actor={actor} />
      ) : (
        <Notice kind="error">{t("forbidden")}</Notice>
      )}
    </>
  );
}
