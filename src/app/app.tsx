/** Edition entry point, shared PWA notices and render fallback. */
import { Component, type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import EditionRoutes from "@edition-routes";
import { Loading, Notice } from "../components/common";
import { PwaInstallOffer } from "../components/pwa-install";
import { Button } from "../components/ui/button";
import { installationBrand } from "../lib/installation-brand";
import { useOnline } from "../lib/online";

/** Expose offline/update state and activate a new service worker only through the visible user action. */
function AppNotices() {
  const { t } = useTranslation();
  const online = useOnline();
  const {
    needRefresh: [refresh, setRefresh],
    updateServiceWorker,
  } = useRegisterSW();
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

/** Catch render failures and show a fixed bilingual fallback instead of a blank application. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? (
      <div className="state">
        <Notice kind="error">
          {installationBrand.name} · Bitte neu laden. / Please reload.
        </Notice>
        <Button onClick={() => window.location.reload()}>
          Neu laden / Reload
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
