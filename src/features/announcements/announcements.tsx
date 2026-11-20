import {useState} from "react";
import {useSearchParams} from "react-router-dom";
import {useQuery} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {z} from "zod";
import {useAuth} from "../auth/auth-context";
import {useOnline} from "../../lib/online";
import {Button} from "../../components/ui/button";
import {ErrorState, Field, Loading, Notice, PageHeading,} from "../../components/common";
import {AnnouncementCard} from "./announcement-card";
import {type AnnouncementCursor, announcementQuery, announcementsQuery,} from "./api";
import "./i18n";
import "./announcements.css";

function SelectedRevision({actor, id}: { actor: string; id: string }) {
    const {t} = useTranslation("announcements"),
        online = useOnline();
    const query = useQuery({...announcementQuery(actor, id), enabled: online});
    if (!online) return null;
    if (query.isPending) return <Loading/>;
    if (query.isError) return <Notice kind="error">{t("unavailable")}</Notice>;
    return <AnnouncementCard item={query.data} actor={actor}/>;
}

export function AnnouncementsPage() {
    const {t} = useTranslation("announcements"),
        actor = useAuth().session!.user.id,
        online = useOnline();
    const [params] = useSearchParams(),
        requested = params.get("revision"),
        selected =
            requested && z.string().uuid().safeParse(requested).success
                ? requested
                : null;
    const [draft, setDraft] = useState(""),
        [search, setSearch] = useState(""),
        [cursors, setCursors] = useState<(AnnouncementCursor | null)[]>([null]),
        [page, setPage] = useState(0);
    const query = useQuery({
        ...announcementsQuery(actor, search, cursors[page]),
        enabled: online,
    });
    return (
        <>
            <PageHeading title={t("title")} description={t("intro")}/>
            <form
                className="panel announcement-filters"
                onSubmit={(event) => {
                    event.preventDefault();
                    setSearch(draft.trim());
                    setCursors([null]);
                    setPage(0);
                }}
            >
                <Field id="announcement-search" label={t("search")}>
                    <input
                        id="announcement-search"
                        type="search"
                        maxLength={160}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                    />
                </Field>
                <Button disabled={!online}>{t("apply")}</Button>
            </form>
            {selected && <SelectedRevision actor={actor} id={selected}/>}
            {!online ? (
                <Notice kind="error">{t("offline", {ns: "translation"})}</Notice>
            ) : query.isPending ? (
                <Loading/>
            ) : query.isError ? (
                <ErrorState retry={() => void query.refetch()}/>
            ) : (
                <>
                    <div className="announcement-stack">
                        {query.data.items
                            .filter((item) => item.id !== selected)
                            .map((item) => (
                                <AnnouncementCard key={item.id} item={item} actor={actor}/>
                            ))}
                    </div>
                    {!query.data.items.length && !selected && (
                        <Notice>{t("empty")}</Notice>
                    )}
                    <nav className="announcement-pagination" aria-label={t("title")}>
                        <Button
                            variant="secondary"
                            disabled={page === 0 || query.isFetching}
                            onClick={() => setPage(page - 1)}
                        >
                            {t("previous")}
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={!query.data.next_cursor || query.isFetching}
                            onClick={() => {
                                const cursor = query.data.next_cursor;
                                if (cursor) {
                                    setCursors([...cursors.slice(0, page + 1), cursor]);
                                    setPage(page + 1);
                                }
                            }}
                        >
                            {t("next")}
                        </Button>
                    </nav>
                </>
            )}
        </>
    );
}