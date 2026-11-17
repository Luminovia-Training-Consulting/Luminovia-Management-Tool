import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  actor,
  api,
  checked,
  login,
  adminLogin,
} from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Only the canonical isolated project owns chat fixtures.",
);
async function signed(user: { email: string }) {
  const client = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    client.auth.signInWithPassword({
      email: user.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  return client;
}
async function a11y(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("profile opens an actual DM, current member mentions and a dropped scanned file persist safely", async ({
  page,
}, testInfo) => {
  test.setTimeout(100000);
  const token = randomUUID().slice(0, 8),
    author = await actor(`Mention Author ${token}`, "lecturer"),
    target = await actor(`Mention Target ${token}`, "lecturer");
  const authorApi = await signed(author),
    targetApi = await signed(target);
  await login(page, author.email);
  await page.goto(`/people/${target.id}`);
  await page
    .getByRole("link", { name: "Nachricht schreiben", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chats\?room=[a-f0-9-]{36}$/);
  const room = new URL(page.url()).searchParams.get("room")!;
  const composer = page.locator(".chat-composer");
  await composer
    .getByRole("button", { name: "Personen erwähnen", exact: true })
    .click();
  await composer
    .getByRole("checkbox", { name: target.name, exact: true })
    .check();
  await composer
    .getByRole("button", { name: "Personen erwähnen", exact: true })
    .click();
  const filename = `Mention-${token}.txt`;
  const transfer = await page.evaluateHandle(
    ({ name }) => {
      const data = new DataTransfer();
      data.items.add(
        new File(["Fictional scanned mention lesson only."], name, {
          type: "text/plain",
        }),
      );
      return data;
    },
    { name: filename },
  );
  try {
    await composer.dispatchEvent("drop", { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
  await expect(composer.getByText(filename, { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await expect(
    composer.getByRole("button", { name: "Nachricht senden", exact: true }),
  ).toBeEnabled();
  const text = `Fictional actual mention ${token} <script> stays text`;
  await composer.getByLabel("Deine Nachricht", { exact: true }).fill(text);
  await composer
    .getByRole("button", { name: "Nachricht senden", exact: true })
    .click();
  const row = page
    .locator(".chat-message")
    .filter({ has: page.getByText(text, { exact: true }) });
  await expect(
    row.getByRole("list", { name: "Erwähnte Personen", exact: true }),
  ).toContainText(target.name);
  await expect(row.getByText("Geprüft", { exact: true })).toBeVisible();
  expect(await row.locator("script").count()).toBe(0);
  const history = await checked(
    authorApi.rpc("chat_messages_with_mentions", { p_room_id: room }),
  );
  const message = history.find((item: { body: string }) => item.body === text);
  expect(
    message.mentions.map((item: { user_id: string }) => item.user_id),
  ).toEqual([target.id]);
  const alerts = await checked(
    targetApi
      .from("notifications")
      .select("id")
      .eq("kind", "chat_message")
      .eq("resource_id", message.id),
  );
  expect(alerts).toHaveLength(1);
  await page.reload();
  await expect(
    page
      .locator(".chat-message")
      .filter({ has: page.getByText(text, { exact: true }) })
      .getByRole("list", { name: "Erwähnte Personen", exact: true }),
  ).toContainText(target.name);
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(
    page.getByRole("list", { name: "Mentioned people", exact: true }),
  ).toContainText(target.name);
  await a11y(page);
  await page.screenshot({
    path: `.local/screenshots/${testInfo.project.name}-chat-mentions.png`,
    fullPage: true,
  });
});

test("an authorized password-only authentication group moderator removes a foreign contribution while foreign DMs remain inaccessible", async ({
  page,
}) => {
  test.setTimeout(90000);
  const token = randomUUID().slice(0, 8),
    owner = await actor(`Mention Group Owner ${token}`, "lecturer"),
    peer = await actor(`Mention Group Peer ${token}`, "lecturer"),
    admin = await actor(`Mention Moderator ${token}`, "admin");
  const ownerApi = await signed(owner),
    peerApi = await signed(peer);
  const room = await checked(
    ownerApi.rpc("create_chat_group", {
      p_title: `Fictional moderated mention group ${token}`,
      p_member_ids: [peer.id, admin.id],
      p_kind: "topic",
    }),
  );
  const body = `Fictional contribution for moderation ${token}`;
  const id = await checked(
    peerApi.rpc("send_message_with_mentions", {
      p_room_id: room,
      p_body: body,
      p_client_id: randomUUID(),
      p_mention_ids: [owner.id],
    }),
  );
  const dm = await checked(ownerApi.rpc("create_dm", { p_user_id: peer.id }));
  const privateText = `Fictional private hidden text ${token}`;
  await checked(
    peerApi.rpc("send_message_with_mentions", {
      p_room_id: dm,
      p_body: privateText,
      p_client_id: randomUUID(),
      p_mention_ids: [owner.id],
    }),
  );
  await adminLogin(page, admin);
  await page.goto(`/chats?room=${room}`);
  const row = page
    .locator(".chat-message")
    .filter({ has: page.getByText(body, { exact: true }) });
  await row
    .getByRole("button", { name: "Gruppenbeitrag moderieren", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Vorgang wird protokolliert");
  await dialog
    .getByRole("button", { name: "Nachricht löschen", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("Diese Nachricht wurde gelöscht.", { exact: true }),
  ).toBeVisible();
  const record = (
    await checked(
      ownerApi.rpc("chat_messages_with_mentions", { p_room_id: room }),
    )
  ).find((message: { id: string }) => message.id === id);
  expect(record.deleted_at).toBeTruthy();
  expect(record.mentions).toEqual([]);
  await page.goto(`/chats?room=${dm}`);
  await expect(
    page.getByText(
      "Diese Unterhaltung ist nicht verfügbar oder du bist kein Mitglied.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(privateText, { exact: true })).toHaveCount(0);
});
