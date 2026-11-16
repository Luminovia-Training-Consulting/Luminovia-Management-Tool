/**
 * Real-browser pointer readiness for long course pages. Visibility alone does not
 * establish that the rendered click point is unobstructed after scrolling.
 * Diagnostics contain geometry and element classes only, never user text/tokens.
 */
import { expect, type Locator } from "@playwright/test";

/** Read the browser's actual viewport/hit target without changing application state. */
async function pointerGeometry(target: Locator) {
  return target.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const viewport = window.visualViewport;
    return {
      ready: Boolean(hit && (node === hit || node.contains(hit))),
      target: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      hit: hit
        ? { tag: hit.tagName, classes: hit.getAttribute("class") }
        : null,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scrollX,
        scrollY,
        scale: viewport?.scale,
        offsetTop: viewport?.offsetTop,
        offsetLeft: viewport?.offsetLeft,
        visualWidth: viewport?.width,
        visualHeight: viewport?.height,
        touchPoints: navigator.maxTouchPoints,
      },
      documentWidth: document.documentElement.scrollWidth,
    };
  });
}

/**
 * Scroll once, then require the real centre hit target before the unchanged
 * ordinary click. This retries only a read-only assertion, never an action or
 * business request. A covered control must fail; no force-click or timeout boost.
 */
export async function assertPointerReady(
  target: Locator,
  label: string,
  { timeout = 10_000 }: { timeout?: number } = {},
) {
  let last: Awaited<ReturnType<typeof pointerGeometry>> | undefined;
  try {
    await target.scrollIntoViewIfNeeded();
    await expect
      .poll(
        async () => {
          last = await pointerGeometry(target);
          return last.ready;
        },
        { timeout, message: `Unobstructed pointer target: ${label}` },
      )
      .toBe(true);
  } finally {
    console.info("[course pointer geometry]", JSON.stringify({ label, last }));
  }
}
