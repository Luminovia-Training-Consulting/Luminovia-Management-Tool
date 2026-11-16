/** Real waitlist/substitution UI acceptance with exact server receipts.
 * Filled jobs deliberately deny their full detail while the independent reduced
 * waitlist remains usable; cleanup must not replace an original action failure.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

test("waitlisted lecturer explicitly accepts a complete immutable substitution online in DE/EN", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const original = await actor("Fictional handover UI original", "lecturer");
  const replacement = await actor(
    "Fictional handover UI replacement",
    "lecturer",
  );
  const originalApi = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    originalApi.auth.signInWithPassword({
      email: original.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const job = randomUUID();
  await checked(
    service.from("jobs").insert({
      id: job,
      title: "Fictional complete substitution block",
      customer_name: "Fictional handover UI academy",
      delivery_type: "online",
      location: "https://example.invalid/course",
      status: "published",
      amount: 123,
      total_amount: 615,
      currency: "EUR",
      rate_unit: "per_day",
      terms: "Immutable fictional handover terms",
      requires_contract: false,
    }),
  );
  await checked(
    service.from("job_sessions").insert(
      Array.from({ length: 5 }, (_, n) => ({
        job_id: job,
        starts_at: `2047-06-${String(n + 1).padStart(2, "0")}T08:00:00Z`,
        ends_at: `2047-06-${String(n + 1).padStart(2, "0")}T14:00:00Z`,
      })),
    ),
  );
  const source = await checked(
    originalApi.rpc("claim_job", {
      p_job_id: job,
      p_idempotency_key: randomUUID(),
      p_terms_version: 1,
    }),
  );
  expect(source.status).toBe("confirmed");
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  const other = await context.newPage();
  let failed = false;
  let originalFailure: unknown;
  let cleanupErrors: unknown[];
  try {
    await login(other, replacement.email);
    await other.goto(`/jobs/${job}`);
    const waitlist = other.getByRole("region", {
      name: "Warteliste",
      exact: true,
    });
    const joinedResponse = other.waitForResponse((response) => {
      if (!new URL(response.url()).pathname.endsWith("/rpc/set_job_waitlist"))
        return false;
      const input = response.request().postDataJSON();
      return input.p_job_id === job && input.p_join === true;
    });
    await waitlist
      .getByRole("button", { name: "Auf Warteliste setzen", exact: true })
      .click();
    const joined = await joinedResponse;
    expect(joined.ok()).toBe(true);
    expect(await joined.json()).toMatchObject({ job_id: job, joined: true });
    await expect(
      waitlist.getByText("Du stehst auf der Warteliste.", { exact: true }),
    ).toBeVisible();
    expect(
      await checked(
        service
          .from("assignment_sessions")
          .select("id")
          .eq("lecturer_id", replacement.id),
      ),
    ).toEqual([]);
    await login(page, original.email);
    await page.goto(`/jobs/${job}`);
    const handover = page.getByRole("region", {
      name: "Vertretung organisieren",
      exact: true,
    });
    await handover.getByRole("button", { name: /Vertretung suchen/ }).click();
    await handover
      .getByLabel("Lehrkraft suchen", { exact: true })
      .fill(replacement.name);
    await handover
      .getByLabel("Vertretung auswählen", { exact: true })
      .selectOption(replacement.id);
    await handover
      .getByLabel("Grund der Vertretungsanfrage", { exact: true })
      .fill("Fictional teaching substitute requested");
    await handover
      .getByRole("button", { name: "Vertretung anfragen", exact: true })
      .click();
    await expect(
      handover.getByText(
        "Die Vertretungsanfrage wurde gespeichert. Deine Zuweisung besteht weiterhin.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      (
        await checked(
          service
            .from("job_claims")
            .select("status")
            .eq("id", source.claim_id)
            .single(),
        )
      ).status,
    ).toBe("confirmed");
    await other.goto("/jobs");
    const inbox = other.getByRole("region", {
      name: "Deine Vertretungsanfragen",
      exact: true,
    });
    await expect(
      inbox.getByText("Immutable fictional handover terms", { exact: true }),
    ).toBeVisible();
    await expect(inbox.locator("article > ol > li")).toHaveCount(5);
    await other.getByLabel("Sprache", { exact: true }).selectOption("en");
    const english = other.getByRole("region", {
      name: "Your substitution requests",
      exact: true,
    });
    const accept = english.getByRole("button", {
      name: "Accept substitution now",
      exact: true,
    });
    await expect(accept).toBeDisabled();
    await english
      .getByRole("checkbox", {
        name: "I accept these terms and all displayed sessions as one complete teaching block.",
        exact: true,
      })
      .check();
    await context.setOffline(true);
    await expect(accept).toBeDisabled();
    await context.setOffline(false);
    await expect(accept).toBeEnabled();
    await accept.click();
    await expect(
      english.getByText(
        "The substitution is confirmed. All sessions transferred together.",
        { exact: true },
      ),
    ).toBeVisible();
    const accepted = await checked(
      service
        .from("job_claims")
        .select("id,status,total_amount,terms")
        .eq("job_id", job)
        .eq("lecturer_id", replacement.id)
        .single(),
    );
    expect(accepted.status).toBe("confirmed");
    expect(accepted.total_amount).toBe(615);
    expect(accepted.terms).toBe("Immutable fictional handover terms");
    expect(
      (
        await checked(
          service
            .from("assignment_sessions")
            .select("id")
            .eq("claim_id", accepted.id)
            .is("released_at", null),
        )
      ).length,
    ).toBe(5);
    expect(
      await checked(
        service
          .from("job_claims")
          .select("status,total_amount,terms")
          .eq("id", source.claim_id)
          .single(),
      ),
    ).toEqual({
      status: "cancelled",
      total_amount: 615,
      terms: "Immutable fictional handover terms",
    });
    await other.reload();
    await expect(
      other
        .getByRole("region", {
          name: "Your substitution requests",
          exact: true,
        })
        .getByText("Substitution confirmed", { exact: false }),
    ).toBeVisible();
    await other.evaluate(() => document.fonts.ready);
    expect(
      (
        await new AxeBuilder({ page: other })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations.map((v) => v.id),
    ).toEqual([]);
    expect(
      await other.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await other.screenshot({
      path: testInfo.outputPath("substitution-confirmed.png"),
      fullPage: true,
    });
  } catch (error) {
    failed = true;
    originalFailure = error;
  } finally {
    // Playwright may already dispose a context after a failed action. Attempt
    // every owned cleanup, but retain that original failure rather than replace
    // it with a later context-close protocol error.
    const offline = await Promise.allSettled([context.setOffline(false)]);
    const closed = await Promise.allSettled([
      context.close(),
      originalApi.auth.signOut(),
    ]);
    cleanupErrors = [...offline, ...closed].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
  }
  if (failed) throw originalFailure;
  if (cleanupErrors.length)
    throw new AggregateError(
      cleanupErrors,
      "Owned substitution context cleanup failed",
    );
});
