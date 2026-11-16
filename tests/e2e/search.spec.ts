/** Real aggregate-search journey across Auth/RPC/REST/scanned files: authorised results navigate correctly while foreign private records stay absent. Uses only canonical fictional actors. */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { api, actor, checked, login } from "./helpers/accounts-support";

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
  const room = await checked(ownerApi.rpc("create_dm", { p_user_id: peer.id }));
  const visibleMessage = `${marker} permitted private message`;
  await checked(
    ownerApi.rpc("send_message", {
      p_room_id: room,
      p_body: visibleMessage,
      p_client_id: randomUUID(),
    }),
  );
  const foreignRoom = await checked(
    peerApi.rpc("create_dm", { p_user_id: outsider.id }),
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
    await checked(ownerApi.rpc("knowledge_categories", { p_kind: "wiki" }))
  )[0].id;
  const content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Fictional authored search content." }],
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
    await checked(ownerApi.rpc("knowledge_categories", { p_kind: "forum" }))
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
  const hiddenJobTitle = `${marker} unpublished job`;
  await checked(
    service.from("jobs").insert(
      [
        { id: job, title: jobTitle, status: "published" },
        { id: decoy, title: `${marker}XY wildcard decoy`, status: "published" },
        { id: hiddenJob, title: hiddenJobTitle, status: "draft" },
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
  const searchLink = page.getByRole("link", {
    name: "Im Portal suchen",
    exact: true,
  });
  const more = page.getByLabel("Mehr", { exact: true });
  // The Auth redirect can precede the shell. Wait for its actual responsive
  // navigation before deciding whether the mobile disclosure is needed.
  await expect(searchLink.or(more).filter({ visible: true })).toBeVisible();
  if (!(await searchLink.isVisible())) await more.click();
  await expect(searchLink).toBeVisible();
  await searchLink.click();
  const search = page.getByRole("searchbox", {
    name: "Im Portal suchen",
    exact: true,
  });
  await search.fill(marker);
  const responses = [
    "jobs",
    "documents",
    "rpc/wiki_pages_list",
    "rpc/forum_threads_list",
    "messages",
    "rpc/chat_contacts",
  ].map((path) =>
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/rest/v1/${path}`,
    ),
  );
  await search.press("Enter");
  for (const response of await Promise.all(responses))
    expect(response.status()).toBe(200);
  const results = page.locator(".portal-search-results");
  await expect(results.getByRole("link")).toHaveCount(7);
  for (const title of [
    jobTitle,
    fileName,
    wikiTitle,
    forumTitle,
    visibleMessage,
    peer.name,
  ])
    await expect(results.getByText(title, { exact: true })).toBeVisible();
  for (const title of [
    hiddenJobTitle,
    hiddenFileName,
    hiddenWikiTitle,
    hiddenMessage,
  ])
    await expect(results.getByText(title, { exact: true })).toHaveCount(0);
  await expect(
    results.locator(`a[href="/wiki?page=${wiki.page_id}"]`),
  ).toBeVisible();
  await expect(
    results.locator(`a[href="/forum?thread=${thread}"]`),
  ).toBeVisible();
  await expect(results.locator(`a[href="/chats?room=${room}"]`)).toBeVisible();
  await expect(
    results.locator(`a[href="/chats?contact=${peer.id}"]`),
  ).toBeVisible();

  const draft = `${marker} unsubmitted text`;
  await search.fill(draft);
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  const englishSearch = page.getByRole("searchbox", {
    name: "Search the portal",
    exact: true,
  });
  await expect(englishSearch).toHaveValue(draft);
  await expect(results.getByText(wikiTitle, { exact: true })).toBeVisible();
  await englishSearch.fill(literal);
  await englishSearch.press("Enter");
  await expect(results.getByRole("link")).toHaveCount(1);
  await expect(results.getByText(jobTitle, { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe(literal);
  await page.reload();
  await expect(
    page.getByRole("searchbox", { name: "Search the portal", exact: true }),
  ).toHaveValue(literal);
  await expect(results.getByRole("link")).toHaveCount(1);
  await results.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${job}$`));
  await expect(
    page.getByRole("heading", { name: jobTitle, exact: true }),
  ).toBeVisible();

  await page.goto(`/search?q=${encodeURIComponent(marker)}`);
  await results.locator(`a[href="/wiki?page=${wiki.page_id}"]`).click();
  await expect(
    page.getByRole("heading", { name: wikiTitle, exact: true }),
  ).toBeVisible();
  await page.goto(`/search?q=${encodeURIComponent(marker)}`);
  await results.locator(`a[href="/chats?room=${room}"]`).click();
  await expect(
    page.locator(".chat-message-body").filter({ hasText: visibleMessage }),
  ).toBeVisible();
  await page.goto(`/search?q=${encodeURIComponent(marker)}`);
  await expect(results.getByRole("link")).toHaveCount(7);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    accessibility.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: `docs/screenshots/${testInfo.project.name}-functional-search.png`,
    fullPage: true,
  });
});
