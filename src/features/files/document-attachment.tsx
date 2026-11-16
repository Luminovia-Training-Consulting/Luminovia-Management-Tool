/**
 * Einzelner Dateianhang über die vorhandene Dokumentprojektion. Aktuelle Zugriffsfehler ersetzen alte Metadaten; Downloads laufen weiterhin über das authentifizierte Dateigateway.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileDown, FileText } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import { documentQuery, saveDownload } from "./api";
import "./i18n";
/** Lädt genau den angehängten Dokumentdatensatz und lädt dessen konkret ausgewählte saubere Version herunter. */
export function DocumentAttachment({ documentId }: { documentId: string }) {
  const { t } = useTranslation("files");
  const online = useOnline();
  const { session } = useAuth();
  const actor = session?.user.id ?? "";
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useQuery({
    ...documentQuery(actor, documentId),
    enabled: Boolean(actor) && online,
  });
  if (file.isPending)
    return (
      <span className="muted" role="status">
        {t("loading", { ns: "translation" })}
      </span>
    );
  if (file.isError || !file.data)
    return <span className="muted">{t("error")}</span>;
  return (
    <div className="document-attachment">
      <FileText size={18} />
      <div>
        <strong>{file.data.original_name}</strong>
        <small>
          {t(file.data.status === "clean" ? "clean" : file.data.status)}
        </small>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${t("download")}: ${file.data.original_name}`}
        disabled={!online || busy || file.data.status !== "clean"}
        onClick={async () => {
          setFailed(false);
          setBusy(true);
          try {
            await saveDownload(
              documentId,
              file.data!.original_name,
              file.data!.current_version_id,
            );
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FileDown size={18} />
      </Button>
      {failed && <Notice kind="error">{t("error")}</Notice>}
    </div>
  );
}
