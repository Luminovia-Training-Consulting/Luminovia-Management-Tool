/**
 * Real-browser pointer readiness for long course pages. Visibility alone does not
 * establish that the rendered click point is unobstructed after scrolling.
 * Diagnostics contain geometry and element classes only, never user text/tokens.
 */
import {expect, type Locator} from "@playwright/test";

/** Read the browser's actual viewport/hit target without changing application state. */
async function pointerGeometry(target: Locator, timeout: number) {
    return target.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const viewport = window.visualViewport;
        return {
            ready: Boolean(
                hit &&
                (node === hit || node.contains(hit)) &&
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
            ),
            target: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
            hit: hit
                ? {tag: hit.tagName, classes: hit.getAttribute("class")}
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
            clientWidth: document.documentElement.clientWidth,
        };
    }, undefined, {timeout});
}

/**
 * Scroll the current element, then require its real centre hit target before the
 * ordinary click. Reject horizontal overflow too: mobile Chromium can expand
 * innerWidth while retaining a narrower visual viewport, misplacing input.
 * A rerender may replace the element while scrolling. Re-resolve the locator
 * without repeating any click or business request.
 */
export async function assertPointerReady(
    target: Locator,
    label: string,
    {timeout = 10_000}: { timeout?: number } = {},
) {
    const probeTimeout = Math.min(timeout, 1000);
    let last: Awaited<ReturnType<typeof pointerGeometry>> | undefined;
    try {
        await expect
            .poll(
                async () => {
                    try {
                        await target.scrollIntoViewIfNeeded({timeout: probeTimeout});
                        last = await pointerGeometry(target, probeTimeout);
                        return last.ready;
                    } catch (error) {
                        if (
                            error instanceof Error &&
                            (error.name === "TimeoutError" ||
                                error.message.includes("Element is not attached to the DOM"))
                        ) {
                            return false;
                        }
                        throw error;
                    }
                },
                {timeout, message: `Unobstructed pointer target: ${label}`},
            )
            .toBe(true);
    } finally {
        console.info("[course pointer geometry]", JSON.stringify({label, last}));
    }
}
