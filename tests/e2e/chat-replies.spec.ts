/** Reply lifecycle on an owned disposable backend, in separate actor sessions. */
import {expect, type Page, test} from "@playwright/test";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Requires the isolated portal test environment.",
);

function client(key: string) {
    const url = process.env.SUPABASE_URL!;
    if (
        !url ||
        !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
    )
        throw new Error("Fictional chat fixtures require loopback.");
    return createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
}

async function actor() {
    const service = client(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const email = `pin-${randomUUID()}@example.invalid`;
    const created = await service.auth.admin.createUser({
        email,
        password: process.env.E2E_PASSWORD!,
        email_confirm: true,
    });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;
    expect(
        (await service.from("user_roles").insert({user_id: id, role: "lecturer"}))
            .error,
    ).toBeNull();
    const api = client(process.env.SUPABASE_ANON_KEY!);
    expect(
        (
            await api.auth.signInWithPassword({
                email,
                password: process.env.E2E_PASSWORD!,
            })
        ).error,
    ).toBeNull();
    return {id, email, api};
}

async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.getByLabel("E-Mail", {exact: true}).fill(email);
    await page
        .getByLabel("Passwort", {exact: true})
        .fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", {name: "Anmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/chats");
}

test("reply previews follow personal hiding and global deletion without exposing stale text", async ({
                                                                                                         page,
                                                                                                         browser,
                                                                                                     }, info) => {
    test.setTimeout(100_000);
    const owner = await actor();
    const member = await actor();
    const stranger = await actor();
    const room = await owner.api.rpc("create_chat_group", {
        p_title: `Reply ${randomUUID().slice(0, 8)}`,
        p_member_ids: [member.id],
    });
    expect(room.error).toBeNull();
    const body = `Fictional reply source ${randomUUID()}`;
    const parent = await owner.api.rpc("send_message", {
        p_room_id: room.data,
        p_body: body,
        p_client_id: randomUUID(),
    });
    expect(parent.error).toBeNull();
    expect(
        (
            await stranger.api.rpc("send_chat_reply", {
                p_room_id: room.data,
                p_reply_to_id: parent.data,
                p_body: "forged",
                p_client_id: randomUUID(),
                p_mention_ids: [],
            })
        ).error,
    ).toBeTruthy();
    const context = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
    });
    try {
        await login(page, owner.email);
        const receiver = await context.newPage();
        await login(receiver, member.email);
        for (const current of [page, receiver]) {
            await current.goto(`/chats?room=${room.data}`);
            await expect(current.locator("[data-realtime-status]")).toHaveAttribute(
                "data-realtime-status",
                "connected",
                {timeout: 20_000},
            );
            await expect(
                current.locator(".chat-message-body").getByText(body, {exact: true}),
            ).toBeVisible();
        }
        const parentRow = receiver
            .locator(".chat-message")
            .filter({
                has: receiver
                    .locator(".chat-message-body")
                    .getByText(body, {exact: true}),
            });
        await parentRow
            .getByRole("button", {name: "Auf Nachricht antworten", exact: true})
            .click();
        const response = `Fictional reply ${randomUUID()}`;
        await receiver
            .getByLabel("Deine Nachricht", {exact: true})
            .fill(response);
        await receiver
            .getByRole("button", {name: "Nachricht senden", exact: true})
            .click();
        const memberReply = receiver
            .locator(".chat-message")
            .filter({
                has: receiver
                    .locator(".chat-message-body")
                    .getByText(response, {exact: true}),
            });
        const ownerReply = page
            .locator(".chat-message")
            .filter({
                has: page
                    .locator(".chat-message-body")
                    .getByText(response, {exact: true}),
            });
        await expect(memberReply.locator(".chat-reply-preview")).toContainText(
            body,
        );
        await expect(ownerReply.locator(".chat-reply-preview")).toContainText(
            body,
            {timeout: 20_000},
        );
        await parentRow
            .getByRole("button", {name: "Für mich ausblenden", exact: true})
            .click();
        await receiver
            .getByRole("dialog")
            .getByRole("button", {name: "Für mich ausblenden", exact: true})
            .click();
        await expect(memberReply.locator(".chat-reply-preview")).toHaveText(
            "Die ursprüngliche Nachricht ist nicht verfügbar.",
        );
        await expect(ownerReply.locator(".chat-reply-preview")).toContainText(body);
        await receiver.reload();
        await expect(memberReply.locator(".chat-reply-preview")).toHaveText(
            "Die ursprüngliche Nachricht ist nicht verfügbar.",
        );
        const ownerParent = page
            .locator(".chat-message")
            .filter({
                has: page
                    .locator(".chat-message-body")
                    .getByText(body, {exact: true}),
            });
        await ownerParent
            .getByRole("button", {name: "Nachricht löschen", exact: true})
            .click();
        await page
            .getByRole("dialog")
            .getByRole("button", {name: "Nachricht löschen", exact: true})
            .click();
        await expect(ownerReply.locator(".chat-reply-preview")).toHaveText(
            "Die ursprüngliche Nachricht ist nicht verfügbar.",
        );
    } finally {
        await context.close();
    }
});