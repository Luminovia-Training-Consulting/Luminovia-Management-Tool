/** Edition entry point, shared PWA notices and render fallback. */
import {
  Component,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import EditionRoutes from "@edition-routes";
import { Loading } from "../components/common";
import { PwaInstallOffer } from "../components/pwa-install";
import { Button } from "../components/ui/button";
import { useOnline } from "../lib/online";
import { watchPwaUpdates } from "./pwa-update-check";

/** Expose offline/update state and activate a new service worker only through the visible user action. */
function AppNotices() {
  const { t } = useTranslation();
  const online = useOnline();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const {
    needRefresh: [refresh, setRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_, registered) => setRegistration(registered),
  });
  useEffect(() => {
    if (registration)
      return watchPwaUpdates(registration, () => setRefresh(true));
  }, [registration, setRefresh]);
  return (
    <>
      <PwaInstallOffer enabled={online && !refresh} />
      {!online && (
        <div className="connection-banner" role="status">
          {t("offline")}
        </div>
      )}
      {refresh && (
        <div className="update-banner" role="status">
          <span>{t("updatedApp")}</span>
          <Button onClick={() => void updateServiceWorker(true)}>
            {t("update")}
          </Button>
          <Button variant="ghost" onClick={() => setRefresh(false)}>
            {t("later")}
          </Button>
        </div>
      )}
    </>
  );
}

export function App() {
  return (
    <>
      <AppNotices />
      <Suspense fallback={<Loading />}>
        <EditionRoutes />
      </Suspense>
    </>
  );
}

/** Keep route failures recoverable without exposing implementation details. */
export function RouteLoadFallback() {
  const { t } = useTranslation();
  const online = useOnline();
  return (
    <main className="route-load-fallback" aria-labelledby="route-load-title">
      <section className="panel section-stack">
        <h1 id="route-load-title">{t("routeLoadFailed")}</h1>
        <p role="status">{t(online ? "routeLoadRetryHint" : "offline")}</p>
        <div className="page-actions">
          <Button
            type="button"
            disabled={!online}
            onClick={() => window.location.reload()}
          >
            {t("retry")}
          </Button>
          <Button asChild variant="secondary">
            <a href="/">{t("routeLoadHome")}</a>
          </Button>
        </div>
      </section>
    </main>
  );
}

/** Catch render failures outside the router and offer the same recovery. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? <RouteLoadFallback /> : this.props.children;
  }
}
