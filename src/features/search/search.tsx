/** Unified discovery renders only server-authorised pages for the current actor. */
import {useState} from "react";
import {Link, useSearchParams} from "react-router-dom";
import {useInfiniteQuery} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {useAuth} from "../auth/auth-context";
import {Button} from "../../components/ui/button";
import {ErrorState, Field, Loading, PageHeading,} from "../../components/common";
import {searchKinds, unifiedSearchQuery} from "./unified-api";
import "./unified-i18n";
import "./unified.css";

/** URL navigation remounts the draft; a language change preserves unsaved text. */
function SearchForm({
                        query,
                        kind,
                        onSearch,
                    }: {
    query: string;
    kind: string;
    onSearch: (query: string, kind: string) => void;
}) {
    const {t} = useTranslation("unifiedSearch");
    const [input, setInput] = useState(query);
    const [type, setType] = useState(kind);
    return (
        <form
            className="panel search-page-form"
            onSubmit={(event) => {
                event.preventDefault();
                onSearch(input.trim(), type);
            }}
        >
            <Field id="portal-query" label={t("query")}>
                <input
                    id="portal-query"
                    type="search"
                    value={input}
                    maxLength={100}
                    onChange={(event) => setInput(event.target.value)}
                />
            </Field>
            <Field id="portal-search-kind" label={t("kind")}>
                <select
                    id="portal-search-kind"
                    value={type}
                    onChange={(event) => setType(event.target.value)}
                >
                    <option value="">{t("all")}</option>
                    {searchKinds.map((value) => (
                        <option key={value} value={value}>
                            {t(value)}
                        </option>
                    ))}
                </select>
            </Field>
            <Button>{t("search")}</Button>
        </form>
    );
}

/** Keep the server's cursor intact and hide cached results on a failed recheck. */
export function PortalSearch() {
    const {t} = useTranslation("unifiedSearch");
    const {session} = useAuth();
    const [params, setParams] = useSearchParams();
    const q = (params.get("q") ?? "").trim().slice(0, 100),
        rawKind = params.get("kind") ?? "",
        kind = searchKinds.includes(rawKind as (typeof searchKinds)[number])
            ? rawKind
            : "";
    const query = useInfiniteQuery(unifiedSearchQuery(session!.user.id, q, kind));
    const rows = new Map<
        string,
        NonNullable<typeof query.data>["pages"][number]["items"][number]
    >();
    for (const page of query.data?.pages ?? [])
        for (const row of page.items)
            if (!rows.has(`${row.kind}:${row.id}`))
                rows.set(`${row.kind}:${row.id}`, row);
    return (
        <>
            <PageHeading title={t("title")} description={t("hint")}/>
            <SearchForm
                key={`${q}\0${kind}`}
                query={q}
                kind={kind}
                onSearch={(text, value) =>
                    setParams({q: text, ...(value ? {kind: value} : {})})
                }
            />
            {q.length >= 2 &&
                (query.isPending ? (
                    <Loading/>
                ) : query.isError ? (
                    <ErrorState retry={() => void query.refetch()}/>
                ) : rows.size ? (
                    <>
                        <ul className="portal-search-results">
                            {[...rows.values()].map((row) => (
                                <li key={`${row.kind}:${row.id}`}>
                                    <Link to={row.url}>
                                        <span className="badge">{t(row.kind)}</span>
                                        <strong>{row.title}</strong>
                                        {row.detail && <small>{row.detail}</small>}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                        {query.hasNextPage && (
                            <Button
                                variant="secondary"
                                disabled={query.isFetchingNextPage}
                                onClick={() => void query.fetchNextPage()}
                            >
                                {t("more")}
                            </Button>
                        )}
                    </>
                ) : (
                    <div className="empty-state">{t("empty")}</div>
                ))}
        </>
    );
}