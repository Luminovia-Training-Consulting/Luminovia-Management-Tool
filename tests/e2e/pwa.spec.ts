/**
 * Browser checks for the built public offline shell without private API caches.
 * Service-worker behaviour is exercised in Chromium; physical PWA installation remains separate acceptance.
 */
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.E2E_PWA !== "1",
    "Run against a built preview with E2E_PWA=1 and E2E_BASE_URL.",
);

test("built PWA registers its shell, supports offline deep links and never caches private API responses", async ({
                                                                                                                     page,
                                                                                                                     context,
                                                                                                                 }) => {
    await page.goto("/login");
    const manifest = await page.evaluate(async () => {
        const href = document.querySelector<HTMLLinkElement>(
            'link[rel="manifest"]',
        )!.href;
        return await (await fetch(href)).json();
    });
    expect(manifest.name).toBe("Luminovia Portal");
    expect(manifest.display).toBe("standalone");
    expect(
        manifest.icons.some(
            (icon: { sizes: string; purpose?: string }) =>
                icon.sizes === "512x512" && icon.purpose === "maskable",
        ),
    ).toBe(true);
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
        .poll(() =>
            page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        )
        .toBe(true);
    // Authenticated application tests may persist a different locale for the
    // shared seed user. This PWA check owns one account and its default locale.
    const lecturer = await actor("Fictional PWA shell lecturer", "lecturer");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    try {
        await login(page, lecturer.email);
        await page.goto("/jobs");
        await expect(
            page.getByRole("heading", {name: "Aufträge finden", exact: true}),
        ).toBeVisible();
        const cachedUrls = await page.evaluate(async () => {
            const names = await caches.keys();
            return (
                await Promise.all(
                    names.map(async (name) =>
                        (await (await caches.open(name)).keys()).map(
                            (request) => request.url,
                        ),
                    ),
                )
            ).flat();
        });
        expect(cachedUrls.length).toBeGreaterThan(0);
        for (const url of cachedUrls) {
            expect(new URL(url).origin).toBe(new URL(page.url()).origin);
            expect(new URL(url).pathname).not.toMatch(
                /^\/(rest|storage|functions|auth)\//,
            );
        }
        await context.setOffline(true);
        await page.reload();
        await expect(
            page.getByRole("status").filter({hasText: "Du bist offline"}),
        ).toBeVisible();
        const apiTab = await context.newPage();
        try {
            for (const path of ["/functions/v1/files", "/realtime/v1/websocket"])
                await expect(apiTab.goto(path)).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
        } finally {
            await apiTab.close();
        }
        const offlineCachedUrls = await page.evaluate(async () => {
            return (
                await Promise.all(
                    (await caches.keys()).map(async (name) =>
                        (await (await caches.open(name)).keys()).map(
                            (request) => request.url,
                        ),
                    ),
                )
            ).flat();
        });
        expect(offlineCachedUrls).toEqual(cachedUrls);
        await context.setOffline(false);
    } finally {
        await context.setOffline(false);
        await checked(service.auth.admin.deleteUser(lecturer.id));
    }
});

test("built PWA cold offline page reads only its opted-in schedule and purges it across logout/account changes", async ({
                                                                                                                            page,
                                                                                                                            context,
                                                                                                                        }) => {
    test.setTimeout(90000);
    const owner = await actor("Fictional cold offline teacher", "lecturer"),
        peer = await actor("Fictional cold offline peer", "lecturer");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const job = randomUUID(),
        claim = randomUUID(),
        assignment = randomUUID(),
        privateEvent = randomUUID();
    let current = page;
    const starts = new Date(Date.now() + 2 * 86400000).toISOString(),
        ends = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString();
    // Keep a real private event inside the export horizon, on a separate day.
    // The production calendar guard correctly rejects an assignment overlap.
    const privateStarts = new Date(Date.now() + 4 * 86400000).toISOString(),
        privateEnds = new Date(Date.now() + 4 * 86400000 + 3600000).toISOString();
    // Read the actual dedicated IDB store without retaining any Auth tokens or
    // introducing a browser-only assignment confirmation in the fixture.
    const snapshot = () =>
        current.evaluate(
            () =>
                new Promise<unknown>((resolve, reject) => {
                    const open = indexedDB.open("luminovia-offline-schedule", 1);
                    open.onerror = reject;
                    open.onsuccess = () => {
                        const db = open.result,
                            request = db
                                .transaction("snapshot")
                                .objectStore("snapshot")
                                .get("current");
                        request.onsuccess = () => {
                            db.close();
                            resolve(request.result);
                        };
                        request.onerror = reject;
                    };
                }),
        );
    const cacheUrls = () =>
        current.evaluate(async () =>
            (
                await Promise.all(
                    (await caches.keys()).map(async (name) =>
                        (await (await caches.open(name)).keys()).map(
                            (request) => request.url,
                        ),
                    ),
                )
            )
                .flat()
                .sort(),
        );
    try {
        await checked(
            service.from("jobs").insert({
                id: job,
                title: "Fictional cold offline teaching",
                customer_name: "PRIVATE CUSTOMER",
                delivery_type: "online",
                status: "filled",
                time_zone: "Australia/Brisbane",
                location: "https://private.invalid/class",
                amount: 321,
                currency: "EUR",
                rate_unit: "fixed_total",
                total_amount: 321,
                terms: "PRIVATE TERMS",
            }),
        );
        await checked(
            service.from("job_claims").insert({
                id: claim,
                job_id: job,
                lecturer_id: owner.id,
                idempotency_key: randomUUID(),
                amount: 321,
                currency: "EUR",
                rate_unit: "fixed_total",
                total_amount: 321,
                terms: "PRIVATE TERMS",
                terms_version: 1,
            }),
        );
        await checked(
            service.from("assignment_sessions").insert({
                id: assignment,
                claim_id: claim,
                lecturer_id: owner.id,
                starts_at: starts,
                ends_at: ends,
            }),
        );
        await checked(
            service.from("personal_events").insert({
                id: privateEvent,
                user_id: owner.id,
                title: "PRIVATE APPOINTMENT",
                starts_at: privateStarts,
                ends_at: privateEnds,
                time_zone: "Europe/Berlin",
            }),
        );
        await current.goto("/login");
        await current.evaluate(async () => {
            await navigator.serviceWorker.ready;
        });
        await current.reload();
        await expect
            .poll(() =>
                current.evaluate(() => Boolean(navigator.serviceWorker.controller)),
            )
            .toBe(true);
        await login(current, owner.email);
        await current.goto("/calendar");
        await current.getByText("Kalenderfunktionen", {exact: true}).click();
        await current
            .getByText("Unterrichtsplan offline bereithalten", {exact: true})
            .click();
        await current
            .getByRole("button", {
                name: "Unterrichtsplan für offline speichern",
                exact: true,
            })
            .click();
        await expect(
            current.getByText("Die reduzierte Offline-Vorschau wurde gespeichert.", {
                exact: true,
            }),
        ).toBeVisible();
        expect(JSON.stringify(await snapshot())).not.toContain("PRIVATE");
        const before = await cacheUrls();
        for (const value of before) {
            expect(new URL(value).origin).toBe(new URL(current.url()).origin);
            expect(new URL(value).pathname).not.toMatch(
                /^\/(?:backend|rest|auth|storage|functions)\//,
            );
        }
        // Closing the page destroys React/TanStack memory. A fresh offline page must
        // boot from the actual registered service worker and retained SDK session.
        await context.setOffline(true);
        await current.close();
        current = await context.newPage();
        await current.goto("/calendar");
        await expect(
            current.getByText(/aktuelles Profil kann nicht geprüft werden/),
        ).toBeVisible();
        await expect(
            current.getByText("Fictional cold offline teaching", {exact: true}),
        ).toBeVisible();
        await expect(current.getByText(/Australia\/Brisbane/)).toBeVisible();
        await expect(current.getByText(/Gespeichert am/)).toContainText("UTC");
        await expect(
            current.getByRole("button", {
                name: "Unterrichtsplan für offline speichern",
                exact: true,
            }),
        ).toHaveCount(0);
        await expect(current.locator("main").getByRole("link")).toHaveCount(0);
        expect(await cacheUrls()).toEqual(before);
        await context.setOffline(false);
        await expect(
            current.getByText("Kalenderfunktionen", {exact: true}),
        ).toBeVisible();
        await current.getByText("Kalenderfunktionen", {exact: true}).click();
        await expect(
            current.getByText("Kalender abonnieren", {exact: true}),
        ).toBeVisible();
        await current
            .getByRole("button", {name: "Abmelden", exact: true})
            .click();
        await expect(current).toHaveURL(/\/login$/);
        await expect.poll(async () => Boolean(await snapshot())).toBe(false);
        await login(current, peer.email);
        await current.goto("/calendar");
        await context.setOffline(true);
        await current.close();
        current = await context.newPage();
        await current.goto("/calendar");
        await expect(
            current.getByText(
                "Auf diesem Gerät ist keine gültige Offline-Vorschau für dein Konto gespeichert.",
                {exact: true},
            ),
        ).toBeVisible();
        await expect(
            current.getByText("Fictional cold offline teaching", {exact: true}),
        ).toHaveCount(0);
        expect(await snapshot()).toBeUndefined();
    } finally {
        await context.setOffline(false);
        for (const user of [owner, peer])
            await checked(
                service.from("notifications").delete().eq("user_id", user.id),
            );
        await checked(
            service.from("personal_events").delete().eq("id", privateEvent),
        );
        await checked(
            service.from("assignment_sessions").delete().eq("id", assignment),
        );
        await checked(service.from("job_claims").delete().eq("id", claim));
        await checked(service.from("jobs").delete().eq("id", job));
        for (const user of [owner, peer]) {
            await checked(
                service.from("audit_events").delete().eq("actor_id", user.id),
            );
            await checked(service.auth.admin.deleteUser(user.id));
        }
    }
});
