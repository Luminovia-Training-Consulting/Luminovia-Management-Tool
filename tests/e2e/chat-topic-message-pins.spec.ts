/** Real isolated topic message-pin lifecycle across two connected actors. */
import {expect, type Page, test} from "@playwright/test";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Requires isolated portal acceptance.",
);

function client(key: string) {
    const url = process.env.SUPABASE_URL!;
    if (
        !url ||
        !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
    )
        throw new Error("Isolated loopback required.");
    return createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
}

async function actor() {
    const service = client(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const email = `topic-pin-${randomUUID()}@example.invalid`;
    const result = await service.auth.admin.createUser({
        email,
        password: process.env.E2E_PASSWORD!,
        email_confirm: true,
    });
    expect(result.error).toBeNull();
    const id = result.data.user!.id;
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
    return {email, id, api};
}

async function login(page: Page, email: string, room: string) {
    await page.goto("/login");
    await page.getByLabel("E-Mail", {exact: true}).fill(email);
    await page
        .getByLabel("Passwort", {exact: true})
        .fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", {name: "Anmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto(`/chats?room=${room}`);
    await expect(page.locator("[data-realtime-status]")).toHaveAttribute(
        "data-realtime-status",
        "connected",
        {timeout: 20_000},
    );
}

test("topic owners pin and unpin live; deletion removes the pinned context", async ({
                                                                                        page,
                                                                                        browser,
                                                                                    }, info) => {
    test.setTimeout(100_000);
    const owner = await actor(),
        member = await actor(),
        outsider = await actor();
    const room = await owner.api.rpc("create_chat_group", {
        p_title: `Fictional pins ${randomUUID().slice(0, 8)}`,
        p_member_ids: [member.id],
    });
    expect(room.error).toBeNull();
    const body = `Fictional group pin ${randomUUID()}`;
    const message = await owner.api.rpc("send_message", {
        p_room_id: room.data,
        p_body: body,
        p_client_id: randomUUID(),
    });
    expect(message.error).toBeNull();
    expect(
        (
            await outsider.api.rpc("set_chat_topic_message_pin", {
                p_message_id: message.data,
                p_pinned: true,
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
        await login(page, owner.email, room.data);
        const other = await context.newPage();
        await login(other, member.email, room.data);
        await page
            .getByText("Suche, angeheftete Nachrichten & Hinweise", {exact: true})
            .click();
        await other
            .getByText("Suche, angeheftete Nachrichten & Hinweise", {exact: true})
            .click();
        const row = page.locator(".chat-message").filter({hasText: body});
        await row
            .getByRole("button", {name: "Nachricht in Gruppe anheften"})
            .click();
        const ownerPins = page.getByRole("region", {
            name: "Angeheftete Nachrichten",
        });
        const memberPins = other.getByRole("region", {
            name: "Angeheftete Nachrichten",
        });
        await expect(ownerPins.getByText(body, {exact: true})).toBeVisible();
        await expect(memberPins.getByText(body, {exact: true})).toBeVisible();
        await expect(
            other.getByRole("button", {name: "Nachricht in Gruppe lösen"}),
        ).toHaveCount(0);
        await row
            .getByRole("button", {name: "Nachricht in Gruppe lösen"})
            .click();
        await expect(memberPins.getByText(body, {exact: true})).toHaveCount(0);
        await row
            .getByRole("button", {name: "Nachricht in Gruppe anheften"})
            .click();
        await expect(memberPins.getByText(body, {exact: true})).toBeVisible();
        expect(
            (await owner.api.rpc("delete_message", {p_message_id: message.data}))
                .error,
        ).toBeNull();
        await expect(memberPins.getByText(body, {exact: true})).toHaveCount(0);
    } finally {
        await context.close();
    }
});