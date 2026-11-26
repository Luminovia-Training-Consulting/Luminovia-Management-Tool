/** A real scoped peer round exchanges anonymous text and releases moderated feedback. */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Peer feedback requires the isolated Auth and REST fixture.",
);

async function authenticatedActor(name: string, role: string) {
  const account = await actor(name, role);
  const client = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    client.auth.signInWithPassword({
      email: account.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  return { ...account, client };
}

test("approved anonymous peer feedback reaches only its assigned recipient", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const admin = await authenticatedActor("Fictional peer moderator", "admin");
  const company = await authenticatedActor("Fictional peer contact", "client");
  const learners = await Promise.all(
    [1, 2, 3].map((index) =>
      authenticatedActor(`Fictional peer ${index}`, "participant"),
    ),
  );
  const organisation = randomUUID();
  const template = randomUUID();
  const run = randomUUID();
  const suffix = run.slice(0, 8);
  await checked(
    service
      .from("organisations")
      .insert({ id: organisation, name: `Fictional peers ${suffix}` }),
  );
  await checked(
    service
      .from("client_organisation_memberships")
      .insert({ user_id: company.id, organisation_id: organisation }),
  );
  await checked(
    service
      .from("course_templates")
      .insert({ id: template, title: `Fictional peer exercise ${suffix}` }),
  );
  await checked(
    service
      .from("course_runs")
      .insert({
        id: run,
        template_id: template,
        organisation_id: organisation,
        published: true,
      }),
  );
  await checked(
    admin.client.rpc("set_company_premium", {
      p_organisation_id: organisation,
      p_enabled: true,
      p_expected_version: 0,
      p_request_id: randomUUID(),
    }),
  );
  for (const learner of learners) {
    const profile = await checked(
      service
        .from("profiles")
        .select("luminovia_user_id")
        .eq("id", learner.id)
        .single(),
      { requireData: true },
    );
    await checked(
      company.client.rpc("request_company_participant_link", {
        p_organisation_id: organisation,
        p_luminovia_user_id: profile.luminovia_user_id,
        p_request_id: randomUUID(),
      }),
    );
    const invitations = await checked(
      learner.client.rpc("my_company_participant_invitations"),
      { requireData: true },
    );
    const invitation = invitations.find(
      (value: { organisation_id: string }) =>
        value.organisation_id === organisation,
    );
    await checked(
      learner.client.rpc("accept_company_participant_invitation", {
        p_organisation_id: organisation,
        p_expected_version: invitation.version,
        p_request_id: randomUUID(),
      }),
    );
    await checked(
      admin.client.rpc("manage_course_enrolment", {
        p_course_run_id: run,
        p_user_id: learner.id,
        p_status: "enrolled",
      }),
    );
  }

  const command = (who: typeof admin, action: string, payload: object = {}) =>
    checked(
      who.client.rpc("course_peer_feedback_action", {
        p_run_id: run,
        p_action: action,
        p_payload: payload,
      }),
      { requireData: true },
    );
  const state = (who: typeof admin) =>
    checked(who.client.rpc("course_peer_feedback", { p_run_id: run }), {
      requireData: true,
    });
  await command(admin, "open", {
    body: "Describe a safe and reliable file check",
  });

  const workspace = `/courses/${run}/workspace#course-learning`;
  const registration = learners.map(
    (_, index) => `Fictional contribution ${index + 1}`,
  );
  const learnerContext = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const learnerPage = await learnerContext.newPage();
    await login(learnerPage, learners[0].email, /\/learning$/);
    await learnerPage.goto(workspace);
    const learnerPanel = learnerPage
      .locator("details")
      .filter({ has: learnerPage.getByText("Peerfeedback", { exact: true }) });
    await learnerPanel.getByText("Peerfeedback", { exact: true }).click();
    await learnerPanel.getByLabel("Dein Beitrag").fill(registration[0]);
    await learnerPanel
      .getByRole("button", { name: "Beitrag speichern und teilnehmen" })
      .click();
    await expect(
      learnerPanel.getByText("Beitrag wartet auf Prüfung."),
    ).toBeVisible();

    for (const [index, learner] of learners.entries()) {
      if (index > 0)
        await command(learner, "entry", {
          body: registration[index],
          revision: 0,
        });
    }

    await login(page, admin.email);
    await page.goto(workspace);
    const staffPanel = page
      .locator("details")
      .filter({ has: page.getByText("Peerfeedback", { exact: true }) });
    await staffPanel.getByText("Peerfeedback", { exact: true }).click();
    for (const body of registration) {
      const entry = staffPanel.getByRole("listitem").filter({ hasText: body });
      await entry.getByRole("button", { name: "Beitrag freigeben" }).click();
      await expect(entry.getByText("Beitrag geprüft.")).toBeVisible();
    }
    await staffPanel
      .getByRole("button", { name: "Peerzuordnung starten" })
      .click();
    await expect.poll(async () => (await state(admin)).stage).toBe("reviewing");
    const current = (await state(learners[0])).assignment;
    const recipientIndex = registration.indexOf(current.body);
    expect(recipientIndex).toBeGreaterThan(0);
    expect(Object.keys(current).sort()).toEqual(["body", "feedback"]);

    await learnerPage.reload();
    await learnerPanel.getByText("Peerfeedback", { exact: true }).click();
    await expect(
      learnerPanel.getByText(current.body, { exact: true }),
    ).toBeVisible();
    const feedback = "The steps can be replayed with another file";
    await learnerPanel.getByLabel("Deine Rückmeldung").fill(feedback);
    await learnerPanel
      .getByRole("button", { name: "Rückmeldung zur Prüfung abgeben" })
      .click();
    await expect(
      learnerPanel.getByText(feedback, { exact: true }),
    ).toBeVisible();

    expect((await state(learners[recipientIndex])).received).toBeNull();
    await page.reload();
    await staffPanel.getByText("Peerfeedback", { exact: true }).click();
    await staffPanel
      .getByRole("button", { name: "Rückmeldung freigeben" })
      .click();
    await staffPanel
      .getByRole("button", { name: "Geprüfte Rückmeldungen veröffentlichen" })
      .click();
    await expect
      .poll(
        async () => (await state(learners[recipientIndex])).received?.feedback,
      )
      .toBe(feedback);
    expect((await state(learners[0])).received).toBeNull();
  } finally {
    await learnerContext.close();
  }
});
