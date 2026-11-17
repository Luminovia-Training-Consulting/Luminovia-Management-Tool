/** Actual browser journey on a disposable QA stack: scoped company decisions and a learner's whole-course cancellation. */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { actor, api, checked, login } from "./helpers/accounts-support";

/** Direct fixture SQL is restricted to the current random QA container and UUID-only IDs. */
function fixtureSql(sql: string, ids: string[]) {
  if (
    process.env.PORTAL_TEST_MODE !== "1" ||
    !ids.every((id) => /^[0-9a-f-]{36}$/.test(id))
  )
    throw new Error("Disposable fixture IDs required");
  const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
    readFileSync("supabase/config.toml", "utf8"),
  )?.[1];
  if (!project) throw new Error("Canonical QA project required");
  return execFileSync(
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
    { input: sql, encoding: "utf8", timeout: 20000 },
  );
}

/** Exercise the same accessible page at real desktop/mobile viewport sizes. */
async function accessible(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    report.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("company confirms and rejects a lecturer; participant cancels the whole course", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const admin = await actor("Fictional decision manager", "admin");
  const company = await actor("Fictional decision company", "client");
  const teacher = await actor("Fictional decision lecturer", "lecturer");
  const learner = await actor("Fictional decision participant", "participant");
  const users = [admin.id, company.id, teacher.id, learner.id];
  const [org, template, run, job, claim] = Array.from(
    { length: 5 },
    randomUUID,
  );
  const ids = [...users, org, template, run, job, claim];
  const allUsers = users.map((id) => `'${id}'`).join(",");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const mobile = test.info().project.name === "mobile-chromium";
  const learnerContext = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
    isMobile: mobile,
    hasTouch: mobile,
  });
  try {
    fixtureSql(
      `insert into public.organisations(id,name) values('${org}','Fictional decision company');
      insert into public.client_organisation_memberships(user_id,organisation_id) values('${company.id}','${org}');
      insert into public.course_templates(id,title) values('${template}','Fictional browser course');
      insert into public.course_runs(id,template_id,organisation_id) values('${run}','${template}','${org}');
      insert into public.course_sessions(course_run_id,starts_at,ends_at) values('${run}',now()+interval '8 days',now()+interval '8 days 1 hour'),('${run}',now()+interval '9 days',now()+interval '9 days 1 hour');
      insert into public.course_enrolments(course_run_id,user_id,enrolled_by) values('${run}','${learner.id}','${admin.id}');
      insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values('${job}','${run}','Fictional browser assignment','Fictional decision company','online','filled',100,'EUR','fixed_total',100,'Fictional terms');
      insert into public.job_sessions(job_id,starts_at,ends_at) values('${job}',now()+interval '8 days',now()+interval '8 days 1 hour');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values('${claim}','${job}','${teacher.id}','${randomUUID()}',100,'EUR','fixed_total',100,'Fictional terms',1);
      insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values('${claim}','${teacher.id}',now()+interval '8 days',now()+interval '8 days 1 hour');`,
      ids,
    );
    await login(page, company.email);
    await page.goto("/client");
    const decision = page.getByRole("region", {
      name: "Dozierende bestätigen",
    });
    await expect(decision).toContainText("Fictional decision lecturer");
    await expect(decision).toContainText("Entscheidung offen");
    await accessible(page);
    await decision
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await expect(decision).toContainText("Bestätigt");
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    const english = page.getByRole("region", { name: "Confirm lecturers" });
    await expect(english).toContainText("Accepted");
    await english.getByRole("button", { name: "Reject", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reject", exact: true })
      .click();
    await expect(english).toHaveCount(0);
    expect(
      fixtureSql(
        `select status from public.job_claims where id='${claim}'`,
        ids,
      ).trim(),
    ).toBe("cancelled");
    expect(
      fixtureSql(
        `select status from public.jobs where id='${job}'`,
        ids,
      ).trim(),
    ).toBe("published");
    const learnerPage = await learnerContext.newPage();
    await login(learnerPage, learner.email);
    await learnerPage.goto(`/courses/${run}/workspace`);
    const cancel = learnerPage.getByRole("region", {
      name: "Kursteilnahme stornieren",
    });
    await expect(cancel).toContainText("sieben Tage");
    await accessible(learnerPage);
    await learnerPage.getByLabel("Sprache", { exact: true }).selectOption("en");
    const cancelEnglish = learnerPage.getByRole("region", {
      name: "Cancel course enrolment",
    });
    await expect(cancelEnglish).toContainText("seven days");
    await cancelEnglish
      .getByRole("button", { name: "Cancel course enrolment", exact: true })
      .click();
    await cancelEnglish
      .getByRole("button", {
        name: "Confirm cancellation of entire enrolment",
        exact: true,
      })
      .click();
    await expect(learnerPage).toHaveURL(/\/learning$/);
    expect(
      fixtureSql(
        `select status from public.course_enrolments where course_run_id='${run}' and user_id='${learner.id}'`,
        ids,
      ).trim(),
    ).toBe("removed");
  } finally {
    await learnerContext.close();
    fixtureSql(
      `delete from private.company_lecturer_decisions where claim_id='${claim}';
      delete from private.job_lifecycle_requests where actor_id in(${allUsers});
      delete from public.notifications where user_id in(${allUsers});
      delete from public.audit_events where actor_id in(${allUsers});
      delete from public.claim_events where claim_id='${claim}';
      delete from public.assignment_sessions where claim_id='${claim}';
      delete from public.job_claims where id='${claim}';
      delete from public.job_sessions where job_id='${job}';
      delete from public.jobs where id='${job}';
      delete from public.course_enrolments where course_run_id='${run}';
      delete from public.course_sessions where course_run_id='${run}';
      delete from public.course_runs where id='${run}';
      delete from public.course_templates where id='${template}';
      delete from public.client_organisation_memberships where user_id='${company.id}';
      delete from public.organisations where id='${org}';`,
      ids,
    );
    for (const id of users) await checked(service.auth.admin.deleteUser(id));
  }
});
