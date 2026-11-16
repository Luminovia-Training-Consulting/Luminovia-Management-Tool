import { useEffect, useId, useState, type ReactNode } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import {
  discoveredDocuments,
  documentDiscoveryQuery,
  saveDocumentOrganisation,
  type DocumentFilters,
} from "./discovery-api";
import type { PortalDocument } from "./api";
import "./i18n";
export function DocumentExplorer({
  actor,
  children,
}: {
  actor: string;
  children: (files: PortalDocument[], pending: boolean) => ReactNode;
}) {
  const { t } = useTranslation("files"),
    id = useId(),
    online = useOnline();
  const [search, setSearch] = useState(
      () => new URLSearchParams(window.location.search).get("q") ?? "",
    ),
    [tag, setTag] = useState(""),
    [folder, setFolder] = useState(""),
    [unfiled, setUnfiled] = useState(false);
  const [filters, setFilters] = useState<DocumentFilters>(() => ({
    search,
    tag: "",
    folder: null,
  }));
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setFilters({
          search,
          tag: tag.trim(),
          folder: unfiled ? "" : folder.trim() || null,
        }),
      250,
    );
    return () => clearTimeout(timer);
  }, [search, tag, folder, unfiled]);
  const query = useInfiniteQuery({
      ...documentDiscoveryQuery(actor, filters),
      enabled: online,
    }),
    rows = discoveredDocuments(query.data?.pages);
  return (
    <>
      <p className="muted">{t("discoveryHelp")}</p>
      <div className="file-discovery-filters">
        <Field id={`${id}-search`} label={t("search")}>
          <input
            type="search"
            maxLength={160}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Field id={`${id}-tag`} label={t("tagFilter")} hint={t("exactFilter")}>
          <input
            maxLength={60}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          />
        </Field>
        <Field
          id={`${id}-folder`}
          label={t("folderFilter")}
          hint={t("exactFilter")}
        >
          <input
            maxLength={80}
            disabled={unfiled}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
        </Field>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={unfiled}
            onChange={(e) => setUnfiled(e.target.checked)}
          />
          {t("unfiledOnly")}
        </label>
        <Button
          variant="secondary"
          disabled={!online || query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("refreshFiles")}
        </Button>
      </div>
      {!online && <Notice kind="error">{t("discoveryOffline")}</Notice>}
      {query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <>
          {/* Keep captured dialogs mounted while this filter loads, without
              retaining rows from a different query key. Errors above still
              unmount the entire child and discard protected metadata. */}
          {children(query.isPending ? [] : rows, query.isPending)}
          {query.isPending ? (
            <Loading />
          ) : (
            <div className="file-discovery-pages">
              <span role="status">
                {t("loadedFiles", { count: rows.length })}
              </span>
              {query.hasNextPage && (
                <Button
                  disabled={!online || query.isFetching}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t(
                    query.isFetchingNextPage ? "loadingFiles" : "loadMoreFiles",
                  )}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
export function DocumentOrganiser({
  file,
  onClose,
}: {
  file: PortalDocument;
  onClose: () => void;
}) {
  const { t } = useTranslation("files"),
    client = useQueryClient(),
    online = useOnline(),
    id = useId();
  const [tags, setTags] = useState((file.personal_tags ?? []).join("\n")),
    [folder, setFolder] = useState(file.personal_folder ?? "");
  const save = useMutation({
    mutationFn: () =>
      saveDocumentOrganisation(
        file,
        tags
          .split("\n")
          .map((tag) => tag.trim())
          .filter(Boolean),
        folder,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    },
  });
  const stale =
    save.error &&
    typeof save.error === "object" &&
    "code" in save.error &&
    save.error.code === "40001";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      title={t("organise")}
      description={file.original_name}
    >
      <p>{t("organisationPrivate")}</p>
      <form
        className="file-organisation-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field id={`${id}-tags`} label={t("ownTags")} hint={t("tagsHint")}>
          <textarea
            value={tags}
            maxLength={1240}
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
        <Field
          id={`${id}-folder`}
          label={t("ownFolder")}
          hint={t("folderHint")}
        >
          <input
            value={folder}
            maxLength={80}
            onChange={(e) => setFolder(e.target.value)}
          />
        </Field>
        {save.isError && (
          <Notice kind="error">
            {t(stale ? "organisationStale" : "organisationError")}
          </Notice>
        )}
        {stale && (
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await client.invalidateQueries({ queryKey: ["documents"] });
              onClose();
            }}
          >
            {t("organisationReload")}
          </Button>
        )}
        <Button disabled={!online || save.isPending}>
          {t("saveOrganisation")}
        </Button>
      </form>
    </Dialog>
  );
}
