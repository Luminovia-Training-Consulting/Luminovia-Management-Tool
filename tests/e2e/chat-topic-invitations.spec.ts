/** Real isolated Auth/REST and browser consent for private topic-group invitations. */
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Requires the disposable portal test stack.",
);
test("topic owner invites a colleague who must accept before gaining room access", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  const owner = await actor(
    `Fictional owner ${randomUUID().slice(0, 8)}`,
    "lecturer",
  );
  const peer = await actor(
    `Fictional invitee ${randomUUID().slice(0, 8)}`,
    "lecturer",
  );
  const ownerApi = api(process.env.SUPABASE_ANON_KEY!);
  const peerApi = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    ownerApi.auth.signInWithPassword({
      email: owner.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  await checked(
    peerApi.auth.signInWithPassword({
      email: peer.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const title = `Fictional topic ${randomUUID().slice(0, 8)}`;
  const room = await checked(
    ownerApi.rpc("create_chat_group", {
      p_title: title,
      p_member_ids: [],
      p_kind: "topic",
      p_job_id: null,
    }),
    { requireData: true },
  );
  const other = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const receiver = await other.newPage();
    await login(page, owner.email);
    await page.goto(`/chats?room=${room}`);
    await page
      .getByRole("button", { name: "Mitglieder verwalten", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Mitglieder verwalten" });
    await dialog
      .getByLabel("Person auswählen", { exact: true })
      .selectOption(peer.id);
    await dialog
      .getByRole("button", { name: "Einladung senden", exact: true })
      .click();
    await expect(dialog.getByText("Einladung aktualisiert.")).toBeVisible();
    expect(
      (await peerApi.rpc("chat_messages", { p_room_id: room })).error,
    ).toBeTruthy();
    await login(receiver, peer.email);
    await receiver.goto("/chats");
    const inbox = receiver.getByRole("region", { name: "Gruppeneinladungen" });
    await expect(inbox.getByText(title)).toBeVisible();
    await inbox.getByRole("button", { name: "Annehmen", exact: true }).click();
    await expect(receiver).toHaveURL(new RegExp(`/chats\\?room=${room}`));
    expect(
      (await peerApi.rpc("chat_messages", { p_room_id: room })).error,
    ).toBeNull();
    await receiver.reload();
    await expect(receiver.getByRole("heading", { name: title })).toBeVisible();
  } finally {
    await other.close();
  }
});

test("strict topic groups require consent and enforce mode changes against direct additions", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(100_000);
  const tag = randomUUID().slice(0, 8);
  const owner = await actor(`Fictional strict owner ${tag}`, "lecturer");
  const peer = await actor(`Fictional strict invitee ${tag}`, "lecturer");
  const extra = await actor(`Fictional strict extra ${tag}`, "lecturer");
  const ownerApi = api(process.env.SUPABASE_ANON_KEY!);
  const peerApi = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    ownerApi.auth.signInWithPassword({
      email: owner.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  await checked(
    peerApi.auth.signInWithPassword({
      email: peer.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const receiverContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const title = `Fictional strict ${tag}`;
    await login(page, owner.email);
    await page.goto("/chats");
    await page
      .getByRole("button", { name: "Gruppe erstellen", exact: true })
      .click();
    await page.getByLabel("Gruppenname", { exact: true }).fill(title);
    await page
      .getByRole("checkbox", { name: "Nur mit angenommener Einladung" })
      .check();
    await page.getByRole("checkbox", { name: peer.name, exact: true }).check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Gruppe erstellen", exact: true })
      .click();
    await expect(page).toHaveURL(/\/chats\?room=/);
    const room = new URL(page.url()).searchParams.get("room");
    expect(room).toBeTruthy();
    expect(
      (await peerApi.rpc("chat_messages", { p_room_id: room })).error,
    ).toBeTruthy();
    expect(
      (
        await ownerApi.rpc("manage_chat_member", {
          p_room_id: room,
          p_user_id: peer.id,
          p_remove: false,
        })
      ).error,
    ).toBeTruthy();
    await page
      .getByRole("button", { name: "Mitglieder verwalten", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Mitglieder verwalten" });
    await expect(
      dialog.getByText("Nur nach angenommener Einladung"),
    ).toBeVisible();
    await expect(
      dialog.getByLabel("Person hinzufügen", { exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Direkte Aufnahme erlauben" })
      .click();
    await expect(
      dialog.getByLabel("Person hinzufügen", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Einladungsmodus aktivieren" })
      .click();
    await expect(
      dialog.getByLabel("Person hinzufügen", { exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await ownerApi.rpc("manage_chat_member", {
          p_room_id: room,
          p_user_id: extra.id,
          p_remove: false,
        })
      ).error,
    ).toBeTruthy();
    const receiver = await receiverContext.newPage();
    await login(receiver, peer.email);
    await receiver.goto("/chats");
    const inbox = receiver.getByRole("region", { name: "Gruppeneinladungen" });
    await expect(inbox.getByText(title)).toBeVisible();
    await inbox.getByRole("button", { name: "Annehmen", exact: true }).click();
    await expect(receiver).toHaveURL(new RegExp(`/chats\\?room=${room}`));
    expect(
      (await peerApi.rpc("chat_messages", { p_room_id: room })).error,
    ).toBeNull();
  } finally {
    await receiverContext.close();
  }
});
