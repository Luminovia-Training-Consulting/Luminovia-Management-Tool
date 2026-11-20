/** Current member-authorized access mode; all changes are confirmed by the database. */
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {db} from "../../lib/supabase";
import {requireOnline, useOnline} from "../../lib/online";
import {Button} from "../../components/ui/button";
import {ErrorState, Notice} from "../../components/common";
import "./topic-invite-only-i18n";
import {topicInviteOnlyKey, useTopicInviteOnly,} from "./topic-invite-only-api";

export function TopicInviteOnly({
                                    actor,
                                    room,
                                    owner,
                                    mode,
                                }: {
    actor: string;
    room: string;
    owner: boolean;
    mode: ReturnType<typeof useTopicInviteOnly>;
}) {
    const {t} = useTranslation("topicInviteOnly");
    const online = useOnline();
    const client = useQueryClient();
    const change = useMutation({
        mutationFn: async () => {
            requireOnline();
            if (typeof mode.data !== "boolean") throw new Error("mode_unavailable");
            const {error} = await db().rpc("set_topic_invitation_only", {
                p_room_id: room,
                p_expected: mode.data,
                p_enabled: !mode.data,
            });
            if (error) throw error;
        },
        onSettled: () =>
            client.invalidateQueries({queryKey: topicInviteOnlyKey(actor, room)}),
    });
    return (
        <section aria-label={t("title")}>
            <h3>{t("title")}</h3>
            {mode.isError ? (
                <ErrorState retry={() => void mode.refetch()}/>
            ) : (
                mode.isSuccess && (
                    <>
                        <p>{t(mode.data ? "strict" : "direct")}</p>
                        <p>{t("hint")}</p>
                        {owner && (
                            <Button
                                type="button"
                                variant="secondary"
                                disabled={!online || change.isPending}
                                onClick={() => change.mutate()}
                            >
                                {t(mode.data ? "disable" : "enable")}
                            </Button>
                        )}
                    </>
                )
            )}
            {change.isError && <Notice kind="error">{t("failed")}</Notice>}
        </section>
    );
}