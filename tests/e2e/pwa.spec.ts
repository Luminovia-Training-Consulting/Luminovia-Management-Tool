/**
 * Browser checks for the built public offline shell without private API caches.
 * Chromium covers authenticated offline use. The explicit WebKit lane checks
 * a cold worker installation, offline navigation and native push refusal.
 */
import {expect, test, type Page} from "@playwright/test";
import {createECDH, randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.E2E_PWA !== "1",
    "Run against a built preview with E2E_PWA=1 and E2E_BASE_URL.",
);

async function controlWithBuiltWorker(page: Page) {
    await expect.poll(() => page.evaluate(async () => {
        const worker = (await navigator.serviceWorker.getRegistration())?.active;
        return worker?.state === "activated" && new URL(worker.scriptURL).pathname;
    }), {timeout: 20_000}).toBe("/sw.js");
    await page.reload();
    await expect.poll(() => page.evaluate(() => {
        const controller = navigator.serviceWorker.controller;
        return controller && new URL(controller.scriptURL).pathname;
    })).toBe("/sw.js");
}

test("built PWA WebKit activates the app worker and serves an offline deep link", {tag: "@pwa-webkit"}, async ({
    page,
    context,
}) => {
    await page.goto("/login");
    await expect(page.locator("#email")).toBeVisible();
    await controlWithBuiltWorker(page);
    const cachedPaths = await page.evaluate(async () => {
        const names = await caches.keys();
        const entries = await Promise.all(names.map(async (name) =>
            (await (await caches.open(name)).keys()).map(({url}) => new URL(url).pathname),
        ));
        return entries.flat();
    });
    expect(cachedPaths).toContain("/index.html");
    expect(cachedPaths.filter((path) => /^\/(?:backend|auth|rest|storage|functions|realtime)\//.test(path))).toEqual([]);

    await context.setOffline(true);
    try {
        const response = await page.goto("/help?topic=profile");
        expect(response?.status()).toBe(200);
        expect(response?.fromServiceWorker()).toBe(true);
        await expect(page.locator("#help-title")).toBeVisible();
        await expect(
            page.getByRole("heading", {level: 2, name: /^(Mein Profil|My profile)$/}),
        ).toBeVisible();
        const privateReply = await page.evaluate(async () => {
            try {
                await fetch("/rest/v1/rpc/my_push_devices", {method: "POST"});
                return "unexpected response";
            } catch {
                return "network unavailable";
            }
        });
        expect(privateReply).toBe("network unavailable");
    } finally {
        await context.setOffline(false);
    }
});

test("built PWA WebKit refuses notification permission without registering a device", {tag: "@pwa-webkit"}, async ({page}) => {
    const lecturer = await actor("Fictional WebKit push lecturer", "lecturer");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const viewer = api(process.env.SUPABASE_ANON_KEY!);
    try {
        await checked(viewer.auth.signInWithPassword({
            email: lecturer.email,
            password: process.env.E2E_PASSWORD!,
        }), {requireData: true});
        const previous = await checked(viewer.rpc("my_push_devices"), {requireData: true});
        const key = previous.public_key ?? createECDH("prime256v1").generateKeys().toString("base64url");
        await checked(service.rpc("configure_web_push", {p_public_key: key, p_enabled: true}));
        try {
            await page.addInitScript(() => {
                const requestPermission = Notification.requestPermission.bind(Notification);
                Notification.requestPermission = async () => {
                    const decision = await requestPermission();
                    document.documentElement.setAttribute("data-push-decision", decision);
                    return decision;
                };
            });
            await page.goto("/login");
            await controlWithBuiltWorker(page);
            await login(page, lecturer.email);
            const registrations: string[] = [];
            page.on("request", (request) => {
                if (new URL(request.url()).pathname.endsWith("/rpc/register_push_device"))
                    registrations.push(request.method());
            });
            await page.goto("/settings");
            const delivery = page.locator("details.settings-section").filter({
                hasText: /Ruhezeiten & Zustellung|Quiet hours & delivery/,
            });
            await delivery.locator("summary").press("Enter");
            await expect(delivery).toHaveJSProperty("open", true);
            const enable = page.getByRole("button", {name: /Push auf diesem Gerät aktivieren|Enable push on this device/});
            await expect(enable).toBeEnabled();
            await enable.click();
            await expect(page.locator("html")).toHaveAttribute("data-push-decision", "denied");
            await expect(page.getByText(/Push konnte nicht geändert werden|Push could not be changed/)).toBeVisible();
            expect(registrations).toEqual([]);
            const devices = await checked(viewer.rpc("my_push_devices"), {requireData: true});
            expect(devices.devices).toEqual([]);
        } finally {
            await checked(service.rpc("configure_web_push", {p_public_key: previous.public_key ?? key, p_enabled: previous.enabled}));
        }
    } finally {
        await checked(service.auth.admin.deleteUser(lecturer.id));
    }
});

async function openControlledPwa(page: Page) {
    await page.goto("/login");
    await controlWithBuiltWorker(page);
}

test("built PWA serves a public help deep link offline without a session", async ({page, context}) => {
    await openControlledPwa(page);
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
    await context.setOffline(true);
    try {
        await page.goto("/help?topic=profile");
        await expect(page.getByRole("heading", {name: "Hilfe & Anleitungen", exact: true})).toBeVisible();
        await expect(page.getByRole("status").filter({hasText: "Du bist offline"})).toBeVisible();
        // The worker must not answer the retired bookmark with its cached shell.
        await expect(page.goto("/demo?retired=1")).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
    } finally {
        await context.setOffline(false);
    }
});

test("built PWA registers its shell, supports offline deep links and never caches private API responses", async ({page, context}) => {
    await openControlledPwa(page);
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
