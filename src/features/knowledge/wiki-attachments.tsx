/** Explicit revision-scoped wiki shares, reusing clean personal uploads and the protected download gateway. */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { acceptedFiles, uploadDocument } from "../files/api";
import { downloadPortalDocument } from "../learning/api";
import type { WikiPageRecord } from "./types";
import "./wiki-attachments-i18n";

type Attachment = { id: string; version_id: string; name: string };
export function WikiAttachments({
  actor,
  page,
  canEdit,
}: {
  actor: string;
  page: WikiPageRecord;
  canEdit: boolean;
}) {
  const { t } = useTranslation("wikiAttachments");
  const client = useQueryClient();
  const online = useOnline();
  const key = ["wiki-attachments", actor, page.id, page.version];
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const uploadIdentity = useRef<{
    file: File;
    key: string;
    version?: string;
  } | null>(null);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db().rpc("wiki_attachments", {
        p_page_id: page.id,
      });
      if (error) throw error;
      return data as Attachment[];
    },
  });
  const editable =
    canEdit &&
    page.status !== "archived" &&
    page.version !== page.published_version;
  const save = useMutation({
    mutationFn: async (version: string) => {
      requireOnline();
      const { error } = await db().rpc("manage_wiki_attachment", {
        p_page_id: page.id,
        p_revision: page.version,
        p_version_id: version,
        p_remove: false,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setFile(null);
      uploadIdentity.current = null;
      if (input.current) input.current.value = "";
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("file_required");
      if (!uploadIdentity.current || uploadIdentity.current.file !== file)
        uploadIdentity.current = { file, key: crypto.randomUUID() };
      if (!uploadIdentity.current.version) {
        const result = await uploadDocument(file, {
          scope: "personal",
          kind: "material",
          clientId: uploadIdentity.current.key,
        });
        if (!result.current_version_id) throw new Error("unconfirmed");
        uploadIdentity.current.version = result.current_version_id;
      }
      await save.mutateAsync(uploadIdentity.current.version);
    },
  });
  const remove = useMutation({
    mutationFn: async (version: string) => {
      requireOnline();
      const { error } = await db().rpc("manage_wiki_attachment", {
        p_page_id: page.id,
        p_revision: page.version,
        p_version_id: version,
        p_remove: true,
      });
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const download = useMutation({
    mutationFn: async (item: Attachment) =>
      downloadPortalDocument({ kind: "wiki_resource", id: item.id }, item.name),
  });
  const busy =
    upload.isPending ||
    save.isPending ||
    remove.isPending ||
    download.isPending;
  return (
    <section aria-label={t("title")}>
      <h3>{t("title")}</h3>
      <p>{t("hint")}</p>
      {query.isError ? (
        <Notice kind="error">{t("error")}</Notice>
      ) : query.isPending ? (
        <p role="status">{t("working")}</p>
      ) : query.data.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ul>
          {query.data.map((item) => (
            <li key={item.id}>
              <span>{item.name}</span>{" "}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!online || busy}
                onClick={() => download.mutate(item)}
              >
                {t("download", { name: item.name })}
              </Button>
              {editable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!online || busy}
                  onClick={() => remove.mutate(item.version_id)}
                >
                  {t("remove", { name: item.name })}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !editable && <p>{t("draftFirst")}</p>}
      {editable && (
        <div>
          <label>
            {t("file")}{" "}
            <input
              type="file"
              ref={input}
              accept={acceptedFiles}
              disabled={!online || busy}
              onChange={(event) => {
                uploadIdentity.current = null;
                setFile(event.target.files?.[0] ?? null);
              }}
            />
          </label>{" "}
          <Button
            type="button"
            disabled={!online || busy || !file}
            onClick={() => upload.mutate()}
          >
            {t("upload")}
          </Button>
        </div>
      )}
      {busy && <p role="status">{t("working")}</p>}
      {(upload.isError ||
        save.isError ||
        remove.isError ||
        download.isError) && <Notice kind="error">{t("error")}</Notice>}
    </section>
  );
}
