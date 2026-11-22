/** Waiting for an ordinary vacancy must never create an allocation. */
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

test("a lecturer can join and leave the waitlist for a filled offer", async ({
  page,
}) => {
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const assigned = await actor("Fictional assigned lecturer", "lecturer");
  const waiting = await actor("Fictional waiting lecturer", "lecturer");
  const assignedApi = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    assignedApi.auth.signInWithPassword({
      email: assigned.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const job = randomUUID();
  try {
    await checked(
      service.from("jobs").insert({
        id: job,
        title: "Fictional waitlist offer",
        customer_name: "Fictional course company",
        delivery_type: "online",
        status: "published",
        amount: 123,
        total_amount: 123,
        currency: "EUR",
        rate_unit: "fixed_total",
        terms: "Fictional waitlist terms",
        requires_contract: false,
      }),
    );
    await checked(
      service.from("job_sessions").insert({
        job_id: job,
        starts_at: "2047-06-01T08:00:00Z",
        ends_at: "2047-06-01T14:00:00Z",
      }),
    );
    const claim = await checked(
      assignedApi.rpc("claim_job", {
        p_job_id: job,
        p_idempotency_key: randomUUID(),
        p_terms_version: 1,
      }),
    );
    expect(claim.status).toBe("confirmed");

    await login(page, waiting.email);
    await page.goto(`/jobs/${job}`);
    const waitlist = page.getByRole("region", {
      name: "Warteliste",
      exact: true,
    });
    const waitlistResponse = (join: boolean) =>
      page.waitForResponse((response) => {
        if (!new URL(response.url()).pathname.endsWith("/rpc/set_job_waitlist"))
          return false;
        const body = response.request().postDataJSON();
        return body.p_job_id === job && body.p_join === join;
      });
    const joining = waitlistResponse(true);
    await waitlist
      .getByRole("button", { name: "Auf Warteliste setzen", exact: true })
      .click();
    const joined = await joining;
    expect(joined.ok()).toBe(true);
    expect(await joined.json()).toMatchObject({ job_id: job, joined: true });
    await expect(
      waitlist.getByText("Du stehst auf der Warteliste."),
    ).toBeVisible();

    await page.reload();
    await expect(
      waitlist.getByText("Du stehst auf der Warteliste."),
    ).toBeVisible();
    expect(
      await checked(
        service
          .from("assignment_sessions")
          .select("id")
          .eq("lecturer_id", waiting.id),
      ),
    ).toEqual([]);

    const leaving = waitlistResponse(false);
    await waitlist
      .getByRole("button", { name: "Warteliste verlassen", exact: true })
      .click();
    const left = await leaving;
    expect(left.ok()).toBe(true);
    expect(await left.json()).toMatchObject({ job_id: job, joined: false });
    await expect(
      waitlist.getByText("Du stehst auf der Warteliste."),
    ).toHaveCount(0);
  } finally {
    await assignedApi.auth.signOut();
  }
});
