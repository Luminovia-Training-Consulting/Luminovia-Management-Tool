/** Real unified-search journey across Auth/RPC/scanned files: six authorised fixture sources and their result links, with foreign private records excluded. Uses only canonical fictional actors. */
import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Search workflows require the isolated ./portal test stack.",
);

test("real portal search combines authorized sources, excludes foreign private records and treats wildcard text literally", async ({
                                                                                                                                       page,
                                                                                                                                   }, testInfo) => {
    test.setTimeout(120_000);
    const marker = `search${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const owner = await actor("Fictional Search Reader", "lecturer");
    const peer = await actor(`${marker} Search Peer`, "lecturer");
    const outsider = await actor("Fictional Search Outsider", "lecturer");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const ownerApi = api(process.env.SUPABASE_ANON_KEY!);
    const peerApi = api(process.env.SUPABASE_ANON_KEY!);
    const ownerSession = await checked(
        ownerApi.auth.signInWithPassword({
            email: owner.email,
            password: process.env.E2E_PASSWORD!,
        }),
    );
    const peerSession = await checked(
        peerApi.auth.signInWithPassword({
            email: peer.email,
            password: process.env.E2E_PASSWORD!,
        }),
    );

    // These are actual RPC-created rooms/messages, not intercepted search replies.
    const room = await checked(ownerApi.rpc("create_dm", {p_user_id: peer.id}));
    const visibleMessage = `${marker} permitted private message`;
    await checked(
        ownerApi.rpc("send_message", {
            p_room_id: room,
            p_body: visibleMessage,
            p_client_id: randomUUID(),
        }),
    );
    const foreignRoom = await checked(
        peerApi.rpc("create_dm", {p_user_id: outsider.id}),
    );
    const hiddenMessage = `${marker} foreign private message`;
    await checked(
        peerApi.rpc("send_message", {
            p_room_id: foreignRoom,
            p_body: hiddenMessage,
            p_client_id: randomUUID(),
        }),
    );

    const wikiCategory = (
        await checked(ownerApi.rpc("knowledge_categories", {p_kind: "wiki"}))
    )[0].id;
    const content = {
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{type: "text", text: "Fictional authored search content."}],
            },
        ],
    };
    const wikiTitle = `${marker} own wiki draft`;
    const wiki = await checked(
        ownerApi.rpc("save_wiki_page", {
            p_id: null,
            p_title: wikiTitle,
            p_locale: "de",
            p_category_id: wikiCategory,
            p_content: content,
            p_status: "draft",
            p_expected_version: null,
        }),
    );
    const hiddenWikiTitle = `${marker} foreign wiki draft`;
    await checked(
        peerApi.rpc("save_wiki_page", {
            p_id: null,
            p_title: hiddenWikiTitle,
            p_locale: "de",
            p_category_id: wikiCategory,
            p_content: content,
            p_status: "draft",
            p_expected_version: null,
        }),
    );
    const forumCategory = (
        await checked(ownerApi.rpc("knowledge_categories", {p_kind: "forum"}))
    )[0].id;
    const forumTitle = `${marker} shared forum question`;
    const thread = await checked(
        peerApi.rpc("create_forum_thread", {
            p_category_id: forumCategory,
            p_title: forumTitle,
            p_content: content,
        }),
    );

    const literal = `${marker}%_\\`;
    const job = randomUUID();
    const decoy = randomUUID();
    const hiddenJob = randomUUID();
    const jobTitle = `${literal} visible job`;
    const decoyTitle = `${marker}XY wildcard decoy`;
    const hiddenJobTitle = `${marker} unpublished job`;
    await checked(
        service.from("jobs").insert(
            [
                {id: job, title: jobTitle, status: "published"},
                {id: decoy, title: decoyTitle, status: "published"},
                {id: hiddenJob, title: hiddenJobTitle, status: "draft"},
            ].map((row) => ({
                ...row,
                description: "Fictional portal search fixture.",
                customer_name: "Fictional search academy",
                delivery_type: "online",
                location: "Online",
                time_zone: "Europe/Berlin",
                amount: 100,
                total_amount: 100,
                currency: "EUR",
                rate_unit: "fixed_total",
                terms: "Fictional search terms.",
                requires_contract: false,
            })),
        ),
    );
    await checked(
        service.from("job_sessions").insert(
            [job, decoy, hiddenJob].map((job_id) => ({
                job_id,
                starts_at: "2048-03-02T08:00:00Z",
                ends_at: "2048-03-02T09:00:00Z",
            })),
        ),
    );

    // Real clean files exercise document RLS inside the aggregate query.
    const upload = async (token: string, name: string) => {
        const form = new FormData();
        form.set(
            "file",
            new File(["Fictional scanned search material."], name, {
                type: "text/plain",
            }),
        );
        form.set("scope", "personal");
        form.set("kind", "material");
        form.set("client_id", randomUUID());
        const response = await fetch(
            `${process.env.SUPABASE_URL}/functions/v1/files`,
            {
                method: "POST",
                headers: {
                    Origin: new URL(process.env.E2E_BASE_URL!).origin,
                    Authorization: `Bearer ${token}`,
                    apikey: process.env.SUPABASE_ANON_KEY!,
                },
                body: form,
            },
        );
        const result = await response.json();
        expect(response.status).toBe(200);
        expect(result.document.status).toBe("clean");
    };
    const fileName = `${marker}-owned.txt`;
    const hiddenFileName = `${marker}-private-peer.txt`;
    await upload(ownerSession.session!.access_token, fileName);
    await upload(peerSession.session!.access_token, hiddenFileName);

    await login(page, owner.email);
    await page.goto("/search");
    await expect(
        page.getByRole("heading", {name: "Universelle Suche", exact: true}),
    ).toBeVisible();
    const search = page.getByRole("searchbox", {
        name: "Suchbegriff",
        exact: true,
    });
    await search.fill(marker);
    const waitForSearch = (query: string) =>
        page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/rest/v1/rpc/unified_search" &&
                response.request().method() === "POST" &&
                response.request().postDataJSON().p_query === query,
        );
    const responsePromise = waitForSearch(marker);
    await search.press("Enter");
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({
        p_query: marker,
        p_kind: "",
        p_after_kind: null,
        p_after_title: null,
        p_after_id: null,
        p_limit: 40,
    });
    const expectedRows = [
        {id: job, kind: "jobs", title: jobTitle, url: `/jobs/${job}`},
        {id: decoy, kind: "jobs", title: decoyTitle, url: `/jobs/${decoy}`},
        {
            kind: "files",
            title: fileName,
            url: `/files?q=${encodeURIComponent(fileName)}`,
        },
        {
            id: wiki.page_id,
            kind: "wiki",
            title: wikiTitle,
            url: `/wiki?page=${wiki.page_id}`,
        },
        {
            id: thread,
            kind: "forum",
            title: forumTitle,
            url: `/forum?thread=${thread}`,
        },
        {kind: "chats", title: visibleMessage, url: `/chats?room=${room}`},
        {
            id: peer.id,
            kind: "people",
            title: peer.name,
            url: `/people/${peer.id}`,
        },
    ];
    const data = await response.json();
    expect(data).toEqual({
        items: expect.arrayContaining(
            expectedRows.map((row) => expect.objectContaining(row)),
        ),
        has_more: false,
        next_cursor: null,
    });
    expect(data.items).toHaveLength(7);
    const results = page.locator(".portal-search-results");
    await expect(results.getByRole("link")).toHaveCount(7);
    for (const title of [
        jobTitle,
        decoyTitle,
        fileName,
        wikiTitle,
        forumTitle,
        visibleMessage,
        peer.name,
    ])
        await expect(results.getByText(title, {exact: true})).toBeVisible();
    for (const title of [
        hiddenJobTitle,
        hiddenFileName,
        hiddenWikiTitle,
        hiddenMessage,
    ])
        await expect(results.getByText(title, {exact: true})).toHaveCount(0);
    await expect(
        results.locator(`a[href="/chats/forum?view=articles&page=${wiki.page_id}"]`),
    ).toBeVisible();
    await expect(
        results.locator(`a[href="/chats/forum?thread=${thread}"]`),
    ).toBeVisible();
    const message = data.items.find(
        (item: {kind: string; title: string}) => item.kind === "chats" && item.title === visibleMessage,
    );
    expect(message?.id).toEqual(expect.any(String));
    const messageLink = results.getByRole("link").filter({hasText: visibleMessage});
    await expect(messageLink).toHaveAttribute(
        "href",
        `/chats?room=${room}&message=${message.id}`,
    );
    await expect(results.locator(`a[href="/people/${peer.id}"]`)).toBeVisible();

    const draft = `${marker} unsubmitted text`;
    await search.fill(draft);
    await page.getByLabel("Sprache", {exact: true}).selectOption("en");
    await expect(
        page.getByRole("heading", {name: "Universal search", exact: true}),
    ).toBeVisible();
    const englishSearch = page.getByRole("searchbox", {
        name: "Search term",
        exact: true,
    });
    await expect(englishSearch).toHaveValue(draft);
    await expect(results.getByText(wikiTitle, {exact: true})).toBeVisible();
    await englishSearch.fill(literal);
    const literalResponsePromise = waitForSearch(literal);
    await englishSearch.press("Enter");
    const literalResponse = await literalResponsePromise;
    expect(literalResponse.status()).toBe(200);
    expect(await literalResponse.json()).toEqual({
        items: [expect.objectContaining(expectedRows[0])],
        has_more: false,
        next_cursor: null,
    });
    await expect(results.getByRole("link")).toHaveCount(1);
    await expect(results.getByText(jobTitle, {exact: true})).toBeVisible();
    await expect(page).toHaveURL(/\/search$/);
    expect(await page.evaluate(() => window.history.state?.usr ?? null)).toBeNull();
    await page.reload();
    await expect(englishSearch).toHaveValue("");
    await expect(results).toHaveCount(0);
    await englishSearch.fill(literal);
    await englishSearch.press("Enter");
    await expect(results.getByRole("link")).toHaveCount(1);
    await results.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job}$`));
    await expect(
        page.getByRole("heading", {name: jobTitle, exact: true}),
    ).toBeVisible();

    await page.goBack();
    await englishSearch.fill(marker);
    await englishSearch.press("Enter");
    await results.locator(`a[href="/chats/forum?view=articles&page=${wiki.page_id}"]`).click();
    await expect(
        page.getByRole("heading", {name: wikiTitle, exact: true}),
    ).toBeVisible();
    await page.goBack();
    await messageLink.click();
    await expect(
        page.locator(".chat-message-body").filter({hasText: visibleMessage}),
    ).toBeVisible();
    await page.goBack();
    await results.locator(`a[href="/people/${peer.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/people/${peer.id}$`));
    await expect(
        page.getByRole("heading", {name: peer.name, exact: true}),
    ).toBeVisible();
    await page.goBack();
    await expect(results.getByRole("link")).toHaveCount(7);
    await page.evaluate(() => document.fonts.ready);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
        ),
    ).toBe(false);
    const accessibility = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        accessibility.violations.map((item) => ({
            id: item.id,
            nodes: item.nodes.map((node) => node.target),
        })),
    ).toEqual([]);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-functional-search.png`,
        fullPage: true,
    });
});