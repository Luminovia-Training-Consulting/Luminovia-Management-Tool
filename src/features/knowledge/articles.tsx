/**
 * Wiki lists, article views, drafts and revision history. Saved drafts and published versions
 * remain distinct so editing cannot silently publish changes.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { JSONContent } from "@tiptap/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BookOpenText,
  History,
  Pencil,
  Plus,
  Search,
  Settings2,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import {
  categoriesQuery,
  knowledgeAccessQuery,
  knowledgeKeys,
  wikiHistoryQuery,
  wikiListQuery,
  wikiPageQuery,
} from "./api";
import type { KnowledgeCategory, WikiPageRecord } from "./types";
import { contentIsValid, emptyDocument } from "./content";
import { KnowledgeEditor } from "./editor";
import { CategoryManager } from "./categories";
import "./i18n";
import "./knowledge.css";
import { WikiAttachments } from "./wiki-attachments";
import { WikiCourseTemplates } from "./wiki-course-templates";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const metadata = z.object({
  title: z.string().trim().min(1).max(200),
  locale: z.enum(["de", "en"]),
  category: z.string().min(1),
});

/** Save normalized content/metadata through an explicit draft/publication action. */
function WikiForm({
  actor,
  record,
  categories,
  canPublish,
  onDone,
  onCancel,
}: {
  actor: string;
  record?: WikiPageRecord;
  categories: KnowledgeCategory[];
  canPublish: boolean;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation("knowledge");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [content, setContent] = useState<JSONContent>(
    record?.content ?? emptyDocument,
  );
  const [contentError, setContentError] = useState(false);
  const form = useForm<z.infer<typeof metadata>>({
    resolver: zodResolver(metadata),
    defaultValues: {
      title: record?.title ?? "",
      locale: record?.locale === "en" ? "en" : "de",
      category:
        record?.category_id ??
        categories.find((category) => !category.archived)?.id ??
        "",
    },
  });
  const save = useMutation({
    mutationFn: async ({
      values,
      status,
    }: {
      values: z.infer<typeof metadata>;
      status: "draft" | "published" | "archived";
    }) => {
      requireOnline();
      setContentError(false);
      if (!contentIsValid(content, status !== "published")) {
        setContentError(true);
        throw new Error("content_invalid");
      }
      const { data, error } = await db().rpc("save_wiki_page", {
        p_id: record?.id ?? null,
        p_title: values.title,
        p_locale: values.locale,
        p_category_id: values.category,
        p_content: content,
        p_status: status,
        p_expected_version: record?.version ?? null,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
      return data as {
        page_id: string;
        version: number;
        published_version: number | null;
      };
    },
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: knowledgeKeys.wiki(actor) });
      onDone(result.page_id);
    },
  });
  return (
    <form
      className="knowledge-write panel"
      noValidate
      onSubmit={form.handleSubmit((values) =>
        save.mutate({ values, status: "draft" }),
      )}
    >
      <h2>{t(record ? "edit" : "newArticle")}</h2>
      <Field
        id="wiki-title"
        label={t("title")}
        error={Boolean(form.formState.errors.title)}
      >
        <input
          id="wiki-title"
          {...form.register("title")}
          maxLength={200}
          disabled={save.isPending}
        />
      </Field>
      <div className="form-row">
        <Field id="wiki-language" label={t("language")}>
          <select
            id="wiki-language"
            {...form.register("locale")}
            disabled={save.isPending}
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field
          id="wiki-category"
          label={t("category")}
          error={Boolean(form.formState.errors.category)}
        >
          <select
            id="wiki-category"
            {...form.register("category")}
            disabled={save.isPending}
          >
            <option value="">{t("category")}</option>
            {categories
              .filter(
                (category) =>
                  !category.archived || category.id === record?.category_id,
              )
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {i18n.language === "de"
                    ? category.label_de
                    : category.label_en}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <KnowledgeEditor
        value={content}
        onChange={setContent}
        label={t("content")}
        disabled={save.isPending}
      />
      {contentError && <Notice kind="error">{t("contentLimit")}</Notice>}
      <div className="form-actions">
        <Button disabled={!online || save.isPending}>
          {t(save.isPending ? "saving" : "saveDraft")}
        </Button>
        {canPublish && (
          <Button
            type="button"
            variant="secondary"
            onClick={form.handleSubmit((values) =>
              save.mutate({ values, status: "published" }),
            )}
            disabled={!online || save.isPending}
          >
            {t("publish")}
          </Button>
        )}
        {canPublish && record && (
          <Button
            type="button"
            variant="ghost"
            onClick={form.handleSubmit((values) =>
              save.mutate({ values, status: "archived" }),
            )}
            disabled={!online || save.isPending}
          >
            {t("archive")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={save.isPending}
          onClick={onCancel}
        >
          {common("cancel")}
        </Button>
      </div>
      {save.isError && !contentError && (
        <Notice kind="error">{t("saveFailed")}</Notice>
      )}
    </form>
  );
}

/** Display the permitted version, its history and separate editing state. */
function WikiArticle({
  actor,
  id,
  canPublish,
  categories,
  onBack,
}: {
  actor: string;
  id: string;
  canPublish: boolean;
  categories: KnowledgeCategory[];
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation("knowledge");
  const article = useQuery(wikiPageQuery(actor, id));
  const [editing, setEditing] = useState<WikiPageRecord | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const history = useQuery({
    ...wikiHistoryQuery(actor, id),
    enabled: historyOpen,
  });
  if (article.isPending) return <Loading />;
  if (article.isError)
    return <ErrorState retry={() => void article.refetch()} />;
  if (!article.data) return <Notice kind="error">{t("unavailable")}</Notice>;
  const record = article.data;
  const selectedRevision = history.data?.find(
    (item) => item.version === revision,
  );
  if (editing)
    return (
      <WikiForm
        key={`${editing.id}:${editing.version}`}
        actor={actor}
        record={editing}
        categories={categories}
        canPublish={canPublish}
        onDone={() => setEditing(null)}
        onCancel={() => setEditing(null)}
      />
    );
  return (
    <article className="panel knowledge-article">
      <div className="knowledge-article-actions">
        <Button
          className="knowledge-mobile-back"
          variant="ghost"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          {t("wiki")}
        </Button>
        <span className={`badge knowledge-state-${record.status}`}>
          {t(record.status)}
        </span>
        <span className="badge">{record.locale.toUpperCase()}</span>
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          <History size={16} />
          {t("history")}
        </Button>
        {(record.owner_id === actor || canPublish) && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditing(record)}
          >
            <Pencil size={16} />
            {t("edit")}
          </Button>
        )}
      </div>
      <h2>{record.title}</h2>
      <p className="knowledge-byline">
        {t("author", { name: record.owner_name })} ·{" "}
        {t("version", { version: record.version })}
      </p>
      {record.has_draft && <Notice>{t("draftNotice")}</Notice>}
      <KnowledgeEditor
        key={`${record.id}:${record.version}`}
        value={record.content}
        label={record.title}
        readOnly
      />
      <WikiAttachments
        actor={actor}
        page={record}
        canEdit={record.owner_id === actor || canPublish}
      />
      <WikiCourseTemplates
        actor={actor}
        page={record}
        canEdit={record.owner_id === actor || canPublish}
      />
      <Dialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title={t("history")}
        description={t("historyHint")}
      >
        {history.isPending ? (
          <Loading />
        ) : history.isError ? (
          <ErrorState retry={() => void history.refetch()} />
        ) : (
          <>
            <Field id="wiki-revision" label={t("history")}>
              <select
                id="wiki-revision"
                value={revision ?? ""}
                onChange={(event) =>
                  setRevision(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
              >
                <option value="">{t("latest")}</option>
                {history.data.map((item) => (
                  <option key={item.version} value={item.version}>
                    {t("version", { version: item.version })} ·{" "}
                    {item.editor_name}
                    {item.published ? ` · ${t("published")}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            {selectedRevision && (
              <>
                <p className="knowledge-byline">
                  {t("revisionBy", {
                    name: selectedRevision.editor_name,
                    date: new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(selectedRevision.created_at)),
                  })}
                </p>
                <KnowledgeEditor
                  key={selectedRevision.version}
                  value={selectedRevision.content}
                  label={selectedRevision.title}
                  readOnly
                />
              </>
            )}
          </>
        )}
      </Dialog>
    </article>
  );
}

/** Coordinate wiki search, categories and article routes using authorized server lists. */
export function KnowledgeArticles() {
  const { t, i18n } = useTranslation("knowledge");
  const online = useOnline();
  const { session } = useAuth();
  const actor = session!.user.id;
  const access = useQuery(knowledgeAccessQuery(actor));
  const categories = useQuery({
    ...categoriesQuery(actor, "wiki"),
    enabled: Boolean(access.data?.can_author),
  });
  const [params, setParams] = useSearchParams();
  const id = params.get("page");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [locale, setLocale] = useState("");
  const [archived, setArchived] = useState(false);
  const [writing, setWriting] = useState(false);
  const [managing, setManaging] = useState(false);
  const list = useQuery({
    ...wikiListQuery(actor, search, locale, category, archived),
    enabled: Boolean(access.data?.can_author),
  });
  const select = (nextId: string | null) => {
    const next = new URLSearchParams(params);
    if (nextId) next.set("page", nextId);
    else next.delete("page");
    setParams(next);
    setWriting(false);
  };
  if (access.isPending) return <Loading />;
  if (access.isError) return <ErrorState retry={() => void access.refetch()} />;
  if (!access.data?.can_author)
    return <Notice kind="error">{t("noAccess")}</Notice>;
  return (
    <>
      <PageHeading
        title={t("wiki")}
        description={t("wikiIntro")}
        action={
          <div className="knowledge-page-actions">
            {access.data.can_publish_wiki && (
              <Button variant="secondary" onClick={() => setManaging(true)}>
                <Settings2 size={16} />
                {t("manageCategories")}
              </Button>
            )}
            <Button
              onClick={() => {
                select(null);
                setWriting(true);
              }}
              disabled={!online}
            >
              <Plus size={17} />
              {t("newArticle")}
            </Button>
          </div>
        }
      />
      <div
        className={`knowledge-workspace ${id || writing ? "knowledge-has-selection" : ""}`}
      >
        <aside className="knowledge-directory panel">
          <form
            className="knowledge-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(input.trim());
            }}
          >
            <Field id="wiki-search" label={t("searchWiki")}>
              <input
                id="wiki-search"
                type="search"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                maxLength={200}
              />
            </Field>
            <Button variant="ghost" size="icon" aria-label={t("search")}>
              <Search size={18} />
            </Button>
          </form>
          <div className="form-row">
            <Field id="wiki-filter-category" label={t("category")}>
              <select
                id="wiki-filter-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">{t("all")}</option>
                {categories.data
                  ?.filter((item) => !item.archived)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {i18n.language === "de" ? item.label_de : item.label_en}
                    </option>
                  ))}
              </select>
            </Field>
            <Field id="wiki-filter-language" label={t("language")}>
              <select
                id="wiki-filter-language"
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
              >
                <option value="">{t("all")}</option>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>
          {access.data.can_publish_wiki && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={archived}
                onChange={(event) => setArchived(event.target.checked)}
              />
              {t("includeArchived")}
            </label>
          )}
          {list.isPending ? (
            <Loading />
          ) : list.isError ? (
            <ErrorState retry={() => void list.refetch()} />
          ) : list.data.length ? (
            <ul className="knowledge-item-list">
              {list.data.map((item) => (
                <li key={item.id}>
                  <button
                    className={id === item.id ? "is-selected" : ""}
                    type="button"
                    aria-pressed={id === item.id}
                    onClick={() => select(item.id)}
                  >
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {i18n.language === "de"
                          ? item.category_label_de
                          : item.category_label_en}
                      </small>
                    </span>
                    <span className="badge">{t(item.status)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="knowledge-empty-list">
              <BookOpenText size={28} />
              <h3>{t("noPages")}</h3>
              <p>{t("noPagesHint")}</p>
            </div>
          )}
        </aside>
        <div className="knowledge-main">
          {writing ? (
            categories.isError ? (
              <ErrorState retry={() => void categories.refetch()} />
            ) : categories.data?.some((item) => !item.archived) ? (
              <WikiForm
                actor={actor}
                categories={categories.data}
                canPublish={access.data.can_publish_wiki}
                onDone={select}
                onCancel={() => setWriting(false)}
              />
            ) : (
              <Notice>{t("categoryMissing")}</Notice>
            )
          ) : id ? (
            <WikiArticle
              key={id}
              actor={actor}
              id={id}
              categories={categories.data ?? []}
              canPublish={access.data.can_publish_wiki}
              onBack={() => select(null)}
            />
          ) : (
            <div className="panel knowledge-welcome">
              <BookOpenText size={42} />
              <h2>{t("chooseArticle")}</h2>
              <p>{t("chooseArticleHint")}</p>
            </div>
          )}
        </div>
      </div>
      <CategoryManager
        actor={actor}
        kind="wiki"
        open={managing}
        onOpenChange={setManaging}
      />
    </>
  );
}
