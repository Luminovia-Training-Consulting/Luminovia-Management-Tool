/** Exercise the actual Control Center task handoff in both browser layouts. */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

test("delegates a staffing issue and opens the shared task after a reload", async ({
  page,
}) => {
  const container = process.env.PORTAL_DB_CONTAINER;
  if (
    process.env.PORTAL_TEST_MODE !== "1" ||
    !container ||
    !/^supabase_db_luminovia-portal-test-[a-f0-9]+$/.test(container)
  ) {
    throw new Error("Escalation fixtures require the owned disposable portal");
  }
  const owner = await actor("Fictional training manager", "admin");
  const reviewer = await actor("Fictional training reviewer", "management");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const template = randomUUID();
  const course = randomUUID();
  const title = `Fictional staffing review ${course.slice(0, 8)}`;
  const start = Date.now() + 25 * 3_600_000;
  const deadline = new Date(start - 3_600_000).toISOString().slice(0, 16);
  try {
    await checked(
      service.from("profiles").update({ time_zone: "UTC" }).eq("id", owner.id),
    );
    await checked(
      service.from("course_templates").insert({ id: template, title }),
    );
    await checked(
      service
        .from("course_runs")
        .insert({ id: course, template_id: template, published: true }),
    );
    await checked(
      service.from("course_sessions").insert({
        course_run_id: course,
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(start + 3_600_000).toISOString(),
      }),
    );
    await login(page, owner.email);
    await page.getByLabel(/^(Sprache|Language)$/).selectOption("de");
    await page.getByLabel(/^(Farbschema|Theme)$/).selectOption("dark");
    await page.goto("/control-center");
    await page
      .getByText("Kursbetrieb und Forderungen", { exact: true })
      .click();
    await page
      .getByRole("button", {
        name: new RegExp(title + " eskalieren.*Besetzung"),
      })
      .click();
    const dialog = page.getByRole("dialog", { name: "Eskalieren" });
    await dialog
      .getByLabel("Zuständig", { exact: true })
      .selectOption(reviewer.id);
    await dialog.getByLabel("Frist (UTC)", { exact: true }).fill(deadline);
    await dialog
      .getByLabel("Nächster Schritt", { exact: true })
      .fill("Vertretung für den Kursstart abstimmen");
    await dialog
      .getByRole("button", { name: "Eskalieren", exact: true })
      .click();
    const link = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: title, exact: true }) })
      .filter({ hasText: "Besetzung unvollständig" })
      .getByRole("link", { name: "Aufgabe ansehen" });
    await expect(link).toHaveAttribute("href", /^\/workbench\?escalation=/);
    const target = await link.getAttribute("href");
    await page.reload();
    await page
      .getByText("Kursbetrieb und Forderungen", { exact: true })
      .click();
    await expect(link).toHaveAttribute("href", target!);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await link.click();
    await expect(
      page.getByText("Vertretung für den Kursstart abstimmen", {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "In Arbeit nehmen" }).click();
    await expect(
      page.getByText("Status gespeichert.", { exact: true }),
    ).toBeVisible();
  } finally {
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        input: `begin;
        delete from public.notifications where user_id='${reviewer.id}' and kind='task_assigned';
        delete from private.work_task_history where task_id in (select id from private.work_tasks where creator_id='${owner.id}');
        delete from private.work_tasks where creator_id='${owner.id}';
        delete from public.course_sessions where course_run_id='${course}';
        delete from public.course_runs where id='${course}';
        delete from public.course_templates where id='${template}';
        commit;`,
      },
    );
    await checked(service.auth.admin.deleteUser(owner.id));
    await checked(service.auth.admin.deleteUser(reviewer.id));
  }
});
