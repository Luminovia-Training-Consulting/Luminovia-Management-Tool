import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { actor, api, checked, login } from "./helpers/accounts-support";

test("complete replacement acceptance uses current terms, survives reload, and remains private online", async ({
  page,
}, testInfo) => {
  const original = await actor("Fictional original lecturer", "lecturer"),
    candidate = await actor("Fictional replacement lecturer", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    client = api(process.env.SUPABASE_ANON_KEY!),
    job = randomUUID();
  const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
    readFileSync("supabase/config.toml", "utf8"),
  )?.[1];
  expect(project).toBeTruthy();
  try {
    await checked(
      service.from("jobs").insert({
        id: job,
        title: `Fictional browser replacement ${job}`,
        customer_name: "Fictional browser organisation",
        delivery_type: "online",
        status: "published",
        amount: 110,
        total_amount: 220,
        currency: "EUR",
        rate_unit: "per_day",
        terms: "Fictional complete block conditions",
        created_by: original.id,
      }),
    );
    await checked(
      service.from("job_sessions").insert(
        [1, 2].map((n) => ({
          job_id: job,
          starts_at: `2042-02-0${n}T08:00:00Z`,
          ends_at: `2042-02-0${n}T10:00:00Z`,
        })),
      ),
    );
    await checked(
      client.auth.signInWithPassword({
        email: original.email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    const claim = await checked(
      client.rpc("claim_job", {
        p_job_id: job,
        p_idempotency_key: randomUUID(),
        p_terms_version: 1,
      }),
    );
    expect(claim.status).toBe("confirmed");
    await checked(
      client.rpc("request_replacement", {
        p_claim_id: claim.claim_id,
        p_reason: "Fictional scheduling problem",
        p_mode: "open",
        p_invited_user_ids: [],
        p_emergency: true,
        p_request_id: randomUUID(),
      }),
    );
    await login(page, candidate.email);
    await page.goto("/replacements");
    const card = page.locator(".replacement-card").filter({ hasText: job });
    await expect(card).toBeVisible();
    await expect(card.getByText("Fictional scheduling problem")).toHaveCount(0);
    const take = card.getByRole("button", {
      name: "Gesamten Block übernehmen",
      exact: true,
    });
    await expect(take).toBeDisabled();
    await card.getByRole("checkbox").check();
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(card.getByRole("checkbox")).toBeChecked();
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.evaluate(() => document.fonts.ready);
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
      path: testInfo.outputPath("replacement-offer.png"),
      fullPage: true,
    });
    await card
      .getByRole("button", { name: "Claim the complete block", exact: true })
      .click();
    await expect(
      card.getByText(
        "Handover confirmed online. All sessions have been allocated.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.reload();
    await expect(
      page
        .locator(".replacement-card")
        .filter({ hasText: job })
        .getByText("Handed over", { exact: true }),
    ).toBeVisible();
    await page.context().setOffline(true);
    await expect(
      page.getByText("Fictional complete block conditions", { exact: true }),
    ).toHaveCount(0);
    await page.context().setOffline(false);
  } finally {
    await page.context().setOffline(false);
    const users = [original.id, candidate.id].map((id) => `'${id}'`).join(",");
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
        input: `delete from private.replacement_requests where actor_id in(${users});delete from private.replacement_offers where original_claim_id in(select id from public.job_claims where job_id='${job}');delete from public.notifications where user_id in(${users});delete from public.chat_members where room_id in(select id from public.chat_rooms where job_id='${job}');delete from public.chat_rooms where job_id='${job}';delete from public.claim_events where claim_id in(select id from public.job_claims where job_id='${job}');delete from public.assignment_sessions where claim_id in(select id from public.job_claims where job_id='${job}');delete from public.job_claims where job_id='${job}';delete from public.jobs where id='${job}';delete from public.audit_events where actor_id in(${users});`,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    await checked(service.auth.admin.deleteUser(original.id));
    await checked(service.auth.admin.deleteUser(candidate.id));
  }
});
