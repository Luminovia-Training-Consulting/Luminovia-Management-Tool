/** Server-versioned forum metadata editor; never replaces a concurrently edited draft. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { categoriesQuery, knowledgeKeys } from "./api";
import type { ForumThread } from "./types";
import "./forum-metadata-i18n";
import "./i18n";
export function ForumMetadataEditor({
  actor,
  thread,
}: {
  actor: string;
  thread: ForumThread;
}) {
  const { t, i18n } = useTranslation("forumMetadata");
  const common = useTranslation().t;
  const knowledge = useTranslation("knowledge").t;
  const client = useQueryClient(),
    online = useOnline();
  const [editing, setEditing] = useState<{
    title: string;
    category: string;
    version: number;
  } | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [invalid, setInvalid] = useState(false);
  const categories = useQuery({
    ...categoriesQuery(actor, "forum"),
    enabled: editing !== null,
  });
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (
        !editing ||
        !title.trim() ||
        title.trim().length > 200 ||
        !categories.data?.some((item) => item.id === category && !item.archived)
      ) {
        setInvalid(true);
        throw new Error("invalid");
      }
      setInvalid(false);
      const { error } = await db().rpc("edit_forum_thread_metadata", {
        p_thread_id: thread.id,
        p_title: title.trim(),
        p_category_id: category,
        p_expected_version: editing.version,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: knowledgeKeys.forum(actor) });
      setEditing(null);
    },
  });
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!online || !thread.metadata_version}
        onClick={() => {
          if (!thread.metadata_version) return;
          setEditing({
            title: thread.title,
            category: thread.category_id,
            version: thread.metadata_version,
          });
          setTitle(thread.title);
          setCategory(thread.category_id);
          setInvalid(false);
          save.reset();
        }}
      >
        <Pencil size={14} />
        {t("editThread")}
      </Button>
      <Dialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next && !save.isPending) setEditing(null);
        }}
        title={t("editThread")}
        description={t("description")}
      >
        {categories.isPending ? (
          <Loading />
        ) : categories.isError ? (
          <ErrorState retry={() => void categories.refetch()} />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field
              id="forum-metadata-title"
              label={knowledge("title")}
              error={invalid}
            >
              <input
                id="forum-metadata-title"
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                disabled={save.isPending}
              />
            </Field>
            <Field
              id="forum-metadata-category"
              label={knowledge("category")}
              error={invalid}
            >
              <select
                id="forum-metadata-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                disabled={save.isPending}
              >
                <option value="">{knowledge("category")}</option>
                {categories.data
                  ?.filter((item) => !item.archived)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {i18n.language === "de" ? item.label_de : item.label_en}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-actions">
              <Button disabled={!online || save.isPending}>
                {common("save")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={save.isPending}
                onClick={() => setEditing(null)}
              >
                {common("cancel")}
              </Button>
            </div>
            {invalid && <Notice kind="error">{t("invalid")}</Notice>}
            {save.isError && !invalid && (
              <Notice kind="error">
                {t(
                  typeof save.error === "object" &&
                    save.error !== null &&
                    "code" in save.error &&
                    save.error.code === "40001"
                    ? "changed"
                    : "failed",
                )}
              </Notice>
            )}
          </form>
        )}
      </Dialog>
    </>
  );
}
