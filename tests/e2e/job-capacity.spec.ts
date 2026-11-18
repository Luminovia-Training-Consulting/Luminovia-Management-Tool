/**
 * Browser workflows for complete job positions and accessible authorised board actions.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  api,
  actor,
  checked,
  adminLogin,
  login,
} from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Capacity writes require the canonical disposable project.",
);
test("per-position creation, authorized keyboard/pointer board and partial acceptance stay connected", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    manager = await actor("Fictional capacity UI manager", "admin"),
    teacher = await actor("Fictional capacity UI teacher", "lecturer");
  // A real tall draft column reproduces the CI failure even on an empty board.
  // Keyboard movement must not depend on ten-pixel steps or a test arrow limit.
  await checked(
    service.from("jobs").insert(
      Array.from({ length: 16 }, (_, index) => ({
        id: randomUUID(),
        title: `Fictional long keyboard column ${testInfo.project.name} ${index}`,
        customer_name: "Fictional keyboard academy",
        delivery_type: "online",
        status: "draft",
        amount: 100,
        total_amount: 100,
        currency: "EUR",
        rate_unit: "fixed_total",
        terms: "Fictional keyboard regression fixture",
        requires_contract: false,
      })),
    ),
  );
  await adminLogin(page, manager);
  await page.goto("/admin?create=job");
  const title = `Fictional capacity UI ${testInfo.project.name}`;
  await page.getByLabel("Titel", { exact: true }).fill(title);
  await page
    .getByLabel("Kunde", { exact: true })
    .fill("Fictional capacity UI academy");
  await page.getByLabel("Dozierendenplätze", { exact: true }).fill("3");
  await page
    .getByLabel("Voller Auftragspreis gesamt", { exact: true })
    .fill("100.01");
  await page
    .getByLabel("Konditionen", { exact: true })
    .fill("Fictional per-position terms for the entire teaching block");
  await expect(
    page.getByText(/Maximales Auftraggeberbudget:.*300,03/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Auftrag speichern", exact: true })
    .click();
  await expect(
    page.getByText("Auftrag gespeichert.", { exact: true }),
  ).toBeVisible();
  const created = await checked(
    service
      .from("jobs")
      .select("id,capacity,capacity_basis,terms_version,status")
      .eq("title", title)
      .single(),
  );
  if (!created) throw new Error("The server did not return the created offer.");
  expect(created).toMatchObject({
    capacity: 3,
    capacity_basis: "per_position",
    status: "draft",
  });
  // Saving keeps the creation route open so another offer can be entered.
  // Open the board explicitly before asserting and operating on its card.
  await page.goto("/admin");
  const board = page.getByRole("region", {
    name: "Auftragsboard",
    exact: true,
  });
  /** Locates the exact fixture job on the board so unrelated cards cannot satisfy the assertion. */
  const card = () => board.locator(`[data-offer-id="${created.id}"]`);
  await expect(card()).toBeVisible();
  const handle = card().getByRole("button", {
    name: `${title} verschieben`,
    exact: true,
  });
  const direction = testInfo.project.name.startsWith("mobile")
    ? "ArrowDown"
    : "ArrowRight";
  const target = board.locator('[data-board-column="published"]');
  const archived = board.locator('[data-board-column="archived"]');
  if (testInfo.project.name.startsWith("mobile")) {
    const distance = await target.evaluate((element, id) => {
      const card = document.querySelector(`[data-offer-id="${id}"]`)!;
      return (
        element.getBoundingClientRect().top -
        card.getBoundingClientRect().bottom
      );
    }, created.id);
    expect(
      distance,
      "Regression fixture separates destinations by more than 1000px",
    ).toBeGreaterThan(1000);
  }
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/rest/v1/rpc/manage_job_offer")
      requests++;
  });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-grabbed", "true");
  const draftColumn = board.locator('[data-board-column="draft"]');
  await expect(draftColumn).toHaveClass(/offer-column-target/);
  await page.keyboard.press(
    testInfo.project.name.startsWith("mobile") ? "ArrowUp" : "ArrowLeft",
  );
  await expect(draftColumn).toHaveClass(/offer-column-target/);
  await page.keyboard.press(direction);
  await expect(target).toHaveClass(/offer-column-target/);
  await expect(target.locator("h3")).toBeInViewport();
  await page.keyboard.press(direction);
  await expect(archived).toHaveClass(/offer-column-target/);
  await page.keyboard.press(direction);
  await expect(archived).toHaveClass(/offer-column-target/);
  await expect(board.locator('[data-board-column="filled"]')).not.toHaveClass(
    /offer-column-target/,
  );
  await page.keyboard.press(
    testInfo.project.name.startsWith("mobile") ? "ArrowUp" : "ArrowLeft",
  );
  await expect(target).toHaveClass(/offer-column-target/);
  await page.keyboard.press("Escape");
  await expect(handle).not.toHaveAttribute("aria-grabbed", "true");
  expect(
    requests,
    "Navigating and cancelling never requests a server mutation",
  ).toBe(0);
  expect(
    await checked(
      service
        .from("jobs")
        .select("status,terms_version")
        .eq("id", created.id)
        .single(),
    ),
  ).toEqual({ status: "draft", terms_version: created.terms_version });
  // aria-grabbed clears before the real cancellation animation completes.
  // A new pickup must wait for that lifecycle, not for an arbitrary delay or
  // incidental database/network latency between the two keyboard gestures.
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-grabbed", "true");
  await page.keyboard.press(direction);
  await expect(target).toHaveClass(/offer-column-target/);
  await page.keyboard.press("Space");
  await expect
    .poll(
      async () =>
        (
          await checked(
            service.from("jobs").select("status").eq("id", created.id).single(),
          )
        )?.status,
    )
    .toBe("published");
  await expect(card().getByRole("combobox")).toHaveValue("published");
  expect(requests).toBe(1);
  // Always retain the ordinary keyboard/select fallback for status changes.
  await card().getByRole("combobox").selectOption("draft");
  await expect(card().getByRole("combobox")).toHaveValue("draft");
  if (!testInfo.project.name.startsWith("mobile")) {
    const grip = card().getByRole("button", {
      name: `${title} verschieben`,
      exact: true,
    });
    await grip.scrollIntoViewIfNeeded();
    const sourceBox = (await grip.boundingBox())!,
      targetBox = (await target.boundingBox())!;
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 12,
      sourceBox.y + sourceBox.height / 2,
      { steps: 4 },
    );
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 90, {
      steps: 20,
    });
    await expect(target).toHaveClass(/offer-column-target/);
    await page.mouse.up();
    await expect(card().getByRole("combobox")).toHaveValue("published");
  } else {
    await card().getByRole("combobox").selectOption("published");
    await expect(card().getByRole("combobox")).toHaveValue("published");
  }
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
  });
  try {
    const lecturerPage = await context.newPage();
    await login(lecturerPage, teacher.email);
    await lecturerPage.goto(`/jobs/${created.id}`);
    await expect(
      lecturerPage.getByText("3 Plätze zur Übernahme offen", { exact: true }),
    ).toBeVisible();
    await lecturerPage
      .getByLabel("Konditionen akzeptieren", { exact: true })
      .check();
    await lecturerPage
      .getByRole("button", { name: "Auftrag übernehmen", exact: true })
      .click();
    await expect(
      lecturerPage.getByText(
        "Dein Auftrag ist bestätigt. Alle Termine sind reserviert.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      (
        await checked(
          service.from("jobs").select("status").eq("id", created.id).single(),
        )
      )?.status,
    ).toBe("published");
    await page
      .getByRole("button", { name: "Board aktualisieren", exact: true })
      .click();
    await expect(
      card().getByText("Dozierendenplätze: 1/3", { exact: true }),
    ).toBeVisible();
    await expect(card().getByRole("combobox")).toHaveCount(0);
    await expect(
      card().getByRole("button", { name: `${title} verschieben`, exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(
      page.getByRole("heading", { name: "Offer board", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const result = await new AxeBuilder({ page })
      .include(".offer-board")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const englishBoard = page.getByRole("region", {
      name: "Offer board",
      exact: true,
    });
    await expect(englishBoard).toBeVisible();
    await englishBoard.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-job-board.png`,
    });
  } finally {
    await context.close();
  }
});
