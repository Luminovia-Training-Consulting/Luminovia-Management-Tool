import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileCheck2, LoaderCircle, Upload } from "lucide-react";
import { uploadDocument, type PortalDocument } from "../files/api";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import "./i18n";
export function CommercialPdfUpload({
  kind,
  ownerId,
  label,
  onDocument,
  disabled = false,
}: {
  kind: "contract" | "invoice";
  ownerId: string;
  label: string;
  onDocument: (document: PortalDocument | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("commercial");
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [name, setName] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      setProgress(0);
      setName("");
      onDocument(null);
      if (
        file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")
      )
        throw new Error("unsupported_type");
      const signature = JSON.stringify([
        file.name,
        file.size,
        file.lastModified,
        ownerId,
      ]);
      if (!retry.current || retry.current.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      return uploadDocument(
        file,
        { scope: "personal", kind, ownerId, clientId: retry.current.key },
        setProgress,
      );
    },
    onSuccess: (document) => {
      if (!mounted.current) return;
      setName(document.original_name);
      retry.current = null;
      onDocument(document);
    },
  });
  return (
    <div className="commercial-upload">
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        aria-label={label}
        hidden
        disabled={!online || disabled || upload.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) upload.mutate(file);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        onClick={() => input.current?.click()}
        disabled={!online || disabled || upload.isPending || !ownerId}
      >
        <Upload size={17} />
        {label}
      </Button>
      <small>{t("pdfHint")}</small>
      {upload.isPending && (
        <p role="status">
          <LoaderCircle size={16} className="spin" />
          {t("uploading", { progress: Math.round(progress) })}
        </p>
      )}
      {name && !upload.isPending && (
        <p className="commercial-file-ready">
          <FileCheck2 size={16} />
          {name} · {t("fileReady")}
        </p>
      )}
      {upload.isError && <Notice kind="error">{t("uploadFailed")}</Notice>}
    </div>
  );
}
