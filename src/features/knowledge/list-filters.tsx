/** Shared search and category controls for the wiki and forum lists. */
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import { Button } from "../../components/ui/button";
import type { KnowledgeCategory } from "./types";

/** Submit the trimmed search draft through the list's existing query state. */
export function KnowledgeListSearch({
  kind,
  draft,
  onDraftChange,
  onSearch,
}: {
  kind: "wiki" | "forum";
  draft: string;
  onDraftChange: (draft: string) => void;
  onSearch: (search: string) => void;
}) {
  const { t } = useTranslation("knowledge");
  const id = `${kind}-search`;

  return (
    <form
      className="knowledge-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft.trim());
      }}
    >
      <Field id={id} label={t(kind === "wiki" ? "searchWiki" : "searchForum")}>
        <input
          id={id}
          type="search"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          maxLength={200}
        />
      </Field>
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        aria-label={t("search")}
      >
        <Search size={18} />
      </Button>
    </form>
  );
}

/** Offer only active categories using the current interface language. */
export function KnowledgeCategoryFilter({
  kind,
  categories,
  value,
  onChange,
}: {
  kind: "wiki" | "forum";
  categories: KnowledgeCategory[] | undefined;
  value: string;
  onChange: (category: string) => void;
}) {
  const { t, i18n } = useTranslation("knowledge");
  const id = `${kind}-filter-category`;
  const german = i18n.language.startsWith("de");

  return (
    <Field id={id} label={t("category")}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t("all")}</option>
        {categories
          ?.filter((item) => !item.archived)
          .map((item) => (
            <option key={item.id} value={item.id}>
              {german ? item.label_de : item.label_en}
            </option>
          ))}
      </select>
    </Field>
  );
}
