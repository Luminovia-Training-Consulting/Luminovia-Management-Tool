import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { Button } from "../../components/ui/button";
import { ErrorState, Loading, PageHeading } from "../../components/common";
interface Result {
  id: string;
  kind: string;
  title: string;
  detail: string;
  url: string;
}
export function PortalSearch() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const [input, setInput] = useState(q);
  const query = useQuery({
    queryKey: ["portal-search", session!.user.id, q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const result: Result[] = [];
      const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      const source = await Promise.allSettled([
        db()
          .from("jobs")
          .select("id,title,customer_name")
          .ilike("title", like)
          .limit(10),
        db()
          .from("documents")
          .select("id,original_name,kind")
          .is("deleted_at", null)
          .ilike("original_name", like)
          .limit(10),
        db().rpc("wiki_pages_list", {
          p_search: q,
          p_locale: "",
          p_category_id: null,
          p_include_archived: false,
        }),
        db().rpc("forum_threads_list", {
          p_search: q,
          p_category_id: null,
          p_include_archived: false,
        }),
        db()
          .from("messages")
          .select("id,room_id,body")
          .is("deleted_at", null)
          .ilike("body", like)
          .limit(10),
        db().rpc("chat_contacts"),
      ]);
      for (let index = 0; index < source.length; index++) {
        const answer = source[index];
        if (answer.status === "rejected") throw answer.reason;
        const { data, error } = answer.value;
        if (error) {
          if (error.code === "42501") continue;
          throw error;
        }
        for (const row of (data ?? []).slice(0, index === 5 ? 1000 : 10)) {
          if (index === 0)
            result.push({
              id: row.id,
              kind: "jobs",
              title: row.title,
              detail: row.customer_name,
              url: `/jobs/${row.id}`,
            });
          if (index === 1)
            result.push({
              id: row.id,
              kind: "files",
              title: row.original_name,
              detail: "",
              url: `/files?q=${encodeURIComponent(row.original_name)}`,
            });
          if (index === 2)
            result.push({
              id: row.id,
              kind: "wiki",
              title: row.title,
              detail: row.locale,
              url: `/wiki?page=${row.id}`,
            });
          if (index === 3)
            result.push({
              id: row.id,
              kind: "forum",
              title: row.title,
              detail: "",
              url: `/forum?thread=${row.id}`,
            });
          if (index === 4)
            result.push({
              id: row.id,
              kind: "chats",
              title: row.body.slice(0, 150),
              detail: "",
              url: `/chats?room=${row.room_id}`,
            });
          if (
            index === 5 &&
            row.display_name.toLocaleLowerCase().includes(q.toLocaleLowerCase())
          )
            result.push({
              id: row.id,
              kind: "people",
              title: row.display_name,
              detail: "",
              url: `/chats?contact=${row.id}`,
            });
        }
      }
      return result;
    },
  });
  return (
    <>
      <PageHeading title={t("portalSearch")} description={t("searchHint")} />
      <form
        className="panel search-page-form"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ q: input });
        }}
      >
        <label className="sr-only" htmlFor="portal-query">
          {t("portalSearch")}
        </label>
        <input
          id="portal-query"
          type="search"
          value={input}
          maxLength={100}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button>
          <Search size={18} />
          {t("searchAction")}
        </Button>
      </form>
      {q.length >= 2 &&
        (query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : query.data.length ? (
          <ul className="portal-search-results">
            {query.data.map((row) => (
              <li key={`${row.kind}:${row.id}`}>
                <Link to={row.url}>
                  <span className="badge">{t(row.kind)}</span>
                  <strong>{row.title}</strong>
                  {row.detail && <small>{row.detail}</small>}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">{t("searchEmpty")}</div>
        ))}
    </>
  );
}
