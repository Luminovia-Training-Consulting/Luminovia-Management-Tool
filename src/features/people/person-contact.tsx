import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Copy, Mail, Phone} from "lucide-react";
import {Button} from "../../components/ui/button";
import {contactEmailLink, contactPhoneLink, personContactQuery,} from "../profile/contact-api";
import "../profile/contact-i18n";
import "../profile/contact.css";

export function PersonContact({
                                  actor,
                                  target,
                              }: {
    actor: string;
    target: string;
}) {
    const {t} = useTranslation("contact");
    const query = useQuery(personContactQuery(actor, target));
    const email = query.isError ? null : query.data?.email;
    const phone = query.isError ? null : query.data?.phone;
    const emailLink = email ? contactEmailLink(email) : null;
    const phoneLink = phone ? contactPhoneLink(phone) : null;
    return (
        <section className="panel person-contact" aria-label={t("contact")}>
            <h2>{t("contact")}</h2>
            {query.isError ? (
                <>
                    <p role="alert">{t("loadError")}</p>
                    <Button variant="ghost" onClick={() => void query.refetch()}>
                        {t("retry")}
                    </Button>
                </>
            ) : query.isPending ? (
                <p>{t("loading")}</p>
            ) : (
                <>
                    {!email && !phone && <p className="muted">{t("none")}</p>}
                    {email && (
                        <div>
                            <p>{email}</p>
                            <CopyContact key={`email:${email}`} value={email} kind="email"/>
                            {emailLink && (
                                <a href={emailLink}>
                                    <Mail size={17} aria-hidden="true"/>
                                    {t("write")}
                                </a>
                            )}
                        </div>
                    )}
                    {phone && (
                        <div>
                            <p>{phone}</p>
                            <CopyContact key={`phone:${phone}`} value={phone} kind="phone"/>
                            {phoneLink && (
                                <a href={phoneLink}>
                                    <Phone size={17} aria-hidden="true"/>
                                    {t("call")}
                                </a>
                            )}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

/** Copy only the value currently returned by the permission-filtered contact query. */
function CopyContact({
                         value,
                         kind,
                     }: {
    value: string;
    kind: "email" | "phone";
}) {
    const {t} = useTranslation("contact");
    const [status, setStatus] = useState<"success" | "error" | null>(null);
    return (
        <>
            <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                    setStatus(null);
                    try {
                        await navigator.clipboard.writeText(value);
                        setStatus("success");
                    } catch {
                        setStatus("error");
                    }
                }}
            >
                <Copy size={17} aria-hidden="true"/>
                {t(kind === "email" ? "copyEmail" : "copyPhone")}
            </Button>
            {status && (
                <p role={status === "success" ? "status" : "alert"}>
                    {t(status === "success" ? "copySuccess" : "copyError")}
                </p>
            )}
        </>
    );
}