/** Local fictional-account bootstrap policy. Never use for hosted or customer accounts. */
import {privateWrite} from "./runtime-lib.mjs";

/** Stable password for the explicitly fictional loopback test accounts only. */
export const LOCAL_TEST_DEFAULT_PASSWORD =
    "Local!2668646243648f005c40750171d700f7ebeb732eAa9";

/** Retain a saved password; only choose the local default for a verified empty Auth instance. */
export function localBootstrapPassword(savedPassword, accountCount) {
    if (accountCount === 0) return LOCAL_TEST_DEFAULT_PASSWORD;
    return savedPassword || undefined;
}

/** Inspect the active local Auth instance on every startup, independent of stale marker files. */
export async function ensureLocalAccounts({
                                              apiUrl,
                                              serviceRoleKey,
                                              projectId,
                                              markerPath,
                                              seed,
                                              log,
                                              request = fetch,
                                              write = privateWrite,
                                              now = () => new Date().toISOString(),
                                          }) {
    const response = await request(
        `${apiUrl}/auth/v1/admin/users?page=1&per_page=1`,
        {
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
            },
        },
    );
    if (!response.ok) throw new Error("Could not check local accounts.");
    const accounts = await response.json();
    const existingDataPreserved = Boolean(accounts.users?.length);
    if (!existingDataPreserved) {
        log("Initialising eleven fictional lecturers and local sample data …");
        await seed();
    }
    write(
        markerPath,
        JSON.stringify({
            projectId,
            createdAt: now(),
            existingDataPreserved,
        }) + "\n",
    );
    return {seeded: !existingDataPreserved, existingDataPreserved};
}