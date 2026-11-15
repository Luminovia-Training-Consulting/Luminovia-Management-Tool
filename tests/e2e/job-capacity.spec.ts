import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
  await adminLogin(page, manager);
  await page.goto("/admin");
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
    .getByRole("button", { name: "Stelle speichern", exact: true })
    .click();
  await expect(
    page.getByText("Stelle gespeichert.", { exact: true }),
  ).toBeVisible();
  const created = await checked(
    service
      .from("jobs")
      .select("id,capacity,capacity_basis,terms_version,status")
      .eq("title", title)
      .single(),
  );
  expect(created).toMatchObject({
    capacity: 3,
    capacity_basis: "per_position",
    status: "draft",
  });
  const board = page.getByRole("region", {
    name: "Auftragsboard",
    exact: true,
  });
  const card = () => board.locator(`[data-offer-id="${created.id}"]`);
  await expect(card()).toBeVisible();
  const handle = card().getByRole("button", {
    name: `${title} verschieben`,
    exact: true,
  });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-grabbed", "true");
  // The real keyboard sensor uses geometric collisions. Advance until the
  // authorized published column is targeted on both stacked and wide boards.
  const direction = testInfo.project.name.startsWith("mobile")
    ? "ArrowDown"
    : "ArrowRight";
  const target = board.locator('[data-board-column="published"]');
  for (let n = 0; n < 100; n++) {
    if ((await target.getAttribute("class"))?.includes("offer-column-target"))
      break;
    await page.keyboard.press(direction);
    await page.waitForTimeout(20);
  }
  await expect(target).toHaveClass(/offer-column-target/);
  await page.keyboard.press("Space");
  await expect
    .poll(
      async () =>
        (
          await checked(
            service.from("jobs").select("status").eq("id", created.id).single(),
          )
        ).status,
    )
    .toBe("published");
  await expect(card().getByRole("combobox")).toHaveValue("published");
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
      ).status,
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
      path: `docs/screenshots/${testInfo.project.name}-job-board.png`,
    });
  } finally {
    await context.close();
  }
});
