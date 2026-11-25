/** Unified discovery renders only server-authorised pages for the current actor. */
import { mergeCursorItems } from "../../lib/cursor-rows";
import { useMemo, useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useOutletContext,
} from "react-router-dom";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  NextPageError,
  Notice,
  PageHeading,
} from "../../components/common";
import { useOnline } from "../../lib/online";
import { canRetryNextPage } from "../../lib/paged-read";
import { unifiedSearchQuery } from "./unified-api";
import { searchKinds } from "./unified-schema";
import "./unified-i18n";
import "./unified.css";

type SearchCriteria = { q: string; kind: string };
export type SearchSession = [
  SearchCriteria,
  (criteria: SearchCriteria) => void,
];

/** A new submitted search remounts the draft; a language change preserves unsaved text. */
function SearchForm({
  query,
  kind,
  onSearch,
}: {
  query: string;
  kind: string;
  onSearch: (query: string, kind: string) => void;
}) {
  const { t } = useTranslation("unifiedSearch");
  const [input, setInput] = useState(query);
  const [type, setType] = useState(kind);
  return (
    <form
      className="panel search-page-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(input.trim(), type);
      }}
    >
      <Field id="portal-query" label={t("query")}>
        <input
          id="portal-query"
          type="search"
          autoComplete="off"
          value={input}
          maxLength={100}
          onChange={(event) => setInput(event.target.value)}
        />
      </Field>
      <Field id="portal-search-kind" label={t("kind")}>
        <select
          id="portal-search-kind"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="">{t("all")}</option>
          {searchKinds.map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </select>
      </Field>
      <Button>{t("search")}</Button>
    </form>
  );
}

/** Replace old search URLs without rehydrating potentially private query strings. */
export function PortalSearch() {
  const { search } = useLocation();
  return search ? <Navigate to="/search" replace /> : <SearchResults />;
}

/** Keep the server's cursor intact and hide cached results on a failed recheck. */
function SearchResults() {
  const { t } = useTranslation("unifiedSearch");
  const { session } = useAuth();
  const online = useOnline();
  const client = useQueryClient();
  const [{ q, kind }, setCriteria] = useOutletContext<SearchSession>();
  const searchOptions = unifiedSearchQuery(session!.user.id, q, kind);
  const query = useInfiniteQuery({
    ...searchOptions,
    enabled: online && q.length >= 2,
  });
  const retryNext = canRetryNextPage(query);
  const pages = query.data?.pages;
  const rows = useMemo(
    () => mergeCursorItems(pages, { key: (row) => `${row.kind}:${row.id}` }),
    [pages],
  );
  return (
    <>
      <PageHeading title={t("title")} description={t("hint")} />
      <SearchForm
        key={`${q}\0${kind}`}
        query={q}
        kind={kind}
        onSearch={(text, value) => {
          if (text === q && value === kind) {
            // Fresh results start at the first cursor; don't replay every loaded page.
            if (online && q.length >= 2 && !query.isFetching)
              void client.resetQueries({
                queryKey: searchOptions.queryKey,
                exact: true,
              });
          } else {
            setCriteria({ q: text, kind: value });
          }
        }}
      />
      {q.length >= 2 &&
        (!online ? (
          <Notice>{t("offline")}</Notice>
        ) : query.isPending ? (
          <Loading />
        ) : query.isError && !retryNext ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : rows.length ? (
          <>
            <ul className="portal-search-results">
              {rows.map((row) => (
                <li key={`${row.kind}:${row.id}`}>
                  <Link
                    to={
                      row.kind === "chats" && row.url.startsWith("/chats?room=")
                        ? `${row.url}&message=${encodeURIComponent(row.id)}`
                        : row.url
                    }
                  >
                    <span className="badge">{t(row.kind)}</span>
                    <strong>{row.title}</strong>
                    {row.detail && <small>{row.detail}</small>}
                  </Link>
                </li>
              ))}
            </ul>
            {retryNext ? (
              <NextPageError
                retry={() => void query.fetchNextPage({ cancelRefetch: false })}
                disabled={query.isFetching}
              />
            ) : (
              query.hasNextPage && (
                <Button
                  variant="secondary"
                  disabled={query.isFetching}
                  onClick={() =>
                    void query.fetchNextPage({ cancelRefetch: false })
                  }
                >
                  {t("more")}
                </Button>
              )
            )}
          </>
        ) : (
          <div className="empty-state">{t("empty")}</div>
        ))}
    </>
  );
}
