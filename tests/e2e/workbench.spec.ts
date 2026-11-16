import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";
import { cleanupWorkbenchUsers } from "./helpers/workbench-cleanup";
test("private task editor, bulk state, workflow rows and favourites persist across DE/EN/reload/offline", async ({
  page,
}, testInfo) => {
  const owner = await actor("Fictional workbench lecturer", "lecturer"),
    service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    client = api(process.env.SUPABASE_ANON_KEY!);
  const topic = randomUUID();
  try {
    await checked(
      client.auth.signInWithPassword({
        email: owner.email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    await checked(
      service.from("topics").insert({
        id: topic,
        label_de: "Fictional UI favourite",
        label_en: "Fictional UI favourite",
        kind: "topic",
      }),
    );
    await login(page, owner.email);
    await page.goto("/workbench");
    await expect(
      page.getByRole("heading", { name: "Mein Arbeitsbereich", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Aufgabe erstellen", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Titel", { exact: true })
      .fill("Fictional course follow-up");
    await dialog
      .getByLabel("Beschreibung", { exact: true })
      .fill("Private authored task detail");
    await dialog
      .getByRole("button", { name: "Aufgabe speichern", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("Fictional course follow-up", { exact: true }),
    ).toBeVisible();
    const target = (await checked(client.rpc("work_tasks"))).items.find(
      (item: { title: string }) => item.title === "Fictional course follow-up",
    );
    await page.goto(`/workbench?task=${target.id}`);
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Titel", { exact: true })).toHaveValue(
      "Fictional course follow-up",
    );
    await dialog
      .getByRole("button", { name: "Änderungsverlauf", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("heading", { name: "Änderungsverlauf", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await page
      .getByRole("checkbox", {
        name: "Auswählen: Fictional course follow-up",
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Auswahl erledigen", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            (await checked(client.rpc("work_tasks"))).items as {
              title: string;
              state: string;
            }[]
          ).find((t) => t.title === "Fictional course follow-up")?.state,
      )
      .toBe("done");
    await page
      .getByRole("button", { name: "Vorlage erstellen", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Name der Vorlage", { exact: true })
      .fill("Fictional preparation workflow");
    await dialog
      .getByLabel("Aufgabentitel 1", { exact: true })
      .fill("Check course files");
    await dialog
      .getByRole("button", { name: "Aufgabe ergänzen", exact: true })
      .click();
    await dialog
      .getByLabel("Aufgabentitel 2", { exact: true })
      .fill("Contact client");
    await dialog
      .getByRole("button", { name: "Vorlage speichern", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await page
      .getByRole("button", { name: "Als eigene Aufgaben anlegen", exact: true })
      .click();
    await expect(
      page.getByText("Eigene Aufgaben aus der Vorlage angelegt.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Check course files", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Thema auswählen", { exact: true })
      .selectOption(topic);
    await page
      .getByRole("button", { name: "Favorit hinzufügen", exact: true })
      .click();
    await expect
      .poll(
        async () => (await checked(client.rpc("my_favourites"))).items.length,
      )
      .toBe(1);
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(
      page.getByRole("heading", { name: "My workbench", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("Fictional course follow-up", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("li").getByText("Fictional UI favourite", { exact: true }),
    ).toBeVisible();
    await page.context().setOffline(true);
    await expect(
      page.getByRole("button", { name: "Create task", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Create template", exact: true }),
    ).toBeDisabled();
    await page.context().setOffline(false);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("private-workbench.png"),
      fullPage: true,
    });
  } finally {
    await page.context().setOffline(false);
    await client.auth.signOut();
    await checked(
      service.from("notifications").delete().eq("user_id", owner.id),
    );
    cleanupWorkbenchUsers([owner.id]);
    await checked(service.from("topics").delete().eq("id", topic));
    await checked(
      service.from("audit_events").delete().eq("actor_id", owner.id),
    );
    await checked(service.auth.admin.deleteUser(owner.id));
  }
});
