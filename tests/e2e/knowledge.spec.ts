/**
 * Browser workflows for separate wiki drafts, published revisions and forum moderation.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Knowledge writes run only in the isolated ./portal test stack.",
);
/** Creates an SDK test client; each account session must be signed in explicitly. */
function client(key: string) {
  const url = process.env.SUPABASE_URL!;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
    throw new Error("Knowledge fixtures require loopback isolation.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
/** Creates the administrative fixture client; its key stays outside the browser application. */
const service = () => client(process.env.SUPABASE_SERVICE_ROLE_KEY!);
interface Account {
  id: string;
  email: string;
  name: string;
}
/** Creates a fictional actor for separate browser/API sessions and later scoped cleanup. */
async function account(
  role: "lecturer" | "admin",
  label: string,
): Promise<Account> {
  const tag = randomUUID().slice(0, 8);
  const email = `knowledge-${label}-${tag}@example.invalid`;
  const name = `Knowledge QA ${label} ${tag}`;
  const result = await service().auth.admin.createUser({
    email,
    password: process.env.E2E_PASSWORD!,
    email_confirm: true,
  });
  expect(result.error).toBeNull();
  const id = result.data.user!.id;
  expect(
    (
      await service()
        .from("profiles")
        .update({ display_name: name })
        .eq("id", id)
    ).error,
  ).toBeNull();
  expect(
    (await service().from("user_roles").insert({ user_id: id, role })).error,
  ).toBeNull();
  return { id, email, name };
}
/** Signs this test actor in through the visible form and waits for confirmed navigation. */
async function login(page: Page, user: Account) {
  await page.goto("/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(user.email);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
/** Computes the current six-digit TOTP from the fictional MFA secret; never log the code or secret. */
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return (
    (digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) %
    1_000_000
  )
    .toString()
    .padStart(6, "0");
}
/** Raises the actual test session to AAL2 through Auth/TOTP rather than simulating browser privileges. */
async function adminMfa(page: Page, user: Account) {
  await login(page, user);
  await page.goto("/security");
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === "POST" &&
      new URL(item.url()).pathname.endsWith("/auth/v1/factors"),
  );
  await page
    .getByRole("button", { name: "Authenticator einrichten", exact: true })
    .click();
  const data = await (await response).json();
  await page
    .getByLabel("Sechsstelliger Code", { exact: true })
    .fill(totp(data.totp.secret));
  await page
    .getByRole("button", { name: "Code bestätigen", exact: true })
    .click();
  await expect(
    page.getByText("Dein Konto ist mit zwei Faktoren bestätigt.", {
      exact: true,
    }),
  ).toBeVisible();
}
/** Checks the rendered state with axe; this does not replace manual accessibility acceptance. */
async function a11y(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
}

test("wiki draft, MFA publishing, code preservation and unpublished revision privacy work through the UI", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(100_000);
  const author = await account("lecturer", "Author");
  const reader = await account("lecturer", "Reader");
  const admin = await account("admin", "Editor");
  await login(page, author);
  await page.goto("/wiki");
  await page
    .getByRole("button", { name: "Artikel schreiben", exact: true })
    .click();
  const title = `Python Wissen ${randomUUID().slice(0, 8)}`;
  const code = 'print("Hallo Luminovia")\n# <script>bleibt Text</script>';
  await page.getByLabel("Titel", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Codeblock", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Code-Sprache", exact: true })
    .selectOption("python");
  await page.getByRole("textbox", { name: "Inhalt", exact: true }).click();
  // Desktop Enter inserts code newlines; Shift+Enter exits desktop code blocks.
  // Android UA emulation has no native virtual keyboard, so its explicit
  // Shift+Enter event takes the emulated line-break path instead.
  const lineBreak = testInfo.project.use.isMobile ? "Shift+Enter" : "Enter";
  for (const [index, line] of code.split("\n").entries()) {
    if (index) await page.keyboard.press(lineBreak);
    await page.keyboard.insertText(line);
  }
  await expect(page.locator(".knowledge-write pre code")).toHaveText(code);
  await page
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const codeBlock = page.locator(
    '.knowledge-readonly pre[data-language="python"] code',
  );
  await expect(codeBlock).toHaveText(code);
  expect(await codeBlock.textContent()).toBe(code);
  expect(await page.locator(".knowledge-readonly script").count()).toBe(0);
  const id = new URL(page.url()).searchParams.get("page");
  expect(id).toBeTruthy();
  const readerApi = client(process.env.SUPABASE_ANON_KEY!);
  expect(
    (
      await readerApi.auth.signInWithPassword({
        email: reader.email,
        password: process.env.E2E_PASSWORD!,
      })
    ).error,
  ).toBeNull();
  expect((await readerApi.rpc("wiki_page", { p_id: id })).error).toBeTruthy();
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL!,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  try {
    const moderator = await context.newPage();
    await adminMfa(moderator, admin);
    await moderator.goto(`/wiki?page=${id}`);
    await moderator
      .getByRole("button", { name: "Bearbeiten", exact: true })
      .click();
    await moderator
      .getByRole("button", { name: "Veröffentlichen", exact: true })
      .click();
    await expect(
      moderator.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const published = await readerApi.rpc("wiki_page", { p_id: id });
    expect(published.error).toBeNull();
    expect(JSON.stringify(published.data.content)).toContain("Hallo Luminovia");
    await page.reload();
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    const draftTitle = `${title} Entwurf`;
    await page.getByLabel("Titel", { exact: true }).fill(draftTitle);
    await page
      .getByRole("button", { name: "Entwurf speichern", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: draftTitle, exact: true }),
    ).toBeVisible();
    const unchanged = await readerApi.rpc("wiki_page", { p_id: id });
    expect(unchanged.error).toBeNull();
    expect(unchanged.data.title).toBe(title);
    await page
      .getByRole("button", { name: "Versionsverlauf", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Versionsverlauf", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await a11y(page);
    await page.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-wiki.png`,
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("forum supports real rich-text discussion, accepted answers, reports and MFA moderation", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(100_000);
  const owner = await account("lecturer", "Question");
  const replier = await account("lecturer", "Answer");
  const admin = await account("admin", "Moderator");
  await login(page, owner);
  await page.goto("/forum");
  await page
    .getByRole("button", { name: "Thema eröffnen", exact: true })
    .click();
  const title = `Linux Frage ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Titel", { exact: true }).fill(title);
  await page
    .getByRole("textbox", { name: "Inhalt", exact: true })
    .fill("Wie helfen Dateirechte im Unterricht?");
  await page
    .locator(".knowledge-write")
    .getByRole("button", { name: "Thema eröffnen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const id = new URL(page.url()).searchParams.get("thread");
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL!,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  const moderatorContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL!,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  try {
    const responder = await context.newPage();
    await login(responder, replier);
    await responder.goto(`/forum?thread=${id}`);
    const answer = `Berechtigungen mit ls -l prüfen ${randomUUID().slice(0, 8)}`;
    await responder
      .getByRole("textbox", { name: "Antwort schreiben", exact: true })
      .fill(answer);
    await responder
      .getByRole("button", { name: "Antwort veröffentlichen", exact: true })
      .click();
    await expect(
      responder.locator(".forum-post").getByText(answer, { exact: true }),
    ).toBeVisible();
    await page.reload();
    const answerPost = page.locator(".forum-post").filter({ hasText: answer });
    await answerPost
      .getByRole("button", {
        name: "Als hilfreiche Antwort markieren",
        exact: true,
      })
      .click();
    await expect(
      answerPost.getByText("Hilfreiche Antwort", { exact: true }),
    ).toBeVisible();
    await answerPost
      .getByRole("button", { name: "Beitrag melden", exact: true })
      .click();
    await page
      .getByLabel("Grund der Meldung", { exact: true })
      .fill("Fiktive Testmeldung zur Moderationsprüfung.");
    await page
      .getByRole("button", { name: "Meldung senden", exact: true })
      .click();
    await expect(
      page.getByText("Deine Meldung wurde übermittelt.", { exact: true }),
    ).toBeVisible();
    await responder
      .getByRole("button", { name: "Thema abonnieren", exact: true })
      .click();
    await expect(
      responder.getByRole("button", {
        name: "Abonnement beenden",
        exact: true,
      }),
    ).toBeVisible();
    await responder
      .getByRole("button", { name: "Abonnement beenden", exact: true })
      .click();
    await expect(
      responder.getByRole("button", { name: "Thema abonnieren", exact: true }),
    ).toBeVisible();
    const moderator = await moderatorContext.newPage();
    await adminMfa(moderator, admin);
    await moderator.goto(`/forum?thread=${id}`);
    await moderator
      .getByRole("button", { name: "Thema moderieren", exact: true })
      .click();
    await moderator
      .getByRole("button", { name: "Thema schließen", exact: true })
      .click();
    await moderator
      .getByRole("dialog")
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await responder.reload();
    await expect(
      responder.getByText(
        "Dieses Thema ist geschlossen. Neue Antworten sind derzeit nicht möglich.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      responder.getByRole("button", {
        name: "Antwort veröffentlichen",
        exact: true,
      }),
    ).toHaveCount(0);
    await moderator
      .getByRole("button", { name: "Meldungen prüfen", exact: true })
      .click();
    const report = moderator
      .locator(".forum-reports-list>li")
      .filter({ hasText: "Fiktive Testmeldung zur Moderationsprüfung." })
      .filter({ has: moderator.getByText(owner.name, { exact: true }) });
    await report
      .getByRole("button", { name: "Als bearbeitet markieren", exact: true })
      .click();
    await expect(report.getByText("Bearbeitet", { exact: true })).toBeVisible();
    await moderator
      .getByRole("dialog")
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await a11y(responder);
    await responder.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-forum.png`,
      fullPage: true,
    });
  } finally {
    await context.close();
    await moderatorContext.close();
  }
});
