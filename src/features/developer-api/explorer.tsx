import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SwaggerView } from "./swagger-view";
import "./explorer.css";
import { Button } from "../../components/ui/button";
import { Field, PageHeading } from "../../components/common";
import type { InstallationBrand } from "../../lib/installation-brand";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import {
  authorizeDocumentedRequest,
  type ExplorerRequest,
} from "./request-boundary";

type ExplorerProperties = {
  brand: InstallationBrand;
  createDocument: (
    backend: string,
    brand: InstallationBrand,
  ) => { paths: Record<string, unknown> };
  checkRequest: (
    request: ExplorerRequest,
    backend: string,
    brand: InstallationBrand,
  ) => boolean;
};

const disabledMethods = [] as const;
const academyMethods = ["get", "post"] as const;
const portalMethods = ["get", "post", "patch", "put", "delete"] as const;

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

/** Match each operation independently so a method search keeps the intended requests. */
function matchingPaths(paths: Record<string, unknown>, terms: string[]) {
  if (!terms.length) return paths;
  return Object.fromEntries(
    Object.entries(paths).flatMap(([path, value]) => {
      if (!value || typeof value !== "object") return [];
      const pathItem = Object.entries(value);
      const matches = pathItem.filter(([method, operation]) => {
        if (!methods.has(method) || !operation || typeof operation !== "object")
          return false;
        const { operationId, summary, tags } = operation;
        const searchable = [
          path,
          method,
          operationId,
          summary,
          ...(Array.isArray(tags) ? tags : []),
        ]
          .filter((part): part is string => typeof part === "string")
          .join(" ")
          .toLowerCase();
        return terms.every((term) =>
          methods.has(term) ? term === method : searchable.includes(term),
        );
      });
      if (!matches.length) return [];
      return [
        [
          path,
          Object.fromEntries([
            ...pathItem.filter(([key]) => !methods.has(key)),
            ...matches,
          ]),
        ],
      ];
    }),
  );
}

/** The composition root supplies only the current edition's catalogue and request guard. */
export function Explorer(props: ExplorerProperties) {
  const { session } = useAuth();
  const actor = session?.user.id;
  return (
    <ExplorerSession {...props} actor={actor} key={actor ?? "signed-out"} />
  );
}

function ExplorerSession({
  brand,
  createDocument,
  checkRequest,
  actor,
}: ExplorerProperties & { actor?: string }) {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const academy = brand.edition !== "internal";
  const searchId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [approval, setApproval] = useState<number | null>(null);
  const permit = useRef(0);
  const authorized = approval !== null;
  useEffect(
    () => () => {
      permit.current += 1;
    },
    [],
  );
  function toggleRequests() {
    permit.current += 1;
    setApproval(actor && !authorized ? permit.current : null);
  }
  const backend = useMemo(
    () =>
      new URL(
        import.meta.env.VITE_SUPABASE_URL,
        window.location.origin,
      ).href.replace(/\/+$/, ""),
    [],
  );
  const document = useMemo(
    () => createDocument(backend, brand),
    [backend, brand, createDocument],
  );
  const spec = useMemo(
    () => ({
      ...document,
      paths: matchingPaths(
        document.paths,
        filter ? filter.toLowerCase().split(/\s+/) : [],
      ),
      security: [],
      components: {},
    }),
    [document, filter],
  );
  const hasResults = Object.keys(spec.paths).length > 0;

  return (
    <>
      <PageHeading
        title={de ? "API-Dokumentation" : "API documentation"}
        description={
          academy
            ? de
              ? "Führe dokumentierte LMS-Datenbankanfragen mit deinem Konto aus. Der JSON-Download enthält zusätzlich die Datei- und Kontoschnittstellen."
              : "Run documented LMS database requests with your account. The JSON download also includes file and account operations."
            : de
              ? "Durchsuche die dokumentierten Schnittstellen und führe Anfragen mit deinem aktuellen Konto aus."
              : "Search the documented operations and send requests with your current account."
        }
      />
      <div className="button-row">
        <Button
          type="button"
          aria-pressed={authorized}
          disabled={!actor}
          onClick={toggleRequests}
        >
          {authorized
            ? de
              ? "Anfragen deaktivieren"
              : "Disable requests"
            : de
              ? "Mit meinem Konto autorisieren"
              : "Authorize with my account"}
        </Button>
        <Button asChild variant="secondary">
          <a href="/api/swagger">Swagger UI</a>
        </Button>
        <Button asChild variant="secondary">
          <a href="/api/openapi.json" download>
            OpenAPI JSON
          </a>
        </Button>
      </div>
      <p role="status">
        {authorized
          ? de
            ? "Anfragen verwenden deine aktuellen Rechte und können echte Daten ändern."
            : "Requests use your current permissions and can change real data."
          : de
            ? "Anfragen sind deaktiviert."
            : "Requests are disabled."}
      </p>
      <section
        className="panel api-explorer"
        aria-label={de ? "API-Katalog" : "API catalogue"}
      >
        <form
          className="api-explorer-search"
          onSubmit={(event) => {
            event.preventDefault();
            setFilter(search.trim());
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
                searchInput.current?.focus();
              }}
            >
              {de ? "Suche zurücksetzen" : "Clear search"}
            </Button>
          )}
        </form>
        {!hasResults && (
          <p role="status">
            {de
              ? "Keine passende Schnittstelle gefunden."
              : "No matching operations found."}
          </p>
        )}
        {/* Remount when disabling requests so responses do not linger in the viewer. */}
        {hasResults && (
          <SwaggerView
            key={String(authorized)}
            spec={spec}
            supportedSubmitMethods={
              authorized
                ? academy
                  ? academyMethods
                  : portalMethods
                : disabledMethods
            }
            requestInterceptor={async (request) => {
              if (!approval || !actor || permit.current !== approval)
                throw new Error("api_session_required");
              const permitted = await authorizeDocumentedRequest(
                request,
                import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                actor,
                async () => (await db().auth.getSession()).data.session,
                checkRequest(request, backend, brand),
                academy
                  ? URL.parse(request.url, backend + "/")?.href
                  : undefined,
              );
              if (permit.current !== approval)
                throw new Error("api_session_required");
              return permitted;
            }}
          />
        )}
      </section>
    </>
  );
}
