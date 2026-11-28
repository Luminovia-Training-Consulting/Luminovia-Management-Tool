import { isDatabasePermissionDenied } from "../../lib/database-errors";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  NextPageError,
  Notice,
} from "../../components/common";
import { canRetryNextPage } from "../../lib/paged-read";
import { useOnline } from "../../lib/online";
import {
  discoveredDocuments,
  documentDiscoveryQuery,
  type DocumentFilters,
  saveDocumentOrganisation,
} from "./discovery-api";
import type { PortalDocument } from "./api";
import "./i18n";

export function DocumentExplorer({
  actor,
  archiveAction,
  children,
}: {
  actor: string;
  archiveAction: ReactNode;
  children: (
    files: PortalDocument[],
    pending: boolean,
    epoch?: string,
    renewalEpoch?: string,
    emptyMessage?: string,
  ) => ReactNode;
}) {
  const { t } = useTranslation("files"),
    id = useId(),
    online = useOnline(),
    client = useQueryClient();
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
  const searchInput = useRef<HTMLInputElement>(null);
  const hasDraft = Boolean(search || tag || folder || unfiled);
  const isFiltered = Boolean(
    filters.search.trim() || filters.tag || filters.folder !== null,
  );
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
  const options = documentDiscoveryQuery(actor, filters);
  const query = useInfiniteQuery({
    ...options,
    enabled: online,
  });
  const pages = query.data?.pages;
  const rows = useMemo(() => discoveredDocuments(pages), [pages]);
  const retryNext = canRetryNextPage(query);
  // Query-state counters advance even if structurally shared data or the clock
  // stays equal. A pending key is not a successful authorisation epoch.
  const state = client.getQueryState(options.queryKey);
  const epoch = query.isSuccess
    ? `${JSON.stringify(options.queryKey)}:${state?.dataUpdateCount}`
    : undefined;
  // A cached key transition or appended page has not revalidated the cached
  // prefix. Only a full response since this observer mounted may renew a row.
  const renewalEpoch =
    query.isFetchedAfterMount &&
    !query.isFetching &&
    !state?.fetchMeta?.fetchMore
      ? epoch
      : undefined;
  return (
    <>
      <section className="file-discovery-toolbar" aria-label={t("search")}>
        <div className="file-discovery-primary">
          <div className="file-discovery-search">
            <Search size={18} aria-hidden="true" />
            <input
              ref={searchInput}
              aria-label={t("search")}
              placeholder={t("search")}
              type="search"
              maxLength={160}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="file-discovery-actions">
            {archiveAction}
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label={t("refreshFiles")}
              title={t("refreshFiles")}
              disabled={!online || query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="file-discovery-filters">
          <Field id={`${id}-tag`} label={t("tagFilter")}>
            <input
              maxLength={60}
              aria-describedby={`${id}-exact-filter`}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          </Field>
          <Field id={`${id}-folder`} label={t("folderFilter")}>
            <input
              maxLength={80}
              aria-describedby={`${id}-exact-filter`}
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
          <div className="file-discovery-filter-help">
            <small id={`${id}-exact-filter`}>{t("exactFilter")}</small>
            {hasDraft && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setTag("");
                  setFolder("");
                  setUnfiled(false);
                  setFilters({ search: "", tag: "", folder: null });
                  searchInput.current?.focus();
                }}
              >
                {t("clearFilters")}
              </Button>
            )}
          </div>
        </div>
      </section>
      {!online && <Notice kind="error">{t("discoveryOffline")}</Notice>}
      {query.isError && !retryNext ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <>
          {/* Keep captured dialogs mounted while this filter loads, without
              retaining rows from a different query key. Errors above still
              unmount the entire child and discard protected metadata. */}
          {children(
            rows,
            query.isPending,
            epoch,
            renewalEpoch,
            isFiltered ? t("noMatches") : undefined,
          )}
          {query.isPending ? (
            <Loading />
          ) : (
            <div className="file-discovery-pages">
              <span role="status">
                {t("loadedFiles", { count: rows.length })}
              </span>
              {retryNext ? (
                <NextPageError
                  retry={() =>
                    void query.fetchNextPage({ cancelRefetch: false })
                  }
                  disabled={!online || query.isFetching}
                />
              ) : (
                query.hasNextPage && (
                  <Button
                    disabled={!online || query.isFetching}
                    onClick={() =>
                      void query.fetchNextPage({ cancelRefetch: false })
                    }
                  >
                    {t(
                      query.isFetchingNextPage
                        ? "loadingFiles"
                        : "loadMoreFiles",
                    )}
                  </Button>
                )
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
  authorised,
  accessStatus,
  onDenied,
}: {
  file: PortalDocument;
  onClose: () => void;
  authorised: boolean;
  accessStatus: ReactNode;
  onDenied: () => void;
}) {
  const { t } = useTranslation("files"),
    client = useQueryClient(),
    online = useOnline(),
    id = useId();
  const [tags, setTags] = useState((file.personal_tags ?? []).join("\n")),
    [folder, setFolder] = useState(file.personal_folder ?? "");
  const save = useMutation({
    mutationFn: () => {
      if (!authorised) throw new Error("file_access_pending");
      return saveDocumentOrganisation(
        file,
        tags
          .split("\n")
          .map((tag) => tag.trim())
          .filter(Boolean),
        folder,
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    },
    onError: (error) => {
      if (isDatabasePermissionDenied(error)) onDenied();
    },
  });
  const stale =
    save.error &&
    typeof save.error === "object" &&
    "code" in save.error &&
    (save.error.code === "PT409" || save.error.code === "40001");
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
      {accessStatus}
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
        <Button disabled={!online || !authorised || save.isPending}>
          {t("saveOrganisation")}
        </Button>
      </form>
    </Dialog>
  );
}
