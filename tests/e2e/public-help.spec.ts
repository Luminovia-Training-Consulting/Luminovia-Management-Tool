/** Public help remains usable without a signed-in session or backend requests. */
import { expect, type Page, test as base } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const backendPath = /\/(?:auth|rest|storage|functions|realtime)\/v1(?:\/|$)/;

// Abort matching HTTP requests and fail on attempts instead of mocking success.
// WebSocket attempts are recorded separately; the listener does not block them.
// The automatic fixture checks every scenario after its browser actions finish.
const test = base.extend<{ isolatedHelp: void }>({
  isolatedHelp: [
    async ({ page }, use) => {
      const attempted: string[] = [];
      await page.route(
        (url) => backendPath.test(url.pathname),
        async (route) => {
          attempted.push(new URL(route.request().url()).pathname);
          await route.abort("blockedbyclient");
        },
      );
      page.on("websocket", (socket) => {
        const path = new URL(socket.url()).pathname;
        if (backendPath.test(path)) attempted.push(path);
      });
      await use();
      expect(attempted, "Public help never calls a backend").toEqual([]);
    },
    { auto: true },
  ],
});

/** Waits for fonts before checking viewport fit and automated WCAG rules. */
async function accessibleWithoutOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= window.innerWidth,
    viewport: window.innerWidth,
    offenders: [...document.querySelectorAll("body *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > window.innerWidth + 1,
      )
      .slice(0, 5)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}.${element.className?.toString().replaceAll(" ", ".")}`,
      ),
  }));
  expect(
    layout.fits,
    `The public guide fits ${layout.viewport}px: ${layout.offenders.join(", ")}`,
  ).toBe(true);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    })),
  ).toEqual([]);
}

test("a deep-linked public help topic stays accessible and selected after translation", async ({
  page,
}, testInfo) => {
  await page.goto("/help?topic=jobs");
  await expect(
    page.getByRole("heading", { name: "Hilfe & Anleitungen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Aufträge übernehmen",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Die Übernahme wurde abgelehnt oder ihr Ergebnis ist unklar.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Claim jobs", exact: true, level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByText("A claim was rejected or its result is unclear.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("topic") === "jobs",
  );
  await accessibleWithoutOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("help-jobs-en-light.png"),
    fullPage: true,
  });
});

test("public help filters topics and updates the shareable URL when choosing a result", async ({
  page,
}) => {
  await page.goto("/help?topic=jobs");
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  const search = page.getByRole("searchbox", {
    name: "Search help",
    exact: true,
  });
  await search.fill("claim");
  await expect(
    page.getByRole("heading", { name: "Claim jobs", exact: true, level: 2 }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: /^Claim jobs\b/ }).click();
  await expect(
    page.getByRole("heading", { name: "Claim jobs", exact: true, level: 2 }),
  ).toBeFocused();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("topic") === "jobs",
  );
  await search.fill("quarantine");
  await expect(
    page.getByRole("link", { name: /^File centre\b/ }),
  ).toBeVisible();
  await search.fill("zzzz-no-fictional-help-match-zzzz");
  await expect(page.getByRole("link", { name: /^File centre\b/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await page.getByRole("link", { name: /^File centre\b/ }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("topic") === "files",
  );
});
test("LMS help filters course guides, supports keyboard reading and links to the course workspace", async ({
  page,
}) => {
  await page.goto("/help");
  await page
    .getByRole("combobox", { name: "Themenbereich" })
    .selectOption("courses");
  await expect(page.getByRole("link", { name: /^Dateizentrale/ })).toHaveCount(
    0,
  );
  await page
    .getByRole("link", { name: /^Meine Kurse und Lernmaterialien/ })
    .press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Meine Kurse und Lernmaterialien",
      level: 2,
    }),
  ).toBeFocused();
  await page.getByRole("combobox", { name: "Sprache" }).selectOption("en");
  await expect(
    page.getByRole("heading", {
      name: "My courses and learning materials",
      level: 2,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("area") === "courses" &&
      url.searchParams.get("topic") === "lms-learning",
  );
  await accessibleWithoutOverflow(page);
  await page.getByRole("button", { name: "Back to overview" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search help" }),
  ).toBeFocused();
  await page
    .getByRole("link", { name: /^My courses and learning materials/ })
    .press("Enter");
  await expect(
    page.getByRole("link", { name: "Open section in the portal" }),
  ).toHaveAttribute("href", "/learning");
});
