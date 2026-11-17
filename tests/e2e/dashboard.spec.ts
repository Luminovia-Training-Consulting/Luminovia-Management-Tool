/**
 * Browser workflows for personal activity previews without exposing other actors' private events.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  api,
  actor,
  checked,
  login,
  adminLogin,
} from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Dashboard fixture writes require the canonical disposable project.",
);

/** Creates a controlled private event for this actor to verify dashboard isolation. */
function appointment(user: string, title: string) {
  const start = new Date(Date.now() + 2 * 86400000);
  return {
    user_id: user,
    title,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + 3600000).toISOString(),
    time_zone: "Europe/Berlin",
  };
}

test("dashboard previews show actual own activity, scanned files and private appointments in both languages", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const teacher = await actor("Fictional dashboard lecturer", "lecturer");
  const peer = await actor("Fictional dashboard peer", "lecturer");
  const token = randomUUID().slice(0, 8);
  const ownTitle = `Private dashboard preparation ${token}`;
  const foreignTitle = `Foreign private preparation ${token}`;
  await checked(
    service
      .from("personal_events")
      .insert([
        appointment(teacher.id, ownTitle),
        appointment(peer.id, foreignTitle),
      ]),
  );
  const peerApi = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    peerApi.auth.signInWithPassword({
      email: peer.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const room = await checked(
    peerApi.rpc("create_dm", { p_user_id: teacher.id }),
  );
  await checked(
    peerApi.rpc("send_message", {
      p_room_id: room,
      p_body: `Fictional dashboard message ${token}`,
      p_client_id: randomUUID(),
    }),
  );
  await login(page, teacher.email);
  const calendar = page.getByRole("region", {
    name: "Mein Kalender im Blick",
    exact: true,
  });
  const activity = page.getByRole("region", {
    name: "Nachrichten & Meldungen",
    exact: true,
  });
  await expect(calendar.getByText(ownTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(foreignTitle, { exact: true })).toHaveCount(0);
  await expect(
    activity.getByText("1 ungelesene Nachricht", { exact: true }),
  ).toBeVisible();
  await expect(
    activity.getByText("1 ungelesene Meldung", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Meine offenen Vertragsbestätigungen",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Verwaltung: nächste Schritte",
      exact: true,
    }),
  ).toHaveCount(0);

  await page.goto("/files");
  const filename = `Dashboard-${token}.txt`;
  await page
    .getByRole("button", { name: "Datei hochladen", exact: true })
    .click();
  const upload = page.getByRole("dialog");
  await upload.getByLabel("Datei auswählen", { exact: true }).setInputFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: Buffer.from("Fictional dashboard course handout."),
  });
  await upload
    .getByRole("button", { name: "Datei hochladen", exact: true })
    .click();
  await expect(upload).not.toBeVisible({ timeout: 45000 });
  await expect(
    page
      .getByRole("listitem")
      .filter({ has: page.getByText(filename, { exact: true }) })
      .getByText("Geprüft", { exact: true }),
  ).toBeVisible();
  await page.goto("/");
  const files = page.getByRole("region", {
    name: "Zuletzt hinzugefügte Dateien",
    exact: true,
  });
  await expect(
    files.getByRole("link", { name: filename, exact: true }),
  ).toBeVisible();
  await files.getByRole("link", { name: filename, exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/files\\?q=${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  await expect(
    page.getByRole("searchbox", { name: "Dateien suchen", exact: true }),
  ).toHaveValue(filename);
  await page.goto("/");
  await expect(page.getByText(ownTitle, { exact: true })).toBeVisible();
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(
    page
      .getByRole("region", { name: "My calendar at a glance", exact: true })
      .getByText(ownTitle, { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Recently added files", exact: true })
      .getByRole("link", { name: filename, exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    scan.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: `.local/screenshots/${testInfo.project.name}-dashboard-activity.png`,
    fullPage: true,
  });
});

test("password-only authentication management follow-ups never include another lecturer's private calendar", async ({
  page,
}) => {
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const manager = await actor("Fictional dashboard administrator", "admin");
  const peer = await actor("Fictional dashboard private lecturer", "lecturer");
  const token = randomUUID().slice(0, 8);
  const ownTitle = `Manager private preparation ${token}`;
  const foreignTitle = `Hidden lecturer private preparation ${token}`;
  await checked(
    service
      .from("personal_events")
      .insert([
        appointment(manager.id, ownTitle),
        appointment(peer.id, foreignTitle),
      ]),
  );
  await adminLogin(page, manager);
  await page.goto("/");
  await expect(
    page.getByRole("region", {
      name: "Verwaltung: nächste Schritte",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Mein Kalender im Blick", exact: true })
      .getByText(ownTitle, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(foreignTitle, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("region", {
      name: "Meine offenen Vertragsbestätigungen",
      exact: true,
    }),
  ).toBeVisible();
});
