/** Explicit own-only PDF export. Current server roles control eligibility; the
 * abort boundary prevents a late download after unmount or identity transition. */
import {useEffect, useRef} from "react";
import {useMutation, useQuery} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Button} from "../../components/ui/button";
import {Notice} from "../../components/common";
import {userRolesQuery} from "../../lib/queries";
import {useOnline} from "../../lib/online";
import {downloadQualificationPassport} from "./passport-api";
import "./passport-i18n";

/** UI eligibility is informative; the RPC separately verifies the actual actor. */
export function OwnQualificationPassport({actor}: { actor: string }) {
    const {t, i18n} = useTranslation("qualificationPassport");
    const online = useOnline();
    const roles = useQuery(userRolesQuery(actor));
    const pending = useRef<AbortController | null>(null);
    useEffect(
        () => () => {
            pending.current?.abort();
            pending.current = null;
        },
        [actor],
    );
    const download = useMutation({
        mutationFn: async () => {
            const controller = new AbortController();
            pending.current = controller;
            await downloadQualificationPassport(
                i18n.language === "de" ? "de" : "en",
                controller.signal,
            );
        },
    });
    if (
        !roles.data?.some((role) =>
            ["lecturer", "senior_lecturer", "admin", "owner"].includes(role),
        )
    )
        return null;
    return (
        <section className="panel">
            <h2>{t("title")}</h2>
            <p>{t("help")}</p>
            <p>{t("privacy")}</p>
            <Button
                disabled={!online || download.isPending}
                onClick={() => download.mutate()}
            >
                {t(download.isPending ? "pending" : "download")}
            </Button>
            {download.isError && (
                <Notice kind="error">
                    {t(
                        download.error instanceof Error &&
                        download.error.message === "unsupported_glyph"
                            ? "glyph"
                            : "error",
                    )}
                </Notice>
            )}
        </section>
    );
}