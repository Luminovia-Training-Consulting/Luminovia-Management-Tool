import { lazy, Suspense, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/common";
import type { ExplorerRequest } from "./request-boundary";

const SwaggerView = lazy(() =>
  import("./swagger-view").then(({ SwaggerView }) => ({
    default: SwaggerView,
  })),
);

export type ApiDocument = {
  paths: Record<string, unknown>;
  components?: Record<string, unknown>;
  webhooks?: Record<string, unknown>;
};

const pageSize = 24;
const methods = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

/** Count and filter individual HTTP operations, including multiple methods on one path. */
function indexOperations(
  entriesByPath: Record<string, unknown>,
  section: "paths" | "webhooks",
) {
  return Object.entries(entriesByPath).flatMap(([path, value]) => {
    if (!value || typeof value !== "object") return [];
    const entries = Object.entries(value);
    const metadata = Object.fromEntries(
      entries.filter(([key]) => !methods.has(key)),
    );
    return entries.flatMap(([method, operation]) => {
      if (!methods.has(method) || !operation || typeof operation !== "object")
        return [];
      const { operationId, summary, tags } = operation;
      const text = [
        path,
        method,
        operationId,
        summary,
        ...(Array.isArray(tags) ? tags : []),
      ]
        .filter((part): part is string => typeof part === "string")
        .join(" ")
        .toLowerCase();
      return [{ section, path, method, operation, metadata, text }];
    });
  });
}

export function ApiCatalogue({
  document,
  supportedSubmitMethods,
  requestInterceptor,
}: {
  document: ApiDocument;
  supportedSubmitMethods: readonly string[];
  requestInterceptor: (request: ExplorerRequest) => Promise<ExplorerRequest>;
}) {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const searchId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const operations = useMemo(
    () => [
      ...indexOperations(document.paths, "paths"),
      ...indexOperations(document.webhooks ?? {}, "webhooks"),
    ],
    [document],
  );
  const filtered = useMemo(() => {
    if (!filter) return operations;
    const terms = filter.toLowerCase().split(/\s+/);
    return operations.filter(({ method, text }) =>
      terms.every((term) =>
        methods.has(term) ? term === method : text.includes(term),
      ),
    );
  }, [operations, filter]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * pageSize;
  const spec = useMemo(() => {
    const sections = {
      paths: new Map<string, Record<string, unknown>>(),
      webhooks: new Map<string, Record<string, unknown>>(),
    };
    for (const { section, path, method, operation, metadata } of filtered.slice(
      start,
      start + pageSize,
    )) {
      const items = sections[section];
      const item = items.get(path) ?? { ...metadata };
      item[method] = operation;
      items.set(path, item);
    }
    return {
      ...document,
      paths: Object.fromEntries(sections.paths),
      webhooks: sections.webhooks.size
        ? Object.fromEntries(sections.webhooks)
        : undefined,
    };
  }, [document, filtered, start]);

  return (
    <section
      className="api-explorer"
      aria-label={de ? "API-Katalog" : "API catalogue"}
    >
      <form
        className="api-explorer-search"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter(search.trim());
          setPage(0);
        }}
      >
        <Field
          id={searchId}
          label={de ? "Schnittstellen suchen" : "Search operations"}
        >
          <input
            ref={searchInput}
            type="search"
            value={search}
            maxLength={200}
            placeholder={
              de
                ? "Methode, Pfad, Name oder Kategorie"
                : "Method, path, name or tag"
            }
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit" variant="secondary">
          {de ? "Suchen" : "Search"}
        </Button>
        {filter && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFilter("");
              setSearch("");
              setPage(0);
              searchInput.current?.focus();
            }}
          >
            {de ? "Suche zurücksetzen" : "Clear search"}
          </Button>
        )}
      </form>
      {filtered.length > 0 ? (
        <>
          <div className="api-catalogue-pagination">
            <p role="status">
              {de
                ? `Operationen ${start + 1}–${Math.min(start + pageSize, filtered.length)} von ${filtered.length}`
                : `Operations ${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`}
            </p>
            {lastPage > 0 && (
              <div className="api-doc-actions">
                <Button
                  variant="secondary"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  {de ? "Vorherige Seite" : "Previous page"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={currentPage === lastPage}
                  onClick={() => setPage(currentPage + 1)}
                >
                  {de ? "Nächste Seite" : "Next page"}
                </Button>
              </div>
            )}
          </div>
          <Suspense
            fallback={
              <p role="status">
                {de ? "Swagger UI wird geladen …" : "Loading Swagger UI …"}
              </p>
            }
          >
            <SwaggerView
              spec={spec}
              supportedSubmitMethods={supportedSubmitMethods}
              requestInterceptor={requestInterceptor}
            />
          </Suspense>
        </>
      ) : (
        <p role="status">
          {de
            ? "Keine passende Schnittstelle gefunden."
            : "No matching operations found."}
        </p>
      )}
    </section>
  );
}
