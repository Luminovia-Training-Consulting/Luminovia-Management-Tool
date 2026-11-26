/** The internal Explorer loads its versioned documentation asset on demand. */
import { useEffect, useState } from "react";
import { ErrorState, Loading } from "../../components/common";
import { internalInstallationBrand } from "../../lib/installation-brand";
import type { ApiDocument } from "./api-catalogue";
import { internalExplorerPath } from "./catalogue-url";
import { Explorer } from "./explorer";
import { isInternalExplorerRequest } from "./request-boundary";

type InteractiveDocument = ApiDocument & { paths: Record<string, object> };

/** Validate the public static catalogue before it can be used to authorize a request. */
async function loadInteractiveDocument(
  signal: AbortSignal,
): Promise<InteractiveDocument> {
  const response = await fetch(internalExplorerPath, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal,
  });
  if (!response.ok)
    throw new Error("Interactive OpenAPI catalogue unavailable");
  const document = await response.json();
  if (
    typeof document?.openapi !== "string" ||
    !document.paths ||
    typeof document.paths !== "object" ||
    Array.isArray(document.paths) ||
    !Object.values(document.paths).every(
      (path) =>
        path !== null && typeof path === "object" && !Array.isArray(path),
    )
  )
    throw new Error("Invalid interactive OpenAPI catalogue");
  return document;
}

export function ApiExplorer() {
  const [document, setDocument] = useState<InteractiveDocument>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadInteractiveDocument(controller.signal).then(
      (loaded) => {
        if (!controller.signal.aborted) setDocument(loaded);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [attempt]);
  if (failed)
    return (
      <ErrorState
        retry={() => {
          setFailed(false);
          setAttempt((retry) => retry + 1);
        }}
      />
    );
  if (!document) return <Loading />;
  return (
    <Explorer
      brand={internalInstallationBrand}
      createDocument={(backend) => ({
        ...document,
        servers: [{ url: backend }],
      })}
      checkRequest={(request, backend) =>
        isInternalExplorerRequest(request, backend, document.paths)
      }
    />
  );
}
