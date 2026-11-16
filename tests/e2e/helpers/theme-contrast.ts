/**
 * Measures actual computed button colours immediately during theme changes.
 * Relative luminance and the first intermediate state expose even short-lived contrast loss.
 */
import type { Page } from "@playwright/test";

/** Sample the first computed state, not a later settled animation frame. */
/** Reads the first computed colours during the theme change, then restores the original DOM state. */
export async function sampleThemeContrast(page: Page) {
  return await page.evaluate(async () => {
    await document.fonts.ready;
    const root = document.documentElement;
    const original = root.getAttribute("data-theme");
    const fixture = document.createElement("section");
    fixture.setAttribute("aria-label", "Fictional theme contrast regression");
    fixture.innerHTML =
      '<button type="button" class="button button-primary">Primary action</button><button type="button" class="button button-secondary">Secondary action</button>';
    document.body.append(fixture);
    /** Converts opaque sRGB channels to relative luminance; transparent or unsupported colour formats fail. */
    const luminance = (color: string) => {
      if (!/^rgba?\(/.test(color))
        throw new Error(
          `Expected an opaque RGB action color, received ${color}`,
        );
      const channels = color.match(/[\d.]+/g)!.map(Number);
      if (channels.length === 4 && channels[3] !== 1)
        throw new Error(`Expected an opaque action color, received ${color}`);
      const linear = channels.slice(0, 3).map((value) => {
        const v = value / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    /** Reads each test button's foreground/background synchronously before a later animation state can hide the failure. */
    const sample = (theme: string) =>
      [...fixture.querySelectorAll("button")].map((button) => {
        const style = getComputedStyle(button);
        const foreground = style.color;
        const background = style.backgroundColor;
        const values = [luminance(foreground), luminance(background)].sort(
          (a, b) => a - b,
        );
        return {
          theme,
          action: button.textContent,
          foreground,
          background,
          ratio: (values[1] + 0.05) / (values[0] + 0.05),
        };
      });
    try {
      root.dataset.theme = "light";
      // Establish the light before-change style. There is deliberately no
      // settling wait after either of the actual changes under examination.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const results = sample("light");
      for (const theme of ["dark", "light"]) {
        root.dataset.theme = theme;
        results.push(...sample(theme));
      }
      return results;
    } finally {
      fixture.remove();
      if (original === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", original);
    }
  });
}
