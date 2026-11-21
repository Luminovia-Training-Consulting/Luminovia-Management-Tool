/**
 * Deno account API connecting the handler to native Auth, caller-scoped RPCs,
 * reserved invitations and database-confirmed permanent deletion operations.
 */
import {createClient} from "npm:@supabase/supabase-js@2.119.0";
import {createAccountHandler} from "./handler.ts";
import {accountOpenApi} from "./openapi.ts";
import {type DeletionResult, type DeletionWork, executeDeletion,} from "./deletion-worker.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const service = createClient(
    url,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {auth: {persistSession: false, autoRefreshToken: false}},
);
// Create a stateless client per caller JWT so ordinary business operations retain that caller's current database permissions.
const caller = (token: string) =>
    createClient(url, publicKey, {
        global: {headers: {Authorization: `Bearer ${token}`}},
        auth: {persistSession: false, autoRefreshToken: false},
    });
const origins = (Deno.env.get("PORTAL_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
const appOrigin = Deno.env.get("PORTAL_APP_ORIGIN") ?? "";

/** Never leak provider errors, tokens, paths or private SQL details over HTTP. */
function deletionError(error: { code?: string } | null): void {
    if (error) {
        throw new Error(
            error.code === "42501"
                ? "permission_required"
                : ["23503", "40001", "P0001"].includes(error.code ?? "")
                    ? "deletion_conflict"
                    : "deletion_unavailable",
        );
    }
}

/** Service execution accepts only an opaque permit issued under a current JWT. */
const deletionArgs = (operationId: string, permitId: string) => ({
    p_operation_id: operationId,
    p_permit_id: permitId,
});
Deno.serve(
    createAccountHandler({
        origins,
        appOrigin,
        openapi: accountOpenApi,
        canPublishOpenApi: async () => {
            // The static internal facade description is itself edition scoped.
            // Consult the trusted bootstrap read rather than a build variable.
            const result = await service.rpc("installation_capabilities")
                .abortSignal(AbortSignal.timeout(3000));
            if (result.error || typeof result.data?.edition !== "string") {
                throw new Error("installation_unavailable");
            }
            return result.data.edition === "internal";
        },
        invitationsEnabled:
            Deno.env.get("PORTAL_INVITES_ENABLED") === "true" &&
            origins.includes(appOrigin),
        authenticateAcademy: async (token) => {
            const user = await caller(token).auth.getUser(token);
            return !user.error && Boolean(user.data.user);
        },
        resolveAcademyActor: async (token) => {
            const user = await caller(token).auth.getUser(token);
            return user.error ? null : user.data.user?.id ?? null;
        },
        authenticate: async (token) => {
            const client = caller(token);
            const user = await client.auth.getUser(token);
            if (user.error || !user.data.user) return false;
            const active = await client.rpc("account_me");
            return !active.error;
        },
        rpc: async (token, name, args) => {
            const result = await caller(token).rpc(name, args);
            return {data: result.data, error: result.error};
        },
        privilegedRpc: async (name, args) => {
            const result = await service.rpc(name, args);
            return {data: result.data, error: result.error};
        },
        executeDeletion: (token, operationId) =>
            executeDeletion(token, operationId, {
                authorize: async (jwt, id) => {
                    const result = await caller(jwt).rpc("deletion_execution", {
                        p_operation_id: id,
                    });
                    deletionError(result.error);
                    if (!result.data || typeof result.data.permit_id !== "string") {
                        throw new Error("deletion_unavailable");
                    }
                    return result.data.permit_id;
                },
                work: async (id, permit) => {
                    const result = await service.rpc(
                        "_deletion_work",
                        deletionArgs(id, permit),
                    );
                    deletionError(result.error);
                    return result.data as DeletionWork;
                },
                removeObject: async (bucket, path) => {
                    const result = await service.storage.from(bucket).remove([path]);
                    if (result.error) throw new Error("deletion_unavailable");
                },
                objectAbsent: async (bucket, path) => {
                    const result = await service.storage.from(bucket).info(path);
                    if (!result.error) return false;
                    // Authentication, missing buckets and network failures are never absence.
                    if ("code" in result.error && result.error.code === "NoSuchKey") {
                        return true;
                    }
                    throw new Error("deletion_unavailable");
                },
                apply: async (id, permit) => {
                    const result = await service.rpc(
                        "_deletion_apply",
                        deletionArgs(id, permit),
                    );
                    deletionError(result.error);
                },
                deleteAuthUser: async (id) => {
                    const result = await service.auth.admin.deleteUser(id, false);
                    if (result.error && result.error.code !== "user_not_found") {
                        throw new Error("deletion_unavailable");
                    }
                },
                authUserAbsent: async (id) => {
                    const result = await service.auth.admin.getUserById(id);
                    if (result.error?.code === "user_not_found") return true;
                    if (result.error) throw new Error("deletion_unavailable");
                    return false;
                },
                complete: async (id, permit) => {
                    const result = await service.rpc("_deletion_complete", {
                        ...deletionArgs(id, permit),
                        p_storage_removed: true,
                        p_auth_removed: true,
                    });
                    deletionError(result.error);
                    return result.data as DeletionResult;
                },
            }),
        createAccount: async (account) => {
            const result = await service.auth.admin.createUser({
                email: account.email,
                password: account.password,
                email_confirm: true,
                app_metadata: {portal_temporary_password: true},
            });
            if (result.error || !result.data.user) throw new Error("creation_failed");
            return result.data.user.id;
        },
        completeAccount: async (id, userId, success) => {
            const result = await service.rpc("complete_account_creation", {
                p_creation_id: id,
                p_user_id: userId,
                p_success: success,
            });
            if (result.error) throw new Error("creation_failed");
        },
        removeCreatedAccount: async (id) => {
            const result = await service.auth.admin.deleteUser(id);
            if (result.error) throw new Error("creation_cleanup_failed");
        },
        sendInvitation: async (invitation, redirectTo) => {
            const username = "member-" + crypto.randomUUID().replaceAll("-", "").slice(0, 24);
            const result = await service.auth.admin.inviteUserByEmail(
                invitation.email,
                {redirectTo, data: {portal_invitation_username: username}},
            );
            if (result.error || !result.data.user) {
                throw new Error("invitation_unavailable");
            }
            return result.data.user.id;
        },
        completeInvitation: async (id, userId, displayName, success) => {
            const result = await service.rpc("complete_account_invitation", {
                p_invitation_id: id,
                p_user_id: userId,
                p_display_name: displayName,
                p_success: success,
            });
            if (result.error) throw new Error("invitation_unavailable");
        },
    }),
);
