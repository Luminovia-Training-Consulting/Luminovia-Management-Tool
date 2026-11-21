/**
 * Browser workflows using actual invitation/recovery links captured by local Mailpit.
 * Mail is captured inside the fixture; these checks do not prove external delivery or manual platform acceptance.
 */
import {expect, test} from "@playwright/test";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";
import {checked} from "./helpers/accounts-support";

test.skip(
    !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Local Supabase fixture environment required.",
);

test("actual Auth invitation link opens password setup and the invited account can sign in", async ({
                                                                                                        page,
                                                                                                    }) => {
    const url = process.env.SUPABASE_URL!;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
        throw new Error("Onboarding fixture mutations require loopback Supabase.");
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
    const email = `onboarding-${randomUUID()}@example.invalid`;
    const origin = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
    // The Edge/Mailpit suite verifies sending. Generate a fresh real Auth invite URL here to
    // exercise browser token consumption repeatably, without consuming SMTP send limits.
    const { data, error } = await service.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: new URL("/auth/callback", origin).href },
    });
    expect(error).toBeNull();
    if (!data.user || !data.properties)
        throw new Error("Fictional Auth invitation failed");
    const role = await service
        .from("user_roles")
        .insert({user_id: data.user.id, role: "lecturer"});
    expect(role.error).toBeNull();
    const invitation = new URL("/auth/callback", origin);
    invitation.searchParams.set("token_hash", data.properties.hashed_token);
    invitation.searchParams.set("type", "invite");
    await page.goto(invitation.toString());
    await expect
        .poll(() => page.evaluate(() => location.pathname))
        .toBe("/auth/callback");
    await page
        .getByRole("button", {name: "Einladung annehmen", exact: true})
        .click();
    await expect(
        page.getByRole("heading", {name: "Passwort festlegen", exact: true}),
    ).toBeVisible();
    const password = `New!${randomUUID()}Aa9`;
    await page.getByLabel("Neues Passwort", {exact: true}).fill(password);
    await page
        .getByRole("button", {name: "Passwort festlegen", exact: true})
        .click();
    // Mandatory password setup releases portal access and opens the workspace.
    // Sign in again below to prove the new password survived sign-out.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("region", {name: "Arbeitsbereich"})).toBeVisible();
    await page.getByRole("button", {name: "Abmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Benutzername oder E-Mail", {exact: true}).fill(email);
    await page.getByLabel("Passwort", {exact: true}).fill(password);
    await page.getByRole("button", {name: "Anmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("region", {name: "Arbeitsbereich"})).toBeVisible();
});

test("real browser password recovery consumes a Mailpit email and keeps the PKCE verifier", async ({
                                                                                                       page,
                                                                                                   }) => {
    const url = process.env.SUPABASE_URL!;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
        throw new Error("Recovery fixture mutations require local Supabase.");
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
    const email = `recovery-${randomUUID()}@example.invalid`;
    const {data, error} = await service.auth.admin.createUser({
        email,
        password: `Old!${randomUUID()}Aa9`,
        email_confirm: true,
    });
    expect(error).toBeNull();
    expect(data.user).toBeTruthy();
    await checked(
        service
            .from("user_roles")
            .insert({user_id: data.user!.id, role: "lecturer"}),
    );
    await page.goto("/login");
    await page
        .getByRole("button", {name: "Passwort vergessen?", exact: true})
        .click();
    await page.getByLabel("Benutzername oder E-Mail", {exact: true}).fill(email);
    await page
        .getByRole("button", {name: "Link anfordern", exact: true})
        .click();
    await expect(page.getByRole("status")).toContainText(
        /Wenn ein Konto existiert/,
    );
    let messageId: string | undefined;
    await expect
        .poll(async () => {
            const inbox = await (
                await fetch(
                    `${process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324"}/api/v1/messages`,
                )
            ).json();
            messageId = inbox.messages.find(
                (message: { ID: string; To: { Address: string }[] }) =>
                    message.To.some((to) => to.Address === email),
            )?.ID;
            return Boolean(messageId);
        })
        .toBe(true);
    const message = await (
        await fetch(
            `${process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324"}/api/v1/message/${messageId}`,
        )
    ).json();
    expect(message.HTML).toContain("Passwort zurücksetzen");
    expect(message.HTML).toContain("Reset your password");
    const href = /href="([^"]+)"/
        .exec(message.HTML)?.[1]
        ?.replaceAll("&amp;", "&");
    expect(Boolean(href), "Actual recovery email contains a link").toBe(true);
    await page.goto(href!);
    await expect
        .poll(() => page.evaluate(() => location.pathname))
        .toBe("/auth/password");
    const password = `Reset!${randomUUID()}Aa9`;
    await page.getByLabel("Neues Passwort", {exact: true}).fill(password);
    await page
        .getByRole("button", {name: "Passwort festlegen", exact: true})
        .click();
    await expect(page.getByRole("status")).toContainText(
        "Dein Passwort wurde gespeichert.",
    );
    await page.getByRole("button", {name: "Abmelden", exact: true}).click();
    await page.getByLabel("Benutzername oder E-Mail", {exact: true}).fill(email);
    await page.getByLabel("Passwort", {exact: true}).fill(password);
    await page.getByRole("button", {name: "Anmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
});
