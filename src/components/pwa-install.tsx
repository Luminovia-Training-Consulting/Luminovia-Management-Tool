import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

type InstallPrompt = Event & { prompt: () => Promise<unknown> };

/** Offer the browser's install dialog only when the browser has made it available. */
export function PwaInstallOffer({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const request = useRef<InstallPrompt>(null);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const ready = (event: Event) => {
      if (!("prompt" in event) || typeof event.prompt !== "function") return;
      event.preventDefault();
      request.current = event as InstallPrompt;
      setAvailable(true);
    };
    const installed = () => {
      request.current = null;
      setAvailable(false);
    };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  if (!available || !enabled) return null;
  function clear() {
    request.current = null;
    setAvailable(false);
  }
  function install() {
    const prompt = request.current;
    clear();
    if (prompt) void prompt.prompt().catch(() => undefined);
  }

  return (
    <div
      className="pwa-install-offer"
      role="group"
      aria-label={t("appInstallation")}
    >
      <Button variant="secondary" onClick={install}>
        {t("installApp")}
      </Button>
      <Button variant="ghost" onClick={clear}>
        {t("later")}
      </Button>
    </div>
  );
}
