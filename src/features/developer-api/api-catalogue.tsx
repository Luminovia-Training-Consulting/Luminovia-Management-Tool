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
const httpMethods = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;
type HttpMethod = (typeof httpMethods)[number];
const methods: ReadonlySet<string> = new Set(httpMethods);

function isHttpMethod(value: string): value is HttpMethod {
  return methods.has(value);
}

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
      if (!isHttpMethod(method) || !operation || typeof operation !== "object")
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
      const rpcPost = method === "post" && path.startsWith("/rest/v1/rpc/");
      return [{ section, path, method, operation, metadata, text, rpcPost }];
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
  const [method, setMethod] = useState<HttpMethod | "all">("all");
  const [page, setPage] = useState(0);
  const operations = useMemo(
    () =>
      [
        ...indexOperations(document.paths, "paths"),
        ...indexOperations(document.webhooks ?? {}, "webhooks"),
      ].sort((left, right) => Number(left.rpcPost) - Number(right.rpcPost)),
    [document],
  );
  const availableMethods = useMemo(
    () => new Set(operations.map(({ method }) => method)),
    [operations],
  );
  const matches = useMemo(() => {
    if (!filter) return operations;
    const terms = filter.split(/\s+/);
    return operations.filter(({ text }) =>
      terms.every((term) => text.includes(term)),
    );
  }, [operations, filter]);
  const counts = useMemo(() => {
    const totals = new Map<HttpMethod, number>();
    for (const { method } of matches)
      totals.set(method, (totals.get(method) ?? 0) + 1);
    return totals;
  }, [matches]);
  const filtered = useMemo(
    () =>
      method === "all"
        ? matches
        : matches.filter((item) => item.method === method),
    [matches, method],
  );
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
      <div
        className="api-method-filter"
        role="group"
        aria-label={de ? "HTTP-Methoden" : "HTTP methods"}
      >
        {(
          [
            "all",
            ...httpMethods.filter((value) => availableMethods.has(value)),
          ] as const
        ).map((value) => (
          <Button
            key={value}
            type="button"
            variant={method === value ? "default" : "secondary"}
            aria-pressed={method === value}
            onClick={() => {
              setMethod(value);
              setPage(0);
            }}
          >
            {value === "all" ? (de ? "Alle" : "All") : value.toUpperCase()}{" "}
            <span>
              {(value === "all"
                ? matches.length
                : (counts.get(value) ?? 0)
              ).toLocaleString(i18n.language)}
            </span>
          </Button>
        ))}
      </div>
      <form
        className="api-explorer-search"
        onSubmit={(event) => {
          event.preventDefault();
          const terms = search.trim().split(/\s+/);
          const verb = terms
            .map((term) => term.toLowerCase())
            .find(isHttpMethod);
          const query = terms
            .filter((term) => !isHttpMethod(term.toLowerCase()))
            .join(" ");
          if (verb) setMethod(verb);
          setSearch(query);
          setFilter(query.toLowerCase());
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
