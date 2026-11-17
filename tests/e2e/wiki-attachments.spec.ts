/** Real isolated Auth, scanned Storage and browser verification for revision-scoped wiki attachments. */
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  actor,
  api,
  checked,
  assertPasswordOnly,
  login,
} from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Wiki attachments run only on the disposable portal test stack.",
);

test("wiki draft attachments become readable only after publication and are revoked after archive", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(100_000);
  const author = await actor("Fictional wiki author", "lecturer");
  const peer = await actor("Fictional wiki reader", "lecturer");
  const learner = await actor("Fictional participant", "participant");
  const manager = await actor("Fictional wiki publisher", "admin");
  const signIn = async (email: string) => {
    const client = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
      client.auth.signInWithPassword({
        email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    return client;
  };
  const authorApi = await signIn(author.email),
    peerApi = await signIn(peer.email),
    learnerApi = await signIn(learner.email),
    managerApi = await signIn(manager.email);
  await assertPasswordOnly(managerApi);
  const categories = await checked(
    authorApi.rpc("knowledge_categories", { p_kind: "wiki" }),
    { requireData: true },
  );
  const base = {
    p_title: `Fictional wiki attachment ${randomUUID().slice(0, 8)}`,
    p_locale: "de",
    p_category_id: categories[0].id,
    p_content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Fictional wiki lesson" }],
        },
      ],
    },
  };
  const draft = await checked(
    authorApi.rpc("save_wiki_page", {
      ...base,
      p_id: null,
      p_status: "draft",
      p_expected_version: null,
    }),
    { requireData: true },
  );
  const pageId = draft.page_id as string;
  expect(
    (await peerApi.rpc("wiki_attachments", { p_page_id: pageId })).error,
  ).toBeTruthy();
  const bytes = Buffer.from(`Fictional wiki file ${randomUUID()}`);
  const filename = `wiki-${randomUUID().slice(0, 8)}.txt`;
  await login(page, author.email);
  await page.goto(`/wiki?page=${pageId}`);
  await expect(page.getByRole("heading", { name: base.p_title })).toBeVisible();
  await page
    .getByLabel("Datei für den Wiki-Entwurf auswählen")
    .setInputFiles({ name: filename, mimeType: "text/plain", buffer: bytes });
  await page.getByRole("button", { name: "Datei prüfen und anhängen" }).click();
  await expect(
    page.getByRole("button", { name: `Anhang ${filename} herunterladen` }),
  ).toBeVisible({ timeout: 45_000 });
  const draftLinks = await checked(
    authorApi.rpc("wiki_attachments", { p_page_id: pageId }),
    { requireData: true },
  );
  expect(draftLinks).toHaveLength(1);
  const draftId = draftLinks[0].id as string;
  expect(
    (await peerApi.rpc("wiki_attachment_access", { p_id: draftId })).error,
  ).toBeTruthy();
  await checked(
    managerApi.rpc("save_wiki_page", {
      ...base,
      p_id: pageId,
      p_status: "published",
      p_expected_version: 1,
    }),
  );
  const peerLinks = await checked(
    peerApi.rpc("wiki_attachments", { p_page_id: pageId }),
    { requireData: true },
  );
  expect(peerLinks).toHaveLength(1);
  const linkId = peerLinks[0].id as string;
  expect(linkId).not.toBe(draftId);
  const access = await checked(
    peerApi.rpc("wiki_attachment_access", { p_id: linkId }),
    { requireData: true },
  );
  expect(access).not.toHaveProperty("object_path");
  expect(
    (
      await peerApi.rpc("wiki_attachment_storage_path", {
        p_id: linkId,
        p_version_id: peerLinks[0].version_id,
      })
    ).error,
  ).toBeTruthy();
  expect(
    (await learnerApi.rpc("wiki_attachment_access", { p_id: linkId })).error,
  ).toBeTruthy();
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  try {
    const reader = await context.newPage();
    await login(reader, peer.email);
    await reader.goto(`/wiki?page=${pageId}`);
    const button = reader.getByRole("button", {
      name: `Anhang ${filename} herunterladen`,
    });
    await expect(button).toBeVisible();
    const pending = reader.waitForEvent("download");
    await button.click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    expect(await readFile((await download.path())!)).toEqual(bytes);
    const auth = (
      await checked(peerApi.auth.getSession(), { requireData: true })
    ).session;
    expect(auth).toBeTruthy();
    const learnerSession = (
      await checked(learnerApi.auth.getSession(), { requireData: true })
    ).session;
    expect(learnerSession).toBeTruthy();
    const endpoint = `${process.env.SUPABASE_URL}/functions/v1/course-documents`;
    const request = (token = auth!.access_token, attachmentId = linkId) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          Origin: new URL(process.env.E2E_BASE_URL!).origin,
          Authorization: `Bearer ${token}`,
          apikey: process.env.SUPABASE_ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind: "wiki_resource", id: attachmentId }),
      });
    expect((await request()).status).toBe(200);
    expect((await request(learnerSession!.access_token)).status).toBe(403);
    expect((await request(auth!.access_token, draftId)).status).toBe(403);
    await checked(
      managerApi.rpc("save_wiki_page", {
        ...base,
        p_id: pageId,
        p_status: "archived",
        p_expected_version: 2,
      }),
    );
    expect(
      (await peerApi.rpc("wiki_attachment_access", { p_id: linkId })).error,
    ).toBeTruthy();
    expect((await request()).status).toBe(403);
  } finally {
    await context.close();
  }
});
