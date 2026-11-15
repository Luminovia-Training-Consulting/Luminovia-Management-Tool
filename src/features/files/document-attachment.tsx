import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileDown, FileText } from "lucide-react";
import { db } from "../../lib/supabase";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import { saveDownload, type PortalDocument } from "./api";
import "./i18n";
export function DocumentAttachment({ documentId }: { documentId: string }) {
  const { t } = useTranslation("files");
  const online = useOnline();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useQuery({
    queryKey: ["document", documentId],
    queryFn: async () => {
      const { data, error } = await db()
        .from("documents")
        .select("*")
        .eq("id", documentId)
        .maybeSingle();
      if (error) throw error;
      return data as PortalDocument | null;
    },
    staleTime: 0,
    refetchInterval: 5000,
  });
  if (!file.data) return <span className="muted">{t("error")}</span>;
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
            await saveDownload(documentId, file.data!.original_name);
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
