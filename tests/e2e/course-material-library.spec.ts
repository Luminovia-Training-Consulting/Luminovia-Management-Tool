import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { actor, adminLogin, api, checked } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Requires disposable portal and scanner services.",
);

test("master materials can be archived, restored and copied into a different scanned course share", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const manager = await actor("Fictional library manager", "admin");
  const admin = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    admin.auth.signInWithPassword({
      email: manager.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const organisation = randomUUID();
  const [source, destination] = [randomUUID(), randomUUID()];
  const [sourceTemplate, destinationTemplate] = [randomUUID(), randomUUID()];
  const suffix = source.slice(0, 8);
  const filename = `Master-archive-${suffix}.txt`;
  const bytes = Buffer.from(
    "Fictional scanned teaching material for catalogue independence.",
  );

  await checked(
    service.from("organisations").insert({
      id: organisation,
      name: "Fictional material library organisation",
    }),
  );
  await checked(
    service.from("course_templates").insert([
      { id: sourceTemplate, title: `Source course ${suffix}` },
      { id: destinationTemplate, title: `Destination course ${suffix}` },
    ]),
  );
  await checked(
    service.from("course_runs").insert([
      {
        id: source,
        template_id: sourceTemplate,
        organisation_id: organisation,
        time_zone: "Europe/Berlin",
      },
      {
        id: destination,
        template_id: destinationTemplate,
        organisation_id: organisation,
        time_zone: "Europe/Berlin",
      },
    ]),
  );
  await checked(
    admin.rpc("set_company_premium", {
      p_organisation_id: organisation,
      p_enabled: true,
      p_expected_version: 0,
      p_request_id: randomUUID(),
    }),
  );

  await adminLogin(page, manager);
  await page.goto(`/courses/${source}/workspace#course-materials`);
  const sourcePanel = page.getByRole("region", {
    name: "Kursdateien",
    exact: true,
  });
  await sourcePanel
    .getByLabel("Datei auswählen", { exact: true })
    .setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: bytes,
    });
  await sourcePanel
    .getByRole("button", { name: "Datei prüfen und freigeben" })
    .click();
  await expect(sourcePanel.getByText(filename, { exact: true })).toBeVisible({
    timeout: 45_000,
  });

  await page.goto("/learning?view=materials");
  const library = page.getByRole("region", {
    name: "Kursmaterialien",
    exact: true,
  });
  const entry = library
    .getByRole("listitem")
    .filter({ has: page.getByText(filename, { exact: true }) });
  const filter = library.getByLabel("Dokumentart", { exact: true });
  await entry
    .getByText("Bibliothekseintrag verwalten", { exact: true })
    .click();
  await entry
    .getByRole("button", { name: "Als Materialvorlage markieren" })
    .click();
  await expect(library.getByText("Materialvorlage markiert.")).toBeVisible();
  await filter.selectOption("master");
  await expect(entry).toBeVisible();
  await entry
    .getByText("Bibliothekseintrag verwalten", { exact: true })
    .click();
  await entry
    .getByRole("button", { name: "In der Bibliothek archivieren" })
    .click();
  await expect(
    library.getByText("Der Bibliothekseintrag wurde archiviert."),
  ).toBeVisible();
  await expect(filter).toBeFocused();
  await expect(entry).toHaveCount(0);
  await filter.selectOption("archived");
  await expect(entry).toBeVisible();
  await entry
    .getByText("Bibliothekseintrag verwalten", { exact: true })
    .click();
  await entry
    .getByRole("button", { name: "In der Bibliothek wiederherstellen" })
    .click();
  await expect(
    library.getByText("Der Bibliothekseintrag wurde wiederhergestellt."),
  ).toBeVisible();
  await filter.selectOption("master");
  await entry
    .getByRole("button", { name: "In weiterem Kurs verwenden" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("checkbox", { name: "Datei als unabhängige Kopie übernehmen" })
    .check();
  await dialog
    .getByLabel("Zielkurs", { exact: true })
    .selectOption(destination);
  await dialog
    .getByRole("button", { name: "Kopie erstellen und freigeben" })
    .click();
  await expect(
    dialog.getByText("Die Kopie ist im Zielkurs freigegeben."),
  ).toBeVisible({ timeout: 45_000 });
  await dialog.getByRole("link").click();
  const targetPanel = page.getByRole("region", {
    name: "Kursdateien",
    exact: true,
  });
  await expect(targetPanel.getByText(filename, { exact: true })).toBeVisible();

  const documents = await checked(
    service
      .from("documents")
      .select("id,current_version_id,status")
      .eq("owner_id", manager.id)
      .eq("original_name", filename),
    { requireData: true },
  );
  expect(documents).toHaveLength(2);
  expect(
    new Set(documents.map(({ current_version_id }) => current_version_id)).size,
  ).toBe(2);
  expect(documents.every(({ status }) => status === "clean")).toBe(true);
  const versionIds = documents.map(
    ({ current_version_id }) => current_version_id,
  );
  const versions = await checked(
    service
      .from("document_versions")
      .select("sha256,status")
      .in("id", versionIds),
    { requireData: true },
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  expect(versions).toEqual([
    { sha256: digest, status: "clean" },
    { sha256: digest, status: "clean" },
  ]);
  const downloadPromise = page.waitForEvent("download");
  await targetPanel.getByRole("button", { name: "Herunterladen" }).click();
  const downloaded = await downloadPromise;
  expect(await readFile((await downloaded.path())!)).toEqual(bytes);
});
