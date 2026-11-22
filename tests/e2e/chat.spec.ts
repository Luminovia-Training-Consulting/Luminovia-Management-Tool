/**
 * Browser workflows for real private messages and membership revocation in already-connected sessions.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {type BrowserContext, expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";

const isolated = process.env.PORTAL_TEST_MODE === "1";
test.skip(
    !isolated,
    "Chat journeys mutate only the isolated ./portal test environment.",
);

/** Creates a local SDK test client with its own nonpersistent Auth session. */
function localClient(key: string) {
    const url = process.env.SUPABASE_URL!;
    if (
        !url ||
        !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
    )
        throw new Error("Chat fixtures require an isolated loopback backend.");
    return createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
}

/** Creates the administrative fixture client; its key stays outside the browser application. */
const service = () => localClient(process.env.SUPABASE_SERVICE_ROLE_KEY!);

interface Account {
    id: string;
    email: string;
    name: string;
}

/** Creates a fictional actor for separate browser/API sessions and later scoped cleanup. */
async function account(label: string): Promise<Account> {
    const tag = randomUUID().slice(0, 8);
    const email = `chat-${label}-${tag}@example.invalid`;
    const name = `Chat QA ${label} ${tag}`;
    const {data, error} = await service().auth.admin.createUser({
        email,
        password: process.env.E2E_PASSWORD!,
        email_confirm: true,
    });
    expect(error).toBeNull();
    const id = data.user!.id;
    const profile = await service()
        .from("profiles")
        .update({display_name: name})
        .eq("id", id);
    expect(profile.error).toBeNull();
    const role = await service()
        .from("user_roles")
        .insert({user_id: id, role: "lecturer"});
    expect(role.error).toBeNull();
    return {id, email, name};
}

/** Signs this test actor in through the visible form and waits for confirmed navigation. */
async function login(page: Page, user: Account) {
    await page.goto("/login");
    await page.getByLabel("Benutzername oder E-Mail", {exact: true}).fill(user.email);
    await page
        .getByLabel("Passwort", {exact: true})
        .fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", {name: "Anmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/chats");
    await expect(
        page.getByRole("heading", {name: "Chats", exact: true}),
    ).toBeVisible();
}

/** Checks the rendered state with axe; this does not replace manual accessibility acceptance. */
async function a11y(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        "Populated chat must fit the viewport without horizontal page scrolling.",
    ).toBe(false);
    const scan = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        scan.violations.map((item) => ({
            id: item.id,
            nodes: item.nodes.map((node) => ({
                target: node.target,
                summary: node.failureSummary,
            })),
        })),
    ).toEqual([]);
}

/** Waits for observable Realtime connection readiness before testing actual message delivery. */
async function connected(page: Page) {
    await expect(page.locator("[data-realtime-status]")).toHaveAttribute(
        "data-realtime-status",
        "connected",
        {timeout: 20_000},
    );
}

/** Sends text through the visible composer and waits for its confirmed UI result. */
async function send(page: Page, body: string) {
    await page.getByLabel("Deine Nachricht", {exact: true}).fill(body);
    await page
        .getByRole("button", {name: "Nachricht senden", exact: true})
        .click();
    await expect(page.getByText(body, {exact: true})).toBeVisible();
}

/** Opens another page in the explicitly supplied browser context for this test identity. */
async function secondPage(context: BrowserContext, user: Account) {
    const page = await context.newPage();
    await login(page, user);
    return page;
}

test("real private DM persists, delivers realtime, edits/deletes safely and denies a third lecturer", async ({
                                                                                                                 browser,
                                                                                                                 page,
                                                                                                             }, testInfo) => {
    test.setTimeout(100_000);
    const a = await account("Alex");
    const b = await account("Bela");
    const stranger = await account("Caro");
    const otherContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
    });
    try {
        await login(page, a);
        const receiver = await secondPage(otherContext, b);
        await page
            .getByRole("button", {name: "Neue Nachricht", exact: true})
            .click();
        await page.getByLabel("Person suchen", {exact: true}).fill(b.name);
        await page
            .getByRole("button", {
                name: `${b.name} eine Nachricht schreiben`,
                exact: true,
            })
            .click();
        await connected(page);
        const initial = `Hallo ${b.name}, dies ist eine echte private Nachricht.`;
        await send(page, initial);
        await receiver.getByLabel("Filtern nach", { exact: true }).selectOption("lecturer");
        const lecturerFilter = receiver.getByLabel("Dozierende auswählen", { exact: true });
        await lecturerFilter.selectOption({ label: a.name });
        await receiver
            .locator(".chat-room-row")
            .filter({hasText: a.name})
            .locator(".chat-room-button")
            .click();
        await expect(receiver.getByText(initial, {exact: true})).toBeVisible();
        await connected(receiver);
        const text = `Realtime ${randomUUID().slice(0, 8)} <script>alert(1)</script>`;
        await send(page, text);
        await expect(receiver.getByText(text, {exact: true})).toBeVisible({
            timeout: 5000,
        });
        expect(await receiver.locator(".chat-message-body script").count()).toBe(0);
        const messageRow = page.locator(".chat-message").filter({hasText: text});
        await page
            .context()
            .grantPermissions(["clipboard-read", "clipboard-write"]);
        await messageRow
            .getByRole("button", {name: "Nachrichtentext kopieren", exact: true})
            .click();
        await expect(messageRow.getByRole("status")).toHaveText(
            "Nachrichtentext kopiert.",
        );
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
            text,
        );
        await messageRow.getByLabel("Reaktionen", {exact: true}).last().click();
        await messageRow
            .getByRole("button", {name: "👍 hinzufügen", exact: true})
            .click();
        await expect(
            messageRow.getByRole("button", {name: /👍 1/}),
        ).toBeVisible();
        await messageRow
            .getByRole("button", {name: "Nachricht bearbeiten", exact: true})
            .click();
        const edited = `Bearbeitet ${randomUUID().slice(0, 8)}`;
        await page
            .getByRole("dialog")
            .getByLabel("Deine Nachricht", {exact: true})
            .fill(edited);
        await page
            .getByRole("dialog")
            .getByRole("button", {name: "Speichern", exact: true})
            .click();
        await expect(receiver.getByText(edited, {exact: true})).toBeVisible({
            timeout: 5000,
        });
        const editedRow = page.locator(".chat-message").filter({hasText: edited});
        await editedRow
            .getByRole("button", {name: "Nachricht löschen", exact: true})
            .click();
        await page
            .getByRole("dialog")
            .getByRole("button", {name: "Nachricht löschen", exact: true})
            .click();
        await expect(
            receiver.getByText("Diese Nachricht wurde gelöscht.", {exact: true}),
        ).toBeVisible({timeout: 5000});
        await expect(receiver.getByText(edited, {exact: true})).toHaveCount(0);
        await receiver.reload();
        await expect(receiver.getByText(initial, {exact: true})).toBeVisible();
        await connected(receiver);
        const attachmentName = `Chatmaterial-${randomUUID().slice(0, 8)}.txt`;
        const attachmentBytes = Buffer.from(
            "Fictional private chat material. Local QA only.\n",
        );
        const picker = page.waitForEvent("filechooser");
        await page
            .getByRole("button", {name: "Datei anhängen", exact: true})
            .click();
        await (
            await picker
        ).setFiles({
            name: attachmentName,
            mimeType: "text/plain",
            buffer: attachmentBytes,
        });
        await expect(
            page
                .locator(".chat-draft-attachment")
                .getByText(attachmentName, {exact: true}),
        ).toBeVisible({timeout: 45000});
        await send(page, `Geprüftes Material ${randomUUID().slice(0, 8)}`);
        const attachment = receiver
            .locator(".document-attachment")
            .filter({hasText: attachmentName});
        await expect(attachment.getByText("Geprüft", {exact: true})).toBeVisible({
            timeout: 10000,
        });
        const received = receiver.waitForEvent("download");
        await attachment
            .getByRole("button", {
                name: `Herunterladen: ${attachmentName}`,
                exact: true,
            })
            .click();
        const downloaded = await received;
        expect(downloaded.suggestedFilename()).toBe(attachmentName);
        expect(await downloaded.failure()).toBeNull();
        expect(await readFile((await downloaded.path())!)).toEqual(attachmentBytes);
        const room = new URL(page.url()).searchParams.get("room");
        const strangerApi = localClient(process.env.SUPABASE_ANON_KEY!);
        expect(
            (
                await strangerApi.auth.signInWithPassword({
                    email: stranger.email,
                    password: process.env.E2E_PASSWORD!,
                })
            ).error,
        ).toBeNull();
        const denied = await strangerApi.rpc("chat_messages", {p_room_id: room});
        expect(denied.error).toBeTruthy();
        await a11y(receiver);
        await receiver.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-chat.png`,
            fullPage: true,
        });
    } finally {
        await otherContext.close();
    }
});

test("group owner removal revokes an already connected member and clears private history", async ({
                                                                                                      browser,
                                                                                                      page,
                                                                                                  }, testInfo) => {
    test.setTimeout(100_000);
    const owner = await account("Owner");
    const member = await account("Member");
    const memberContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
    });
    try {
        await login(page, owner);
        const other = await secondPage(memberContext, member);
        await page
            .getByRole("button", {name: "Gruppe erstellen", exact: true})
            .click();
        const title = `Gemeinsam lernen ${randomUUID().slice(0, 8)}`;
        await page.getByLabel("Gruppenname", {exact: true}).fill(title);
        await page
            .getByRole("checkbox", {name: member.name, exact: true})
            .check();
        await page
            .getByRole("dialog")
            .getByRole("button", {name: "Gruppe erstellen", exact: true})
            .click();
        await connected(page);
        await other
            .locator(".chat-room-row")
            .filter({hasText: title})
            .locator(".chat-room-button")
            .click();
        await connected(other);
        const before = `Gemeinsame Nachricht ${randomUUID().slice(0, 8)}`;
        await send(page, before);
        await expect(other.getByText(before, {exact: true})).toBeVisible({
            timeout: 5000,
        });
        const room = new URL(page.url()).searchParams.get("room");
        await page
            .getByRole("button", {name: "Mitglieder verwalten", exact: true})
            .click();
        await page
            .getByRole("button", {name: `${member.name} entfernen`, exact: true})
            .click();
        await page
            .getByRole("dialog", {name: "Mitglied entfernen?", exact: true})
            .getByRole("button", {name: "Mitglied entfernen", exact: true})
            .click();
        await expect(
            other.getByText(
                /Du hast keinen Zugriff mehr|Diese Unterhaltung ist nicht verfügbar/,
            ),
        ).toBeVisible({timeout: 5000});
        await expect(other.getByText(before, {exact: true})).toHaveCount(0);
        await page
            .getByRole("dialog", {name: "Mitglieder verwalten", exact: true})
            .getByRole("button", {name: "Schließen", exact: true})
            .click();
        const after = `Nur noch die Gruppe ${randomUUID().slice(0, 8)}`;
        await send(page, after);
        await expect(other.getByText(after, {exact: true})).toHaveCount(0);
        const memberApi = localClient(process.env.SUPABASE_ANON_KEY!);
        expect(
            (
                await memberApi.auth.signInWithPassword({
                    email: member.email,
                    password: process.env.E2E_PASSWORD!,
                })
            ).error,
        ).toBeNull();
        expect(
            (await memberApi.rpc("chat_messages", {p_room_id: room})).error,
        ).toBeTruthy();
        await a11y(page);
    } finally {
        await memberContext.close();
    }
});