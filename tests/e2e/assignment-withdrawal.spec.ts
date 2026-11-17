/** Real lecturer/Management withdrawal, inbox and review journeys on the owned QA stack. */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  actor,
  api,
  checked,
  login,
  adminLogin,
} from "./helpers/accounts-support";

/** Remove only this case's validated UUID resources from its canonical disposable project. */
function cleanupWithdrawal(job: string, users: string[]) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
    readFileSync("supabase/config.toml", "utf8"),
  )?.[1];
  if (
    process.env.PORTAL_TEST_MODE !== "1" ||
    !project ||
    !uuid.test(job) ||
    !users.length ||
    !users.every((id) => uuid.test(id))
  )
    throw new Error("Owned withdrawal fixtures required");
  const owners = users.map((id) => `'${id}'`).join(",");
  const sql = `delete from public.notifications where resource_id in(select id from private.assignment_withdrawals where claim_id in(select id from public.job_claims where job_id='${job}'));
    delete from private.assignment_withdrawal_commands where actor_id in(${owners});
    delete from private.assignment_withdrawals where claim_id in(select id from public.job_claims where job_id='${job}');
    delete from private.job_lifecycle_requests where actor_id in(${owners});
    delete from public.notifications where user_id in(${owners});
    delete from public.chat_members where room_id in(select id from public.chat_rooms where job_id='${job}');
    delete from public.chat_rooms where job_id='${job}';
    delete from public.claim_events where claim_id in(select id from public.job_claims where job_id='${job}');
    delete from public.assignment_sessions where claim_id in(select id from public.job_claims where job_id='${job}');
    delete from public.job_claims where job_id='${job}';
    delete from public.job_sessions where job_id='${job}';
    delete from public.jobs where id='${job}';
    delete from public.audit_events where actor_id in(${owners});`;
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
    { input: sql, stdio: ["pipe", "pipe", "pipe"], timeout: 20000 },
  );
}

test("short-notice withdrawal remains assigned until Management reviews it, with DE/EN inbox decisions", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const teacher = await actor("Fictional withdrawal lecturer", "lecturer");
  const manager = await actor("Fictional withdrawal manager", "management");
  const owner = api(process.env.SUPABASE_ANON_KEY!);
  const job = randomUUID();
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  const reviewPage = await context.newPage();
  let originalFailure: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    await checked(
      service.from("jobs").insert({
        id: job,
        title: "Fictional withdrawal teaching block",
        customer_name: "Fictional academy",
        status: "published",
        amount: 150,
        total_amount: 300,
        currency: "EUR",
        rate_unit: "per_day",
        terms: "Immutable fictional withdrawal terms",
        delivery_type: "online",
        time_zone: "Europe/Berlin",
        requires_contract: false,
      }),
    );
    const first = Date.now() + 3 * 86400000;
    await checked(
      service.from("job_sessions").insert(
        [0, 1].map((index) => ({
          job_id: job,
          starts_at: new Date(first + index * 86400000).toISOString(),
          ends_at: new Date(first + index * 86400000 + 3600000).toISOString(),
        })),
      ),
    );
    await checked(
      owner.auth.signInWithPassword({
        email: teacher.email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    const claim = await checked(
      owner.rpc("claim_job", {
        p_job_id: job,
        p_idempotency_key: randomUUID(),
        p_terms_version: 1,
      }),
    );
    expect(claim.status).toBe("confirmed");
    await login(page, teacher.email);
    await page.goto(`/jobs/${job}`);
    const own = page.getByRole("region", {
      name: "Vom Auftrag zurücktreten",
      exact: true,
    });
    await expect(
      own.getByRole("button", { name: "Rücktritt beantragen", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Zuweisung stornieren", exact: true }),
    ).not.toBeVisible();
    await page.context().setOffline(true);
    await expect(
      own.getByRole("button", { name: "Rücktritt beantragen", exact: true }),
    ).toBeDisabled();
    await page.context().setOffline(false);
    await own
      .getByRole("button", { name: "Rücktritt beantragen", exact: true })
      .click();
    const application = page.getByRole("dialog");
    await expect(
      application.getByRole("button", { name: "Antrag absenden", exact: true }),
    ).toBeDisabled();
    await application
      .getByLabel("Begründung", { exact: true })
      .fill("Fictional private reason requiring coverage review");
    await application
      .getByRole("button", { name: "Antrag absenden", exact: true })
      .click();
    await expect(application).not.toBeVisible();
    await expect(
      own.getByRole("status").filter({ hasText: "In Prüfung" }).first(),
    ).toBeVisible();
    expect(
      (
        await checked(
          owner
            .from("assignment_sessions")
            .select("released_at")
            .eq("claim_id", claim.claim_id),
        )
      ).every((session) => session.released_at === null),
    ).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-withdrawal-pending-de-light.png`,
      fullPage: true,
    });
    await adminLogin(reviewPage, manager);
    await reviewPage.goto("/notifications");
    const requestNote = reviewPage
      .locator("#main .notification-row")
      .filter({ hasText: "Rücktritt beantragt" });
    await requestNote
      .getByRole("link", { name: "Öffnen", exact: true })
      .click();
    await expect(reviewPage).toHaveURL(new RegExp(`/jobs/${job}$`));
    let review = reviewPage.getByRole("region", {
      name: "Vom Auftrag zurücktreten",
      exact: true,
    });
    await review
      .getByRole("button", { name: "Antrag ablehnen", exact: true })
      .click();
    const decision = reviewPage.getByRole("dialog");
    await decision
      .getByLabel("Entscheidungsbegründung", { exact: true })
      .fill("Fictional review: no replacement coverage yet");
    await decision
      .getByRole("button", { name: "Antrag ablehnen", exact: true })
      .click();
    await expect(decision).not.toBeVisible();
    await page.goto("/notifications");
    const rejected = page
      .locator("#main .notification-row")
      .filter({ hasText: "Rücktrittsantrag abgelehnt" });
    await rejected.getByRole("link", { name: "Öffnen", exact: true }).click();
    await expect(
      own.getByText("Fictional review: no replacement coverage yet", {
        exact: false,
      }),
    ).toBeVisible();
    expect(
      (
        await checked(
          owner
            .from("job_claims")
            .select("status")
            .eq("id", claim.claim_id)
            .single(),
        )
      ).status,
    ).toBe("confirmed");
    await own
      .getByRole("button", { name: "Rücktritt beantragen", exact: true })
      .click();
    await application
      .getByLabel("Begründung", { exact: true })
      .fill("Fictional revised reason; coverage now arranged");
    await application
      .getByRole("button", { name: "Antrag absenden", exact: true })
      .click();
    await expect(application).not.toBeVisible();
    await reviewPage.reload();
    await reviewPage.getByLabel("Sprache", { exact: true }).selectOption("en");
    await reviewPage.getByLabel("Theme", { exact: true }).selectOption("dark");
    review = reviewPage.getByRole("region", {
      name: "Withdraw from assignment",
      exact: true,
    });
    await review
      .getByRole("button", { name: "Approve withdrawal", exact: true })
      .click();
    await decision
      .getByLabel("Decision note", { exact: true })
      .fill("Fictional review: complete replacement coverage confirmed");
    await decision
      .getByRole("button", { name: "Approve withdrawal", exact: true })
      .click();
    await expect(decision).not.toBeVisible();
    await expect(
      review.getByText("Withdrawal approved", { exact: true }).first(),
    ).toBeVisible();
    await reviewPage.evaluate(() => document.fonts.ready);
    expect(
      (
        await new AxeBuilder({ page: reviewPage })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await reviewPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await reviewPage.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-withdrawal-approved-en-dark.png`,
      fullPage: true,
    });
    await page.goto("/notifications");
    await expect(
      page
        .locator("#main .notification-row")
        .filter({ hasText: "Rücktritt genehmigt" }),
    ).toBeVisible();
    expect(
      (
        await checked(
          owner
            .from("job_claims")
            .select("status")
            .eq("id", claim.claim_id)
            .single(),
        )
      ).status,
    ).toBe("cancelled");
    const released = await checked(
      owner
        .from("assignment_sessions")
        .select("released_at")
        .eq("claim_id", claim.claim_id),
    );
    expect(released).toHaveLength(2);
    expect(released.every((session) => session.released_at !== null)).toBe(
      true,
    );
  } catch (error) {
    originalFailure = error;
  } finally {
    await page.context().setOffline(false);
    await context.close();
    try {
      cleanupWithdrawal(job, [teacher.id, manager.id]);
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const user of [teacher, manager]) {
      try {
        await checked(service.auth.admin.deleteUser(user.id));
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    await owner.auth.signOut();
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      originalFailure ? [originalFailure, ...cleanupErrors] : cleanupErrors,
      "Scoped withdrawal browser cleanup failed",
    );
  if (originalFailure) throw originalFailure;
});
