/** Explicit recovery of the fictional admin in an owned, local runtime. */
import {randomBytes} from "node:crypto";
import {join} from "node:path";
import {createClient} from "@supabase/supabase-js";
import {localUrl, privateDirectory, privateWrite, processIsOurs, projectConfig, readEnvFile, readState, runtimeDir,} from "./runtime-lib.mjs";
import {verifyLoopbackBindings} from "./runtime-network.mjs";

export async function resetLocalDemoAdmin() {
    const state = readState();
    const config = projectConfig();
    if (
        !processIsOurs(state) ||
        state.phase !== "ready" ||
        state.projectId !== config.id
    )
        throw new Error(
            "Zuerst das eigene lokale Portal mit ./portal start starten.",
        );
    await verifyLoopbackBindings(config.id, {scanner: true, edge: true});
    const env = readEnvFile(".env.test.local");
    const url = localUrl(env.SUPABASE_URL, "Supabase URL");
    if (
        Number(url.port) !== config.api ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        !env.SUPABASE_SERVICE_ROLE_KEY ||
        !env.SUPABASE_ANON_KEY
    )
        throw new Error(
            "Die lokale Auth-Konfiguration stimmt nicht mit diesem Portal überein.",
        );
    const options = {auth: {persistSession: false, autoRefreshToken: false}};
    const admin = createClient(url.href, env.SUPABASE_SERVICE_ROLE_KEY, options);
    const matches = [];
    for (let page = 1; page <= 100; page++) {
        const {data, error} = await admin.auth.admin.listUsers({
            page,
            perPage: 200,
        });
        if (error) throw new Error("Lokale Konten konnten nicht gelesen werden.");
        matches.push(
            ...data.users.filter((user) => user.email === "admin@example.invalid"),
        );
        if (data.users.length < 200) break;
        if (page === 100) throw new Error("Zu viele lokale Konten.");
    }
    if (matches.length !== 1)
        throw new Error(
            "Das lokale Admin-Demokonto wurde nicht eindeutig gefunden.",
        );
    const id = matches[0].id;
    const {data: roles, error: roleError} = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", id)
        .eq("role", "admin");
    if (roleError || roles.length !== 1)
        throw new Error("Die Admin-Rolle des Demokontos fehlt.");
    const password = `Demo!${randomBytes(8).toString("hex")}Aa9`;
    const {error} = await admin.auth.admin.updateUserById(id, {password});
    if (error)
        throw new Error("Das lokale Passwort konnte nicht geändert werden.");
    const user = createClient(url.href, env.SUPABASE_ANON_KEY, options);
    const login = await user.auth.signInWithPassword({
        email: "admin@example.invalid",
        password,
    });
    if (login.error || login.data.user?.id !== id)
        throw new Error(
            "Passwort geändert, Anmeldung konnte nicht bestätigt werden. Erneut ausführen.",
        );
    privateDirectory();
    privateWrite(
        join(runtimeDir, "ADMIN-DEMO.txt"),
        `Lokales Admin-Demokonto – vertraulich\nE-Mail: admin@example.invalid\nPasswort: ${password}\nNur für dieses lokale Demo. Ein später selbst geändertes Passwort steht hier nicht.\n`,
    );
    console.log(
        "Lokales Admin-Passwort neu gesetzt und Anmeldung bestätigt. Anzeigen mit ./portal credentials",
    );
}