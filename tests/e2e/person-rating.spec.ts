import { expect, test } from "@playwright/test";
import { actor, login } from "./helpers/accounts-support";

test("the five ratings fit in one touch-friendly row and save after reconnecting", async ({
  page,
  context,
}) => {
  const reviewer = await actor("Fictional rating reviewer", "lecturer");
  const recipient = await actor("Fictional rating recipient", "lecturer");
  await login(page, reviewer.email);
  await page.goto(`/people/${recipient.id}`);
  await page
    .getByRole("button", {
      name: /Fictional rating recipient bewerten|Rate Fictional rating recipient/,
    })
    .click();

  const dialog = page.getByRole("dialog");
  const labels = dialog
    .locator("label")
    .filter({ has: page.getByRole("radio") });
  await expect(labels).toHaveCount(5);
  const geometry = await labels.evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      return { top: Math.round(box.top), width: box.width, height: box.height };
    }),
  );
  expect(new Set(geometry.map((box) => box.top)).size).toBe(1);
  for (const { width, height } of geometry) {
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }

  const first = dialog.getByRole("radio").first();
  await first.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio").nth(1)).toBeChecked();
  const comment = dialog.getByRole("textbox");
  await comment.fill("Fictional rating feedback.");
  const save = dialog.getByRole("button", {
    name: /Bewertung speichern|Save rating/,
  });
  await context.setOffline(true);
  try {
    await expect(save).toBeDisabled();
    await expect(comment).toHaveValue("Fictional rating feedback.");
  } finally {
    await context.setOffline(false);
  }
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    dialog.getByText(/Deine Bewertung wurde gespeichert|Your rating was saved/),
  ).toBeVisible();
});
