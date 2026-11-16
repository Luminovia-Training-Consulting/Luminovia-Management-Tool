/**
 * Backend-free desktop/mobile regression for translated course tabs. The real
 * shared/feature styles and a broad system font expose layout-viewport overflow
 * that can make an ordinary mobile Chromium click hit a different element.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("German course tabs fit the viewport with a broad system font", async ({
  page,
}) => {
  const shared = readFileSync("src/styles.css", "utf8");
  const operations = readFileSync("src/features/operations/styles.css", "utf8");
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${shared}\n${operations}\n:root{font-family:"DejaVu Sans",sans-serif}</style>
    <main class="main-content"><div class="operations-toolbar">
      <label class="field">Suchen<input type="search"></label>
      <div class="segmented">
        <button class="button button-secondary">Durchführungen</button>
        <button class="button button-secondary">Vorlagen</button>
        <button class="button button-secondary" onclick="this.dataset.clicked='yes'">Kursbausteine</button>
      </div>
    </div></main>`);
  const viewport = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    layoutWidth: innerWidth,
  }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.clientWidth);
  expect(viewport.layoutWidth).toBe(page.viewportSize()!.width);

  const action = page.getByRole("button", {
    name: "Kursbausteine",
    exact: true,
  });
  await action.scrollIntoViewIfNeeded();
  // Visibility alone cannot prove that the native click point is unobstructed.
  const centreHitsTarget = await action.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return Boolean(hit && (hit === node || node.contains(hit)));
  });
  expect(centreHitsTarget).toBe(true);
  await action.click();
  await expect(action).toHaveAttribute("data-clicked", "yes");
});
