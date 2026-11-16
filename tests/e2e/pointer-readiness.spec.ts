/**
 * Native desktop/mobile regression for the course pointer guard. This controlled
 * HTML fixture has no Auth/backend and does not claim business API acceptance.
 */
import { test, expect } from "@playwright/test";
import { assertPointerReady } from "./helpers/pointer-readiness";

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
