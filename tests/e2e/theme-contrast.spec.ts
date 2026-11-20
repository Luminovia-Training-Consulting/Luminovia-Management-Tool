/**
 * Browser checks for readable action labels in the first computed theme state.
 * Rendered states are checked directly; this does not replace manual device/platform acceptance.
 */
import {expect, test} from "@playwright/test";
import {sampleThemeContrast} from "./helpers/theme-contrast";

test("theme changes keep action labels readable in the first computed frame", async ({
                                                                                         page,
                                                                                     }) => {
    await page.emulateMedia({
        colorScheme: "light",
        reducedMotion: "no-preference",
    });
    await page.goto("/login");
    await page.locator('input[type="email"]').first().waitFor();
    const samples = await sampleThemeContrast(page);
    for (const sample of samples)
        expect(
            sample.ratio,
            `${sample.theme} ${sample.action}: ${sample.foreground} on ${sample.background}`,
        ).toBeGreaterThanOrEqual(4.5);
});