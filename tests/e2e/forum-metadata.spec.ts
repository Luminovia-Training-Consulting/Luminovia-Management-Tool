/** Auth-backed browser journey on the disposable portal stack. */
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Requires disposable portal stack.",
);
test("thread owner changes the title and the server persists it", async ({
                                                                             page,
                                                                         }) => {
    const author = await actor("Fictional forum editor", "lecturer");
    const client = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
        client.auth.signInWithPassword({
            email: author.email,
            password: process.env.E2E_PASSWORD!,
        }),
    );
    const categories = await checked(
        client.rpc("knowledge_categories", {p_kind: "forum"}),
        {requireData: true},
    );
    const title = `Fictional metadata ${randomUUID().slice(0, 8)}`;
    const thread = await checked(
        client.rpc("create_forum_thread", {
            p_category_id: categories[0].id,
            p_title: title,
            p_content: {
                type: "doc",
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "Fictional question"}],
                    },
                ],
            },
        }),
        {requireData: true},
    );
    await login(page, author.email);
    await page.goto(`/forum?thread=${thread}`);
    await page.getByRole("button", {name: "Thema bearbeiten"}).click();
    const dialog = page.getByRole("dialog", {name: "Thema bearbeiten"});
    await dialog.getByLabel("Titel").fill(`${title} revised`);
    await dialog.getByRole("button", {name: "Speichern"}).click();
    await expect(dialog).toBeHidden();
    await expect(
        page.getByRole("heading", {name: `${title} revised`, exact: true}),
    ).toBeVisible();
    const current = await checked(client.rpc("forum_thread", {p_id: thread}), {
        requireData: true,
    });
    expect(current.title).toBe(`${title} revised`);
    expect(current.metadata_version).toBe(2);
});