/** Exercise the actual scanner, lecturer and finance browser workflow on an owned stack. */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { actor, api, checked, login } from "./helpers/accounts-support";

const fictionalReceipt = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7eoAAAAASUVORK5CYII=",
  "base64",
);

test("an expense receipt scans, receives partial approval and is reimbursed once", async ({ page }) => {
  test.setTimeout(90_000);
  const container = process.env.PORTAL_DB_CONTAINER;
  if (process.env.PORTAL_TEST_MODE !== "1" || !container || !/^supabase_db_luminovia-portal-test-[a-f0-9]+$/.test(container))
    throw new Error("Expense fixtures require the owned disposable portal");
  const lecturer = await actor("Fictional expense lecturer", "lecturer");
  const reviewer = await actor("Fictional expense reviewer", "admin");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const job = randomUUID(), claim = randomUUID(), session = randomUUID();
  const title = "Fictional expense course " + job.slice(0, 6);
  const started = new Date(Date.now() - 86_400_000);
  const ended = new Date(started.getTime() + 3_600_000);
  try {
    await checked(service.from("jobs").insert({
      id: job, title, customer_name: "Fictional customer", delivery_type: "online",
      amount: 350, currency: "EUR", rate_unit: "fixed_total", total_amount: 350, terms: "Fictional QA",
    }));
    await checked(service.from("job_claims").insert({
      id: claim, job_id: job, lecturer_id: lecturer.id, idempotency_key: randomUUID(),
      amount: 350, currency: "EUR", rate_unit: "fixed_total", total_amount: 350, terms: "Fictional QA", terms_version: 1,
    }));
    await checked(service.from("assignment_sessions").insert({
      id: session, claim_id: claim, lecturer_id: lecturer.id,
      starts_at: started.toISOString(), ends_at: ended.toISOString(),
    }));
    await login(page, lecturer.email);
    await page.getByLabel(/^(Sprache|Language)$/).selectOption("de");
    await page.goto("/finance");
    const confirmation = page.waitForEvent("download");
    await page.getByRole("row").filter({hasText: title}).getByRole("button", {name: "Auftragsbestätigung als PDF"}).click();
    const confirmationPath = await (await confirmation).path();
    expect((await readFile(confirmationPath!)).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    await page.getByText("Auslagen und Erstattungen", { exact: true }).click();
    await page.getByRole("button", { name: "Auslage einreichen" }).click();
    const submission = page.getByRole("dialog", { name: "Auslage einreichen" });
    await submission.getByLabel("Lehrauftrag").selectOption(claim);
    await submission.getByLabel("Unterrichtstermin").selectOption(session);
    await submission.getByLabel("Betrag", { exact: true }).fill("123,40");
    await submission.getByLabel("Auslagendatum").fill(started.toISOString().slice(0, 10));
    await submission.getByLabel("Beschreibung").fill("Fictional transit receipt");
    await expect(submission.getByRole("button", { name: "Auslage einreichen" })).toBeDisabled();
    const upload = page.waitForResponse((response) => new URL(response.url()).searchParams.get("mode") === "expense-receipt" && response.request().method() === "POST");
    await submission.getByLabel("Belegdatei auswählen").setInputFiles({
      name: "fictional-expense.png", mimeType: "image/png", buffer: fictionalReceipt,
    });
    expect((await upload).ok()).toBe(true);
    await expect(submission.getByText("fictional-expense.png", { exact: true })).toBeVisible();
    await submission.getByRole("button", { name: "Auslage einreichen" }).click();
    await expect(page.getByText("Auslage gespeichert.", { exact: true })).toBeVisible();
    await expect(page.locator(".expense-list").getByText("Eingereicht", { exact: true })).toBeVisible();

    const reviewerPage = await page.context().browser()!.newPage({ baseURL: process.env.E2E_BASE_URL });
    try {
      await login(reviewerPage, reviewer.email);
      await reviewerPage.getByLabel(/^(Sprache|Language)$/).selectOption("de");
      await reviewerPage.goto("/admin/finance");
      await reviewerPage.getByText("Auslagen und Erstattungen", { exact: true }).click();
      const row = reviewerPage.getByRole("listitem").filter({ hasText: title });
      await row.getByRole("button", { name: "Auslage prüfen" }).click();
      const review = reviewerPage.getByRole("dialog", { name: "Auslage prüfen" });
      const downloaded = reviewerPage.waitForEvent("download");
      await review.getByRole("button", { name: "Beleg herunterladen" }).click();
      expect(await readFile((await (await downloaded).path())!)).toEqual(fictionalReceipt);
      await review.getByLabel("Genehmigter Betrag (EUR)").fill("84,50");
      await review.getByLabel("Begründung").fill("Fictional partial approval");
      await review.getByRole("button", { name: "Genehmigen" }).click();
      await expect(row.getByText("Genehmigt", { exact: true })).toBeVisible();
      await row.getByRole("button", { name: "Erstattung und Rechnung" }).click();
      const reimburse = reviewerPage.getByRole("dialog", { name: "Erstattung und Rechnung" });
      await reimburse.getByLabel("Zahlungsreferenz").fill("Fictional payment");
      await reimburse.getByRole("button", { name: "Erstattung erfassen" }).click();
      await expect(row.getByText("Erstattet", { exact: true })).toBeVisible();
      await reviewerPage.getByRole("row").filter({hasText: title}).getByRole("button", {name: "Auftrag abrechnen und abgleichen"}).click();
      const reconciled = reviewerPage.getByRole("dialog", {name: "Auftrag abrechnen und abgleichen"});
      await expect(reconciled.getByText("Vereinbartes Honorar", {exact: true})).toBeVisible();
      await expect(reconciled.getByText(/84,50/)).toBeVisible();
      await reconciled.getByRole("button",{name: "Schließen", exact: true}).click();
      await row.getByRole("button", { name: "Erstattung und Rechnung" }).click();
      await expect(reimburse.getByRole("button", { name: "Erstattung erfassen" })).toHaveCount(0);
    } finally {
      await reviewerPage.context().close();
    }
    await page.reload();
    await page.getByText("Auslagen und Erstattungen", { exact: true }).click();
    await expect(page.locator(".expense-list").getByText("Erstattet", { exact: true })).toBeVisible();
  } finally {
    const documents = await checked(service.from("documents").select("id,current_version_id").eq("owner_id", lecturer.id).eq("kind", "expense_receipt"));
    for (const document of documents ?? []) {
      await service.storage.from("portal-clean").remove([lecturer.id + "/" + document.id + "/" + document.current_version_id]);
    }
    // Only exact IDs from this isolated test are removed. Private ledger tables
    // deliberately have no service Data API grant.
    execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
      input: [
        "begin;",
        "delete from private.lecturer_expense_commands where expense_id in (select id from private.lecturer_expenses where lecturer_id = '" + lecturer.id + "');",
        "update private.expense_receipt_reservations set expense_id=null where owner_id='" + lecturer.id + "';",
        "delete from private.lecturer_expenses where lecturer_id='" + lecturer.id + "';",
        "delete from public.assignment_sessions where id='" + session + "';",
        "delete from public.job_claims where id='" + claim + "';",
        "delete from public.jobs where id='" + job + "';",
        "commit;",
      ].join("\n"),
    });
    if (documents?.length) {
      const ids = documents.map(({ id }) => id);
      await service.from("documents").update({ current_version_id: null }).in("id", ids);
      await service.from("document_versions").delete().in("document_id", ids);
      await service.from("documents").delete().in("id", ids);
    }
    await service.auth.admin.deleteUser(lecturer.id);
    await service.auth.admin.deleteUser(reviewer.id);
  }
});
