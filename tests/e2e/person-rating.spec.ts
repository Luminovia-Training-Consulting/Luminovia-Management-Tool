import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
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

test("chat contacts keep message and rating actions separate and restore focus", async ({
  page,
}) => {
  const reviewer = await actor("Fictional chat rating reviewer", "lecturer");
  const recipient = await actor(
    `Fictional chat rating contact ${randomUUID().slice(0, 8)}`,
    "lecturer",
  );
  await login(page, reviewer.email);
  await page.goto("/chats");
  await page
    .getByRole("button", { name: /^(Neue Nachricht|New message)$/ })
    .click();
  const contacts = page.getByRole("dialog", {
    name: /Wem möchtest du schreiben|Who would you like to message/,
  });
  await contacts.getByRole("searchbox").fill(recipient.name);
  const start = contacts.getByRole("button", {
    name: new RegExp(
      `^${recipient.name} eine Nachricht schreiben$|^Message ${recipient.name}$`,
    ),
  });
  const rate = contacts.getByRole("button", {
    name: new RegExp(`^${recipient.name} bewerten$|^Rate ${recipient.name}$`),
  });
  await expect(start).toBeVisible();
  const boxes = await Promise.all([start.boundingBox(), rate.boundingBox()]);
  expect(boxes.every((box) => box && box.height >= 44)).toBe(true);
  await rate.click();
  const rating = page.getByRole("dialog", {
    name: new RegExp(`^${recipient.name} bewerten$|^Rate ${recipient.name}$`),
  });
  await expect(rating.getByRole("radio")).toHaveCount(5);
  await page.keyboard.press("Escape");
  await expect(contacts).toBeVisible();
  await expect(rate).toBeFocused();
  await expect(page).toHaveURL(/\/chats$/);
});
