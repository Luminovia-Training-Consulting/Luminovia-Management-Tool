/**
 * Validated invitation form with reusable request identity. An uncertain network outcome is not
 * a sent invitation; status and permitted roles follow the server contract.
 */
import {useRef} from "react";
import {useForm, useWatch} from "react-hook-form";
import {z} from "zod";
import {zodResolver} from "@hookform/resolvers/zod";
import {useMutation, useQuery} from "@tanstack/react-query";
import {FunctionsHttpError} from "@supabase/supabase-js";
import {useTranslation} from "react-i18next";
import {Field, Notice} from "../../components/common";
import {Button} from "../../components/ui/button";
import {requireOnline, useOnline} from "../../lib/online";
import {db} from "../../lib/supabase";
import {accountRequest, accountRoleCatalogQuery, accountRoles,} from "../accounts/api";
import {useAuth} from "../auth/auth-context";
import {commissionAccessQuery} from "../commercial/commission-api";
import "../accounts/i18n";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
    email: z.string().trim().email().max(254),
    display_name: z.string().trim().max(120),
    role: z.enum(accountRoles),
    organisation_id: z.string(),
});
/** Derive form values from the validation schema so runtime input checks and TypeScript agree. */
type Values = z.infer<typeof schema>;
/** Confirmed status values supported by the durable invitation/reservation protocol. */
const serverStatuses = [
    "sent",
    "already_sent",
    "in_progress",
    "throttled",
    "idempotency_conflict",
    "failed",
] as const;
/** Known delivery/local failures; an uncertain response must not claim that mail was sent. */
type ResultStatus =
    | (typeof serverStatuses)[number]
    | "permission_required"
    | "disabled"
    | "origin_denied"
    | "unavailable";
/** Bound the invitation result to known statuses instead of trusting arbitrary response data. */
type Result = { status: ResultStatus };
/** Normalized business input used to recognize the same invitation on retry. */
const signature = (values: Partial<Values>) =>
    JSON.stringify([
        values.email?.trim().toLowerCase() ?? "",
        values.display_name?.trim() ?? "",
        values.role ?? "lecturer",
        values.organisation_id ?? "",
    ]);

/** Accept only known invitation statuses from response data; unknown responses cannot become success. */
function resultFrom(value: unknown): Result {
    if (!value || typeof value !== "object") return {status: "unavailable"};
    const data = value as Record<string, unknown>;
    if (
        typeof data.status === "string" &&
        serverStatuses.some((status) => status === data.status)
    )
        return {status: data.status as ResultStatus};
    if (
        data.error === "permission_required" ||
        data.error === "authentication_required"
    )
        return {status: "permission_required"};
    if (data.error === "invitations_disabled") return {status: "disabled"};
    if (data.error === "origin_not_allowed") return {status: "origin_denied"};
    return {status: "unavailable"};
}

/**
 * Validate invitation/role input, retain retry identity and show only confirmed delivery state.
 * The parent requires users.manage/users.invite; Edge and PostgreSQL repeat permission checks.
 */
export function InviteForm({
                               allRoles = false,
                               canAssignRoles = false,
                           }: {
    allRoles?: boolean;
    canAssignRoles?: boolean;
}) {
    const {t} = useTranslation();
    const {session} = useAuth();
    const actor = session?.user.id ?? "";
    const clientAccess = useQuery({
        ...commissionAccessQuery(actor),
        enabled: allRoles && canAssignRoles && Boolean(actor),
    });
    const canLinkOrganisations = Boolean(
        clientAccess.data?.can_manage_client_memberships,
    );
    const catalog = useQuery({
        ...accountRoleCatalogQuery(actor),
        enabled: allRoles && Boolean(actor),
    });
    const availableRoles =
        catalog.data?.filter(
            (entry) =>
                entry.assignable && !["participant", "owner"].includes(entry.role),
        ) ?? [];
    const accountText = useTranslation("accounts").t;
    const organisations = useQuery({
        queryKey: ["invite-organisations", actor],
        enabled: allRoles && canLinkOrganisations,
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
    const online = useOnline();
    const retry = useRef<{ signature: string; key: string } | null>(null);
    const {
        register,
        control,
        handleSubmit,
        formState: {errors},
    } = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: {
            email: "",
            display_name: "",
            role: "lecturer",
            organisation_id: "",
        },
    });
    const watched = useWatch({control});
    const current = signature(watched);
    const invitation = useMutation({
        mutationFn: async (values: Values): Promise<Result> => {
            requireOnline();
            const normalized = {
                email: values.email.trim().toLowerCase(),
                display_name: values.display_name.trim(),
                role: values.role,
                organisation_id:
                    values.role === "client" && canLinkOrganisations
                        ? values.organisation_id
                        : "",
            };
            const next = signature(normalized);
            // Preserve the same key after network/HTTP failures. Only editing the intended
            // recipient or display name starts another request; the DB also deduplicates email.
            if (!retry.current || retry.current.signature !== next)
                retry.current = {signature: next, key: crypto.randomUUID()};
            if (allRoles) {
                return resultFrom(
                    await accountRequest("invitations", "POST", {
                        ...normalized,
                        organisation_id: normalized.organisation_id || null,
                        idempotency_key: retry.current.key,
                    }),
                );
            }
            const {data, error} = await db().functions.invoke("invite-lecturer", {
                body: {
                    email: normalized.email,
                    display_name: normalized.display_name,
                    idempotency_key: retry.current.key,
                },
            });
            if (error) {
                if (error instanceof FunctionsHttpError) {
                    try {
                        return resultFrom(await error.context.clone().json());
                    } catch {
                        return {status: "unavailable"};
                    }
                }
                return {status: "unavailable"};
            }
            return resultFrom(data);
        },
    });
    const sameRequest =
        invitation.variables !== undefined &&
        signature(invitation.variables) === current;
    const result = sameRequest ? invitation.data : undefined;
    const sent = result?.status === "sent" || result?.status === "already_sent";
    return (
        <form
            className="panel admin-form"
            noValidate
            onSubmit={handleSubmit((values) => invitation.mutate(values))}
        >
            <h2>{allRoles ? accountText("invite") : t("inviteTitle")}</h2>
            <p>{allRoles ? accountText("inviteHint") : t("inviteHint")}</p>
            <div className="form-row">
                <Field
                    id="invite-email"
                    label={t("email")}
                    error={Boolean(errors.email)}
                >
                    <input
                        id="invite-email"
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                        disabled={invitation.isPending}
                        {...register("email")}
                    />
                </Field>
                <Field
                    id="invite-display-name"
                    label={t("displayName")}
                    error={Boolean(errors.display_name)}
                    hint={t("inviteNameHint")}
                >
                    <input
                        id="invite-display-name"
                        autoComplete="name"
                        maxLength={120}
                        disabled={invitation.isPending}
                        {...register("display_name")}
                    />
                </Field>
            </div>
            {allRoles && (
                <>
                    <Field id="invite-role" label={accountText("role")}>
                        <select
                            id="invite-role"
                            {...register("role")}
                            disabled={
                                invitation.isPending || catalog.isPending || catalog.isError
                            }
                        >
                            {availableRoles.map(({role}) => (
                                <option value={role} key={role}>
                                    {accountText(role)}
                                </option>
                            ))}
                        </select>
                    </Field>
                    {catalog.isError && (
                        <Notice kind="error">{accountText("error")}</Notice>
                    )}
                    {watched.role === "client" && !canLinkOrganisations && (
                        <Notice>{accountText("organisationAdmin")}</Notice>
                    )}
                    {watched.role === "client" && canLinkOrganisations && (
                        <Field
                            id="invite-organisation"
                            label={accountText("organisation")}
                            hint={accountText("organisationHint")}
                        >
                            <select
                                id="invite-organisation"
                                {...register("organisation_id")}
                                disabled={
                                    invitation.isPending ||
                                    organisations.isPending ||
                                    organisations.isError
                                }
                            >
                                <option value="">{accountText("choose")}</option>
                                {organisations.data?.map((org) => (
                                    <option value={org.id} key={org.id}>
                                        {org.name}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    )}
                    {watched.role === "client" &&
                        canLinkOrganisations &&
                        organisations.isError && (
                            <Notice kind="error">{accountText("error")}</Notice>
                        )}
                </>
            )}
            <Button
                disabled={
                    !online ||
                    invitation.isPending ||
                    Boolean(sent) ||
                    (allRoles &&
                        (catalog.isPending ||
                            catalog.isError ||
                            !availableRoles.some((entry) => entry.role === watched.role))) ||
                    (allRoles &&
                        canAssignRoles &&
                        (clientAccess.isPending || clientAccess.isError))
                }
            >
                {t(invitation.isPending ? "inviteSending" : "inviteSend")}
            </Button>
            {Object.keys(errors).length > 0 && (
                <Notice kind="error">{t("invalidForm")}</Notice>
            )}
            {result && (
                <Notice kind={sent ? "success" : "error"}>
                    {allRoles && sent
                        ? accountText(
                            result.status === "sent" ? "invited" : "alreadyInvited",
                        )
                        : t(`invite_${result.status}`)}
                </Notice>
            )}
            {sameRequest && invitation.isError && (
                <Notice kind="error">
                    {t(online ? "invite_unavailable" : "offline")}
                </Notice>
            )}
        </form>
    );
}