/** Browser persistence and actor isolation on the disposable test project. */
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actor, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Requires the isolated portal test project.",
);
test("manual unread survives reload and is personal to each member", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(100_000);
  const tag = randomUUID().slice(0, 8);
  const owner = await actor(`Fictional owner ${tag}`, "lecturer"),
    member = await actor(`Fictional member ${tag}`, "lecturer");
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  try {
    await login(page, owner.email);
    await page.goto("/chats");
    await page
      .getByRole("button", { name: "Gruppe erstellen", exact: true })
      .click();
    const title = `Fictional unread ${tag}`;
    await page.getByLabel("Gruppenname", { exact: true }).fill(title);
    await page
      .getByRole("checkbox", { name: member.name, exact: true })
      .check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Gruppe erstellen", exact: true })
      .click();
    await page.goto("/chats");
    const row = page.locator(".chat-room-row").filter({ hasText: title });
    await row.locator(".chat-room-button").click();
    const composer = page.locator(".chat-composer");
    const previewText = `Fictional latest preview ${tag}`;
    await composer
      .getByLabel("Deine Nachricht", { exact: true })
      .fill(previewText);
    await composer
      .getByRole("button", { name: "Nachricht senden", exact: true })
      .click();
    await expect(row.locator(".chat-room-preview")).toContainText(previewText);
    await expect(row.locator(".chat-room-preview")).toHaveAttribute(
      "title",
      previewText,
    );
    await row
      .getByRole("button", { name: `${title} als ungelesen markieren` })
      .click();
    await expect(row.getByLabel("Als ungelesen markiert")).toBeVisible();
    await page.reload();
    await expect(row.getByLabel("Als ungelesen markiert")).toBeVisible();
    const other = await context.newPage();
    await login(other, member.email);
    await other.goto("/chats");
    const otherRow = other.locator(".chat-room-row").filter({ hasText: title });
    await expect(
      otherRow.getByRole("button", {
        name: `${title} als ungelesen markieren`,
      }),
    ).toBeVisible();
    await expect(otherRow.getByLabel("Als ungelesen markiert")).toHaveCount(0);
    const cleared = page.waitForResponse(
      (response) =>
        response.url().includes("/rpc/clear_chat_manual_unread") &&
        response.ok(),
    );
    await row.locator(".chat-room-button").click();
    await cleared;
    await page.goto("/chats");
    await expect(row.getByLabel("Als ungelesen markiert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
