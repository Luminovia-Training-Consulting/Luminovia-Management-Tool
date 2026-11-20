/** Direct account creation uses the privileged Edge facade after current role reservation. */
import {useRef, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Link} from "react-router-dom";
import {db} from "../../lib/supabase";
import {requireOnline, useOnline} from "../../lib/online";
import {Button} from "../../components/ui/button";
import {Field, Notice} from "../../components/common";
import {accountRequest, type AccountRoleCapability} from "./api";
import "./i18n";

/** Create one account through the caller-authorized facade; password input is transient and never retained after confirmation. */
export function CreateAccountForm({
                                      actor,
                                      roles,
                                      canLinkOrganisations,
                                  }: {
    actor: string;
    roles: AccountRoleCapability[];
    canLinkOrganisations: boolean;
}) {
    const {t} = useTranslation("accounts");
    const common = useTranslation().t;
    const online = useOnline();
    const cache = useQueryClient();
    const available = roles.filter(
        (entry) =>
            entry.assignable &&
            !["owner", "participant"].includes(entry.role) &&
            (entry.role !== "client" || canLinkOrganisations),
    );
    const [email, setEmail] = useState("");
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const validInitialPassword =
        password.length >= 8 &&
        password.length <= 128 &&
        /[A-Z]/.test(password) &&
        /[a-z]/.test(password) &&
        /[0-9]/.test(password) &&
        /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?\/]/.test(password);
    const [role, setRole] = useState("lecturer");
    const [organisation, setOrganisation] = useState("");
    const request = useRef({signature: "", id: ""});
    const organisations = useQuery({
        queryKey: ["account-create-organisations", actor],
        enabled: role === "client" && canLinkOrganisations,
        queryFn: async () => {
            const result = await db()
                .from("organisations")
                .select("id,name")
                .is("archived_at", null)
                .order("name");
            if (result.error) throw result.error;
            return result.data as { id: string; name: string }[];
        },
    });
    const create = useMutation({
        mutationFn: async () => {
            requireOnline();
            const values = {
                email: email.trim(),
                display_name: name.trim(),
                password,
                role,
                organisation_id: role === "client" ? organisation : null,
            };
            const signature = JSON.stringify(values);
            if (request.current.signature !== signature)
                request.current = {signature, id: crypto.randomUUID()};
            return accountRequest<{ status: string; user_id?: string }>(
                "users",
                "POST",
                {...values, idempotency_key: request.current.id},
            );
        },
        onError: (error) => {
            if (error instanceof Error && error.message === "creation_failed")
                request.current = {signature: "", id: ""};
        },
        onSuccess: async (result) => {
            if (result.status === "created") {
                setPassword("");
                request.current = {signature: "", id: ""};
                await cache.invalidateQueries({queryKey: ["accounts", actor]});
            }
        },
    });
    if (!available.length) return null;
    return (
        <form
            className="panel profile-form"
            onSubmit={(event) => {
                event.preventDefault();
                // Prevent a forged submit event from sending an invalid credential to the Edge handler.
                if (!validInitialPassword) return;
                create.mutate();
            }}
        >
            <h2>{t("createTitle")}</h2>
            <p>{t("createHint")}</p>
            <Field id="create-account-name" label={common("displayName")}>
                <input
                    id="create-account-name"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                        create.reset();
                    }}
                />
            </Field>
            <Field id="create-account-email" label={common("email")}>
                <input
                    id="create-account-email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="off"
                    value={email}
                    onChange={(event) => {
                        setEmail(event.target.value);
                        create.reset();
                    }}
                />
            </Field>
            <Field id="create-account-role" label={t("role")}>
                <select
                    id="create-account-role"
                    value={role}
                    onChange={(event) => {
                        setRole(event.target.value);
                        setOrganisation("");
                        create.reset();
                    }}
                >
                    {available.map((entry) => (
                        <option key={entry.role} value={entry.role}>
                            {t(entry.role)}
                        </option>
                    ))}
                </select>
            </Field>
            {role === "client" && (
                <Field id="create-account-organisation" label={t("organisation")}>
                    <select
                        id="create-account-organisation"
                        required
                        value={organisation}
                        disabled={organisations.isPending || organisations.isError}
                        onChange={(event) => setOrganisation(event.target.value)}
                    >
                        <option value="">{t("choose")}</option>
                        {organisations.data?.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                            </option>
                        ))}
                    </select>
                </Field>
            )}
            <Field id="create-account-password" label={t("initialPassword")}>
                <input
                    id="create-account-password"
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => {
                        setPassword(event.target.value);
                        create.reset();
                    }}
                />
            </Field>
            <Button
                disabled={
                    !online ||
                    create.isPending ||
                    !validInitialPassword ||
                    !available.some((entry) => entry.role === role) ||
                    (role === "client" && !organisation)
                }
            >
                {t(create.isPending ? "creating" : "createTitle")}
            </Button>
            {create.isError && <Notice kind="error">{t("createError")}</Notice>}
            {create.data?.status === "created" && (
                <Notice>
                    {t("created")}{" "}
                    {create.data.user_id && (
                        <Link to={`/people/${create.data.user_id}`}>
                            {t("openCreated")}
                        </Link>
                    )}
                </Notice>
            )}
        </form>
    );
}