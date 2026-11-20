/**
 * Executes a previously confirmed, database-owned deletion operation. The browser
 * supplies only an operation ID; manifests and native identities come from a
 * service-only RPC after a fresh caller-scoped execution permit. External errors
 * leave the irreversible operation retryable and never imply completion.
 */
export interface DeletionResult {
    operation_id: string;
    status: "pending" | "failed" | "completed";
    kind: string;
    id: string;
}

/** Exact immutable-version objects, never an uploader prefix or a client path. */
export interface DeletionWork extends DeletionResult {
    objects: { bucket: "portal-clean" | "portal-quarantine"; path: string }[];
    auth_user_id: string | null;
    pending_uploads: number;
}

/** Server-only adapters keep native credentials outside the testable orchestrator. */
export interface DeletionDependencies {
    authorize: (token: string, operationId: string) => Promise<string>;
    work: (operationId: string, permitId: string) => Promise<DeletionWork>;
    removeObject: (bucket: string, path: string) => Promise<void>;
    objectAbsent: (bucket: string, path: string) => Promise<boolean>;
    apply: (operationId: string, permitId: string) => Promise<void>;
    deleteAuthUser: (userId: string) => Promise<void>;
    authUserAbsent: (userId: string) => Promise<boolean>;
    complete: (operationId: string, permitId: string) => Promise<DeletionResult>;
}

/**
 * Reacquire authority before every privileged phase. A membership/role change
 * during Storage I/O must stop the remaining work, even with an unexpired JWT.
 * An active upload lease is a hard barrier, not a timeout that can be ignored.
 */
export async function executeDeletion(
    token: string,
    operationId: string,
    deps: DeletionDependencies,
): Promise<DeletionResult> {
    let permit = await deps.authorize(token, operationId);
    const work = await deps.work(operationId, permit);
    const result: DeletionResult = {
        operation_id: work.operation_id,
        status: work.status,
        kind: work.kind,
        id: work.id,
    };
    if (work.status === "completed") return result;
    if (!Number.isInteger(work.pending_uploads) || work.pending_uploads < 0) {
        throw new Error("deletion_unavailable");
    }
    if (work.pending_uploads > 0) return {...result, status: "pending"};
    for (const object of work.objects) {
        if (
            !["portal-clean", "portal-quarantine"].includes(object.bucket) ||
            !object.path || object.path.startsWith("/") ||
            object.path.split("/").some((part) => part === "..")
        ) throw new Error("deletion_unavailable");
        permit = await deps.authorize(token, operationId);
        await deps.removeObject(object.bucket, object.path);
        if (!(await deps.objectAbsent(object.bucket, object.path))) {
            throw new Error("deletion_unavailable");
        }
    }
    permit = await deps.authorize(token, operationId);
    await deps.apply(operationId, permit);
    if (work.auth_user_id) {
        permit = await deps.authorize(token, operationId);
        // Native hard deletion is deliberately separate from ordinary row cleanup.
        // A retry may encounter an already removed identity; it must verify absence.
        if (!(await deps.authUserAbsent(work.auth_user_id))) {
            await deps.deleteAuthUser(work.auth_user_id);
        }
        if (!(await deps.authUserAbsent(work.auth_user_id))) {
            throw new Error("deletion_unavailable");
        }
    }
    permit = await deps.authorize(token, operationId);
    return await deps.complete(operationId, permit);
}