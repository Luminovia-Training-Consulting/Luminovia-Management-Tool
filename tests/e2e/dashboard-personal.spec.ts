/** Own daily teaching preview and private preferences using only the canonical disposable Auth/SQL fixture. */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { api, actor, checked, login } from "./helpers/accounts-support";

/** Seed only this test's explicit course shares; object-transfer acceptance stays in the real scanner/gateway suite. */
function seedTeachingContext(ids: {
  run: string;
  contact: string;
  teacher: string;
  doc: string;
  version: string;
  resource: string;
}) {
  if (
    process.env.PORTAL_TEST_MODE !== "1" ||
    !Object.values(ids).every((id) =>
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id),
    )
  )
    throw new Error("Exact disposable teaching context required");
  const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
    readFileSync("supabase/config.toml", "utf8"),
  )?.[1];
  if (!project) throw new Error("Canonical disposable database required");
  const { run, contact, teacher, doc, version, resource } = ids;
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      `supabase_db_${project}`,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `insert into private.course_workspace_settings(run_id,contact_id)values('${run}','${contact}');insert into private.course_preparation_items(run_id,label,done)values('${run}','Fictional agreed preparation',true),('${run}','Fictional remaining preparation',false);insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values('${doc}','${teacher}','${teacher}','personal','material','Agreed daily V1.pdf','application/pdf',10,'clean','${resource}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values('${version}','${doc}','${teacher}','${resource}',1,'fictional/${version}','Agreed daily V1.pdf','application/pdf',10,'clean','${"a".repeat(64)}');update public.documents set current_version_id='${version}' where id='${doc}';insert into private.course_resources(id,run_id,version_id,audience,category,created_by)values('${resource}','${run}','${version}','staff','material','${teacher}');`,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20000,
    },
  );
}

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Personal dashboard writes require the canonical disposable project.",
);
test("personal cards and teaching preparation persist in the real account across reload and language", async ({
  page,
  context,
}, testInfo) => {
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const teacher = await actor("Fictional teaching day UI lecturer", "lecturer");
  const job = randomUUID(),
    claim = randomUUID(),
    session = randomUUID(),
    org = randomUUID(),
    contact = randomUUID(),
    template = randomUUID(),
    run = randomUUID(),
    doc = randomUUID(),
    version = randomUUID(),
    resource = randomUUID(),
    suffix = randomUUID().slice(0, 8);
  const starts = DateTime.now()
    .setZone("Europe/Berlin")
    .startOf("day")
    .plus({ hours: 9 });
  await checked(
    service
      .from("organisations")
      .insert({ id: org, name: "Fictional course contact academy" }),
  );
  await checked(
    service.from("organisation_contacts").insert({
      id: contact,
      organisation_id: org,
      name: "Explicit daily course contact",
      email: "daily@example.invalid",
      phone: "+49 40 123",
      notes: "Private daily note never shown",
    }),
  );
  await checked(
    service
      .from("course_templates")
      .insert({ id: template, title: "Fictional daily shared curriculum" }),
  );
  await checked(
    service
      .from("course_runs")
      .insert({ id: run, template_id: template, organisation_id: org }),
  );
  seedTeachingContext({
    run,
    contact,
    teacher: teacher.id,
    doc,
    version,
    resource,
  });
  // Fix course provenance on initial insertion, before the accepted claim.
  await checked(
    service.from("jobs").insert({
      id: job,
      course_run_id: run,
      title: `Fictional teaching day ${suffix}`,
      customer_name: "Fictional teaching day academy",
      delivery_type: "online",
      status: "filled",
      location: "https://example.invalid/class",
      amount: 100,
      currency: "EUR",
      rate_unit: "fixed_total",
      total_amount: 100,
      terms: "Fictional whole course terms",
    }),
  );
  await checked(
    service.from("job_claims").insert({
      id: claim,
      job_id: job,
      lecturer_id: teacher.id,
      idempotency_key: randomUUID(),
      amount: 100,
      currency: "EUR",
      rate_unit: "fixed_total",
      total_amount: 100,
      terms: "Fictional whole course terms",
      terms_version: 1,
    }),
  );
  await checked(
    service.from("assignment_sessions").insert({
      id: session,
      claim_id: claim,
      lecturer_id: teacher.id,
      starts_at: starts.toUTC().toISO()!,
      ends_at: starts.plus({ hours: 1 }).toUTC().toISO()!,
    }),
  );
  await login(page, teacher.email);
  let teaching = page.getByRole("region", {
    name: "Mein Unterrichtstag",
    exact: true,
  });
  await expect(
    teaching.getByRole("link", {
      name: `Fictional teaching day ${suffix}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    teaching.getByRole("link", { name: "Unterrichtslink öffnen", exact: true }),
  ).toHaveAttribute("href", "https://example.invalid/class");
  await expect(
    teaching.getByRole("link", { name: "daily@example.invalid", exact: true }),
  ).toHaveAttribute("href", "mailto:daily%40example.invalid");
  await expect(
    teaching.getByRole("link", { name: "+49 40 123", exact: true }),
  ).toHaveAttribute("href", "tel:+4940123");
  await expect(
    teaching.getByText("1 von 2 Vorbereitungspunkten erledigt", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    teaching.getByRole("link", { name: "Agreed daily V1.pdf", exact: true }),
  ).toHaveAttribute("href", `/courses/${run}/workspace`);
  await expect(
    teaching.getByText("Private daily note never shown", { exact: true }),
  ).toHaveCount(0);
  const ready = teaching.getByRole("checkbox", {
    name: "Unterlagen geprüft und vorbereitet",
    exact: true,
  });
  // The committed checklist changes only after its real save and refetch.
  // check() requires an immediate DOM toggle; click then await confirmation.
  await ready.click();
  await expect(ready).toBeEnabled();
  await expect(ready).toBeChecked();
  await page
    .getByRole("button", { name: "Dashboard anpassen", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Zuletzt hinzugefügte Dateien",
      exact: true,
    })
    .uncheck();
  await page
    .getByRole("button", {
      name: "Mein Unterrichtstag nach unten",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Dashboard speichern", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Dashboard speichern", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  teaching = page.getByRole("region", {
    name: "Mein Unterrichtstag",
    exact: true,
  });
  await expect(
    teaching.getByRole("checkbox", {
      name: "Unterlagen geprüft und vorbereitet",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("region", {
      name: "Zuletzt hinzugefügte Dateien",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".dashboard-widgets > .dashboard-widget-slot")
      .first()
      .getByRole("region", { name: "Nachrichten & Meldungen", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(
    teaching.getByRole("checkbox", {
      name: "Unterrichtslink oder Raum geprüft",
      exact: true,
    }),
  ).toBeDisabled();
  await context.setOffline(false);
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  const english = page.getByRole("region", {
    name: "My teaching day",
    exact: true,
  });
  await expect(
    english.getByRole("checkbox", {
      name: "Materials reviewed and prepared",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    english.getByRole("checkbox", {
      name: "Teaching link or room checked",
      exact: true,
    }),
  ).toBeEnabled();
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
    scan.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: `.local/screenshots/${testInfo.project.name}-dashboard-personal.png`,
    fullPage: true,
  });
});
