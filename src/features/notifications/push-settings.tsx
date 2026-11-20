// Explicit per-device consent and removal use server confirmation; browser
// cleanup is fenced to the actor that initiated the asynchronous operation.
import {useEffect, useRef, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {ErrorState, Loading, Notice} from "../../components/common";
import {Button} from "../../components/ui/button";
import {requireOnline, useOnline} from "../../lib/online";
import {bindPushDevice, browserSubscription, clearPushDevice, currentPushToken, pushCapability, pushSupported,} from "./push-browser";
import {pushDevicesQuery, pushKey, registerPushDevice, removePushDevice,} from "./push-api";
import i18n from "../../lib/i18n";

const de = {
    title: "Push auf deinen Geräten",
    help: "Aktiviere Hinweise ausdrücklich auf diesem Gerät. Auf dem Sperrbildschirm erscheint nur ein allgemeiner Portal-Hinweis. Ruhezeiten gelten auch für Push.",
    unsupported:
        "Dieser Browser unterstützt Push hier nicht. Auf iPhone und iPad ist dafür eine unterstützte, zum Home-Bildschirm hinzugefügte Web-App erforderlich.",
    unavailable:
        "Push ist auf diesem Server noch nicht für den Versand eingerichtet.",
    enable: "Push auf diesem Gerät aktivieren",
    enabled: "Dieses Gerät ist verbunden.",
    remove: "Gerät entfernen",
    current: "Dieses Gerät",
    error:
        "Push konnte nicht geändert werden. Prüfe Browserberechtigung, installierte Web-App und Verbindung.",
    saved: "Push-Einstellung bestätigt.",
    devices: "Deine verbundenen Geräte",
    install:
        "Auf iPhone und iPad: Öffne die Seite in einem unterstützten Browser, wähle Teilen → Zum Home-Bildschirm und öffne anschließend die installierte Web-App. Web Push benötigt iOS/iPadOS16.4 oder neuer.",
    blocked:
        "Benachrichtigungen sind im Browser gesperrt. Erlaube sie in den Website-Einstellungen und prüfe die Benachrichtigungseinstellungen deines Betriebssystems. Lade diese Seite danach neu.",
    installHelp:
        "Desktop: Installiere Luminovia über das Installationssymbol oder Browsermenü. Android: Wähle App installieren oder Zum Startbildschirm hinzufügen. Push bleibt von Browser, Geräteberechtigung und Betriebssystem abhängig.",
};
const en: Record<keyof typeof de, string> = {
    title: "Push on your devices",
    help: "Explicitly enable alerts on this device. The lock screen shows only a generic portal update. Quiet hours also apply to push.",
    unsupported:
        "This browser does not support push here. iPhone and iPad require a supported web app added to the Home Screen.",
    unavailable: "Push delivery has not been configured on this server yet.",
    enable: "Enable push on this device",
    enabled: "This device is connected.",
    remove: "Remove device",
    current: "This device",
    error:
        "Push could not be changed. Check browser permission, installed web app and connection.",
    saved: "Push setting confirmed.",
    devices: "Your connected devices",
    install:
        "On iPhone and iPad: open this page in a supported browser, choose Share → Add to Home Screen, then open the installed web app. Web Push requires iOS/iPadOS16.4 or newer.",
    blocked:
        "Notifications are blocked in your browser. Allow them in the site settings and check your operating system notification settings. Reload this page afterwards.",
    installHelp:
        "Desktop: install Luminovia using the install icon or browser menu. Android: choose Install app or Add to Home screen. Push depends on browser support, device permission and operating system settings.",
};
i18n.addResourceBundle("de", "push", de);
i18n.addResourceBundle("en", "push", en);

export function PushSettings({actor}: { actor: string }) {
    const {t} = useTranslation("push");
    const client = useQueryClient();
    const online = useOnline();
    const capability = pushCapability();
    const query = useQuery(pushDevicesQuery(actor));
    const [token, setToken] = useState<string | null>(null);
    const liveActor = useRef<string | null>(actor);
    useEffect(() => {
        liveActor.current = actor;
        return () => {
            liveActor.current = null;
        };
    }, [actor]);
    useEffect(() => {
        let active = true;
        if (pushSupported())
            void currentPushToken(actor)
                .then((value) => {
                    if (active) setToken(value);
                })
                .catch(() => {
                });
        return () => {
            active = false;
        };
    }, [actor]);
    const enable = useMutation({
        mutationFn: async () => {
            requireOnline();
            const key = query.data?.public_key;
            if (!query.data?.enabled || !key) throw new Error("push_unavailable");
            const subscription = await browserSubscription(key);
            const deviceToken = crypto.randomUUID();
            if (liveActor.current !== actor) {
                await subscription.unsubscribe();
                throw new Error("push_actor_changed");
            }
            try {
                await registerPushDevice(
                    subscription.toJSON(),
                    deviceToken,
                    t("current"),
                );
                if (liveActor.current !== actor) throw new Error("push_actor_changed");
                await bindPushDevice(actor, deviceToken);
                if (liveActor.current !== actor) throw new Error("push_actor_changed");
                setToken(deviceToken);
            } catch (error) {
                await subscription.unsubscribe();
                throw error;
            }
        },
        onSuccess: () => client.invalidateQueries({queryKey: pushKey(actor)}),
    });
    const remove = useMutation({
        mutationFn: async ({id, current}: { id: string; current: boolean }) => {
            requireOnline();
            const removed = await removePushDevice(id);
            if (!removed) throw new Error("push_device_changed");
            if (current && liveActor.current === actor) {
                await clearPushDevice(actor);
                if (liveActor.current === actor) setToken(null);
            }
        },
        onSuccess: () => client.invalidateQueries({queryKey: pushKey(actor)}),
    });
    return (
        <section className="panel notification-preferences">
            <h2>{t("title")}</h2>
            <p>{t("help")}</p>
            <p>{t("installHelp")}</p>
            {capability !== "ready" && <p>{t(capability)}</p>}
            {query.isPending ? (
                <Loading/>
            ) : query.isError ? (
                <ErrorState retry={() => void query.refetch()}/>
            ) : (
                <>
                    {!query.data.enabled ? (
                        <p>{t("unavailable")}</p>
                    ) : capability === "ready" ? (
                        <Button
                            disabled={
                                !online ||
                                enable.isPending ||
                                Boolean(
                                    query.data.devices.find(
                                        (device) => device.device_token === token,
                                    ),
                                )
                            }
                            onClick={() => enable.mutate()}
                        >
                            {t("enable")}
                        </Button>
                    ) : null}
                    {query.data.devices.length > 0 && (
                        <>
                            <h3>{t("devices")}</h3>
                            <ul>
                                {query.data.devices.map((device) => (
                                    <li key={device.id}>
                    <span>
                      {device.label}
                        {device.device_token === token
                            ? ` · ${t("enabled")}`
                            : ""}
                    </span>{" "}
                                        <Button
                                            variant="ghost"
                                            disabled={!online || remove.isPending}
                                            onClick={() =>
                                                remove.mutate({
                                                    id: device.id,
                                                    current: device.device_token === token,
                                                })
                                            }
                                        >
                                            {t("remove")}
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </>
            )}
            {(enable.isError || remove.isError) && (
                <Notice kind="error">{t("error")}</Notice>
            )}
            {(enable.isSuccess || remove.isSuccess) && <Notice>{t("saved")}</Notice>}
        </section>
    );
}