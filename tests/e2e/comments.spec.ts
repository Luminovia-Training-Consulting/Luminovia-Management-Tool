/**
 * Browser workflows for literal comments, own revisions and reasoned MFA moderation.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  api,
  checked,
  actor,
  login,
  adminLogin,
} from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Discussions use only isolated real accounts.",
);
test("job comments persist, stay literal, support own edits and reasoned MFA moderation without impersonation", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const teacher = await actor(`Comment Teacher ${suffix}`, "lecturer"),
    peer = await actor(`Comment Peer ${suffix}`, "lecturer"),
    admin = await actor(`Comment Admin ${suffix}`, "admin");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const job = randomUUID(),
    body = `Practical teaching note <script>${suffix}</script>`;
  await checked(
    service.from("jobs").insert({
      id: job,
      title: `Comment course ${suffix}`,
      customer_name: "Fictional comment academy",
      delivery_type: "online",
      time_zone: "Europe/Berlin",
      status: "published",
      amount: 100,
      total_amount: 100,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Fictional assignment terms",
    }),
  );
  const options = {
    baseURL: process.env.E2E_BASE_URL!,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  };
  const peerContext = await browser.newContext(options),
    managerContext = await browser.newContext(options);
  try {
    await login(page, teacher.email);
    await page.goto(`/jobs/${job}`);
    await page.getByLabel("Dein Kommentar", { exact: true }).fill(body);
    await page
      .getByRole("button", { name: "Kommentar veröffentlichen", exact: true })
      .click();
    await expect(
      page.getByText("Dein Kommentar wurde gespeichert.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText(body, { exact: true })).toBeVisible();
    const other = await peerContext.newPage();
    await login(other, peer.email);
    await other.goto(`/jobs/${job}`);
    await expect(other.getByText(body, { exact: true })).toBeVisible();
    await expect(
      other.getByRole("button", { name: "Kommentar bearbeiten", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Kommentar bearbeiten", exact: true })
      .click();
    const edit = page.getByRole("dialog", {
      name: "Kommentar bearbeiten",
      exact: true,
    });
    await edit
      .getByLabel("Dein Kommentar", { exact: true })
      .fill(`${body}\nRevised practical note`);
    await edit
      .getByRole("button", { name: "Kommentar speichern", exact: true })
      .click();
    await expect(edit).not.toBeVisible();
    await other.reload();
    await expect(
      other.getByText(`${body}\nRevised practical note`, { exact: true }),
    ).toBeVisible();
    const manager = await managerContext.newPage();
    await adminLogin(manager, admin);
    await manager.goto(`/jobs/${job}`);
    await manager
      .getByRole("button", { name: "Kommentar ausblenden", exact: true })
      .click();
    let moderation = manager.getByRole("dialog", {
      name: "Kommentar moderieren",
      exact: true,
    });
    await moderation
      .getByLabel("Moderationsgrund", { exact: true })
      .fill("Fictional moderation review");
    await moderation
      .getByRole("button", { name: "Kommentar ausblenden", exact: true })
      .click();
    await expect(moderation).not.toBeVisible();
    await other.reload();
    await expect(
      other.getByText(`${body}\nRevised practical note`, { exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByText("Durch Moderation ausgeblendet", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Moderationsgrund: Fictional moderation review", {
        exact: true,
      }),
    ).toBeVisible();
    await manager
      .getByRole("button", { name: "Kommentar wiederherstellen", exact: true })
      .click();
    moderation = manager.getByRole("dialog", {
      name: "Kommentar moderieren",
      exact: true,
    });
    await moderation
      .getByLabel("Moderationsgrund", { exact: true })
      .fill("Restored after fictional review");
    await moderation
      .getByRole("button", { name: "Kommentar wiederherstellen", exact: true })
      .click();
    await expect(moderation).not.toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Kommentar zurückziehen", exact: true })
      .click();
    const withdrawal = page.getByRole("dialog", {
      name: "Deinen Kommentar zurückziehen?",
      exact: true,
    });
    await withdrawal
      .getByRole("button", { name: "Kommentar zurückziehen", exact: true })
      .click();
    await expect(withdrawal).not.toBeVisible();
    await other.reload();
    await expect(
      other.getByText("Kommentar zurückgezogen", { exact: true }),
    ).toBeVisible();
    await expect(
      other.getByText(`${body}\nRevised practical note`, { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(
      page.getByRole("heading", {
        name: "Comments & teaching notes",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      scan.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-job-comments.png`,
      fullPage: true,
    });
  } finally {
    await peerContext.close();
    await managerContext.close();
  }
});
