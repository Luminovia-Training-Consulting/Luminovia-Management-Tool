/** Current actor's server-authorised projection of group-wide topic message pins. */
import {useTranslation} from "react-i18next";
import {Button} from "../../components/ui/button";
import {ErrorState, Loading, Notice} from "../../components/common";
import {MessageText} from "./message";
import type {TopicPinnedMessage} from "./topic-message-pins-api";
import "./topic-message-pins-i18n";
import "./topic-message-pins.css";

/** Pinned text is rendered as plain message content; navigation loads actual authorised history. */
export function TopicMessagePins({
                                     pins,
                                     loading,
                                     error,
                                     onRetry,
                                     onJump,
                                     jumping,
                                     searchActive,
                                     jumpFailed,
                                 }: {
    pins: TopicPinnedMessage[];
    loading: boolean;
    error: boolean;
    onRetry: () => void;
    onJump: (id: string) => void;
    jumping: boolean;
    searchActive: boolean;
    jumpFailed: boolean;
}) {
    const {t} = useTranslation("topicMessagePins");
    return (
        <section className="chat-topic-pins" aria-label={t("title")}>
            <h3>{t("title")}</h3>
            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorState retry={onRetry}/>
            ) : pins.length === 0 ? (
                <p>{t("none")}</p>
            ) : (
                <ul>
                    {pins.map((pin) => (
                        <li key={pin.id}>
                            <strong>{pin.sender_name}</strong>
                            <p className="chat-message-body">
                                <MessageText body={pin.body}/>
                            </p>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={jumping || searchActive}
                                onClick={() => onJump(pin.id)}
                            >
                                {t("jump", {name: pin.sender_name})}
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
            {searchActive && pins.length > 0 && <p>{t("clearSearch")}</p>}
            {jumpFailed && <Notice kind="error">{t("jumpFailed")}</Notice>}
        </section>
    );
}