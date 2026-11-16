/**
 * Native desktop/mobile regression for the course pointer guard. This controlled
 * HTML fixture has no Auth/backend and does not claim business API acceptance.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { assertPointerReady } from "./helpers/pointer-readiness";

/**
 * Use the real shared/feature CSS and a broad installed fallback font. The three
 * German course tabs previously expanded Pixel 7's layout viewport to 435px,
 * while its visual viewport stayed 412px, making ordinary clicks miss targets.
 * No Auth or mocked business response is involved in this layout regression.
 */
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
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => innerWidth)).toBe(
    page.viewportSize()!.width,
  );
  const action = page.getByRole("button", {
    name: "Kursbausteine",
    exact: true,
  });
  await assertPointerReady(action, "German course tabs with broad font");
  await action.click();
  await expect(action).toHaveAttribute("data-clicked", "yes");
});

test("pointer readiness rejects a visible covered control and confirms a real click after scrolling", async ({
  page,
}) => {
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body{margin:0}button{height:48px;margin:24px}#blocker{position:fixed;inset:0;background:#eee;z-index:5}.spacer{height:1400px}.end{height:200px}</style>
    <button id="covered" onclick="this.dataset.clicked='yes'">Fictional covered action</button>
    <div id="blocker"></div><div class="spacer"></div>
    <button id="last" onclick="this.dataset.clicked='yes'">Fictional distant action</button><div class="end"></div>`);
  const covered = page.getByRole("button", {
    name: "Fictional covered action",
  });
  await expect(covered).toBeVisible();
  await expect(
    assertPointerReady(covered, "deliberately covered fixture", {
      timeout: 250,
    }),
  ).rejects.toThrow("Unobstructed pointer target");
  await expect(covered).not.toHaveAttribute("data-clicked", "yes");
  await page.locator("#blocker").evaluate((node) => node.remove());
  await assertPointerReady(covered, "uncovered fixture");
  await covered.click();
  await expect(covered).toHaveAttribute("data-clicked", "yes");

  const before = await page.evaluate(() => ({
    touch: navigator.maxTouchPoints,
    scale: visualViewport?.scale,
    width: innerWidth,
  }));
  await page.screenshot({ fullPage: true });
  expect(
    await page.evaluate(() => ({
      touch: navigator.maxTouchPoints,
      scale: visualViewport?.scale,
      width: innerWidth,
    })),
  ).toEqual(before);
  const distant = page.getByRole("button", {
    name: "Fictional distant action",
  });
  await assertPointerReady(distant, "scrolled fixture after capture");
  await distant.click();
  await expect(distant).toHaveAttribute("data-clicked", "yes");
});
