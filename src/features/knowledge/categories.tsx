/**
 * Wiki/forum category management. Local validation supports the editor; the corresponding RPCs
 * decide persistence and moderation authority.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { categoriesQuery, knowledgeKeys } from "./api";
import type { KnowledgeCategory } from "./types";
import "./i18n";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  label_de: z.string().trim().min(1).max(120),
  label_en: z.string().trim().min(1).max(120),
  archived: z.boolean(),
});

/** Validate category drafts and submit the corresponding wiki/forum management action. */
function CategoryForm({
  actor,
  kind,
  category,
}: {
  actor: string;
  kind: "wiki" | "forum";
  category?: KnowledgeCategory;
}) {
  const { t } = useTranslation("knowledge");
  const online = useOnline();
  const client = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      slug: category?.slug ?? "",
      label_de: category?.label_de ?? "",
      label_en: category?.label_en ?? "",
      archived: category?.archived ?? false,
    },
  });
  const save = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      requireOnline();
      const { error } = await db().rpc("save_knowledge_category", {
        p_id: category?.id ?? null,
        p_kind: kind,
        p_slug: values.slug,
        p_label_de: values.label_de,
        p_label_en: values.label_en,
        p_archived: values.archived,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: knowledgeKeys.categories(actor, kind),
      });
    },
  });
  return (
    <form
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      noValidate
    >
      <Field
        id="category-slug"
        label={t("categorySlug")}
        error={Boolean(form.formState.errors.slug)}
      >
        <input id="category-slug" {...form.register("slug")} maxLength={80} />
      </Field>
      <div className="form-row">
        <Field
          id="category-de"
          label={t("categoryDe")}
          error={Boolean(form.formState.errors.label_de)}
        >
          <input
            id="category-de"
            {...form.register("label_de")}
            maxLength={120}
          />
        </Field>
        <Field
          id="category-en"
          label={t("categoryEn")}
          error={Boolean(form.formState.errors.label_en)}
        >
          <input
            id="category-en"
            {...form.register("label_en")}
            maxLength={120}
          />
        </Field>
      </div>
      {category && (
        <label className="checkbox-label">
          <input type="checkbox" {...form.register("archived")} />
          {t("categoryArchived")}
        </label>
      )}
      <Button disabled={!online || save.isPending}>{t("categorySave")}</Button>
      {save.isSuccess && <Notice>{t("saved")}</Notice>}
      {save.isError && <Notice kind="error">{t("actionFailed")}</Notice>}
    </form>
  );
}

/** Display permitted categories and scope their editor to the selected knowledge area. */
export function CategoryManager({
  actor,
  kind,
  open,
  onOpenChange,
}: {
  actor: string;
  kind: "wiki" | "forum";
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { t, i18n } = useTranslation("knowledge");
  const categories = useQuery({
    ...categoriesQuery(actor, kind),
    enabled: open,
  });
  const [selected, setSelected] = useState("");
  const category = categories.data?.find((item) => item.id === selected);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("manageCategories")}
      description={t("categoryHint")}
    >
      <Field id="category-edit" label={t("category")}>
        <select
          id="category-edit"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">{t("categoryNew")}</option>
          {categories.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {i18n.language === "de" ? item.label_de : item.label_en}
              {item.archived ? ` · ${t("archived")}` : ""}
            </option>
          ))}
        </select>
      </Field>
      {categories.isPending ? (
        <Loading />
      ) : categories.isError ? (
        <ErrorState retry={() => void categories.refetch()} />
      ) : (
        <CategoryForm
          key={selected || "new"}
          actor={actor}
          kind={kind}
          category={category}
        />
      )}
    </Dialog>
  );
}
