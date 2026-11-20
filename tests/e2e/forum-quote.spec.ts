/** Actual browser/editor and Auth-backed forum quote journey on the disposable QA stack. */
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Forum quote tests only run on the disposable portal stack.",
);

test("a current authorized post is quoted as text without losing the existing reply", async ({
                                                                                                 page,
                                                                                             }) => {
    const author = await actor("Fictional forum author", "lecturer");
    const reader = await actor("Fictional forum reader", "lecturer");
    const createClient = async (email: string) => {
        const client = api(process.env.SUPABASE_ANON_KEY!);
        await checked(
            client.auth.signInWithPassword({
                email,
                password: process.env.E2E_PASSWORD!,
            }),
        );
        return client;
    };
    const authorClient = await createClient(author.email);
    const readerClient = await createClient(reader.email);
    const categories = await checked(
        authorClient.rpc("knowledge_categories", {p_kind: "forum"}),
        {requireData: true},
    );
    const source = `Fictional source <script>literal</script> ${randomUUID().slice(0, 8)}`;
    const content = {
        type: "doc",
        content: [{type: "paragraph", content: [{type: "text", text: source}]}],
    };
    const thread = await checked(
        authorClient.rpc("create_forum_thread", {
            p_category_id: categories[0].id,
            p_title: `Fictional quote ${randomUUID().slice(0, 8)}`,
            p_content: content,
        }),
        {requireData: true},
    );
    await login(page, reader.email);
    await page.goto(`/forum?thread=${thread}`);
    const sourcePost = page.locator(".forum-post").filter({hasText: source});
    await expect(sourcePost).toBeVisible();
    const editor = page.getByRole("textbox", {
        name: "Antwort schreiben",
        exact: true,
    });
    const draft = `Own fictional draft ${randomUUID().slice(0, 8)}`;
    await editor.fill(draft);
    await sourcePost
        .getByRole("button", {name: "Beitrag zitieren", exact: true})
        .click();
    const updated = page.getByRole("textbox", {
        name: "Antwort schreiben",
        exact: true,
    });
    await expect(updated).toContainText(draft);
    await expect(updated.locator("blockquote")).toContainText(source);
    await expect(updated.locator("script")).toHaveCount(0);
    await page
        .getByRole("button", {name: "Antwort veröffentlichen", exact: true})
        .click();
    await expect(
        page.getByText("Deine Antwort wurde veröffentlicht.", {exact: true}),
    ).toBeVisible();
    const posts = await checked(
        readerClient.rpc("forum_posts", {p_thread_id: thread}),
        {requireData: true},
    );
    const reply = posts.find(
        (item: { author_id: string }) => item.author_id === reader.id,
    );
    expect(reply).toBeTruthy();
    expect(reply.content.content).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                type: "paragraph",
                content: expect.arrayContaining([
                    expect.objectContaining({type: "text", text: draft}),
                ]),
            }),
            expect.objectContaining({
                type: "blockquote",
                content: expect.arrayContaining([
                    expect.objectContaining({
                        type: "paragraph",
                        content: expect.arrayContaining([
                            expect.objectContaining({type: "text", text: source}),
                        ]),
                    }),
                ]),
            }),
        ]),
    );
});