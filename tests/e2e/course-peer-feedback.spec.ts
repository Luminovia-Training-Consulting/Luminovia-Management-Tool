/** A real scoped peer round exchanges anonymous text and releases moderated feedback. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
  test.setTimeout(180_000);
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
    service.from("course_runs").insert({
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
    expect(Object.keys(current).sort()).toEqual([
      "attachment",
      "body",
      "feedback",
      "scores",
    ]);

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
    const assignmentId = randomUUID();
    const criterion = "Reproduce the result with another file";
    const assignmentTitle = "Fictional peer assessment rubric";
    const assignmentCommand = (
      action: string,
      version: number,
      payload: object,
    ) =>
      checked(
        admin.client.rpc("course_assignment_action", {
          p_run_id: run,
          p_assignment_id: assignmentId,
          p_action: action,
          p_payload: payload,
          p_expected_version: version,
        }),
        { requireData: true },
      );
    await assignmentCommand("save", 0, {
      title: assignmentTitle,
      instructions: "Describe the procedure and its outcome.",
      due_at: new Date(Date.now() + 86_400_000).toISOString(),
      max_attempts: 1,
      rubric: [
        {
          label: criterion,
          levels: [
            { label: "Missing", points: 0 },
            { label: "Documented", points: 1 },
          ],
        },
      ],
    });
    await assignmentCommand("publish", 1, {});
    await page.reload();
    await staffPanel.getByText("Peerfeedback", { exact: true }).click();
    await staffPanel.getByText("Neue Feedbackrunde", { exact: true }).click();
    const secondPrompt = "Review a second example with independent entries";
    await staffPanel
      .getByLabel("Bewertungskriterien übernehmen")
      .selectOption({ label: `${assignmentTitle} · Version 1` });
    await staffPanel
      .getByLabel("Bewertungsstufen mit Punkten verwenden")
      .check();
    await staffPanel
      .getByLabel("Aufgabenstellung für den Austausch")
      .fill(secondPrompt);
    await staffPanel
      .getByRole("button", { name: "Runde öffnen", exact: true })
      .click();
    await expect.poll(async () => (await state(admin)).round_number).toBe(2);

    await learnerPage.reload();
    await learnerPanel.getByText("Peerfeedback", { exact: true }).click();
    const round = learnerPanel.getByLabel("Feedbackrunde", { exact: true });
    await expect(
      learnerPanel.getByText(secondPrompt, { exact: true }),
    ).toBeVisible();
    await expect(learnerPanel.getByLabel("Dein Beitrag")).toHaveValue("");
    await expect(
      learnerPanel.getByText(criterion, { exact: true }),
    ).toBeVisible();
    await round.press("End");
    await expect(
      learnerPanel.getByRole("heading", { name: "Erhaltene Rückmeldung" }),
    ).toBeVisible();
    await expect(round).toBeFocused();
    const axe = await new AxeBuilder({ page: learnerPage })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await round.press("Home");
    await expect(learnerPanel.getByLabel("Dein Beitrag")).toHaveValue("");

    const bytes = Buffer.from(
      "Fictional UTF-8 attachment with anonymised evidence.\n",
    );
    const entryBody = "A new reproducible example for scored review";
    await learnerPanel.getByLabel("Dein Beitrag").fill(entryBody);
    await learnerPanel.getByLabel("Anhang (optional)").setInputFiles({
      name: "fictional-personal-name.txt",
      mimeType: "text/plain",
      buffer: bytes,
    });
    await learnerPanel
      .getByRole("button", { name: "Beitrag speichern und teilnehmen" })
      .click();
    await expect(
      learnerPanel.getByText("Beitrag wartet auf Prüfung."),
    ).toBeVisible();
    const exactVersion = (await state(learners[0])).own_entry.attachment
      .version_id;
    for (const [index, learner] of learners.entries()) {
      if (index > 0)
        await command(learner, "entry", {
          round: 2,
          body: registration[index],
          revision: 0,
        });
    }

    await page.reload();
    await staffPanel.getByText("Peerfeedback", { exact: true }).click();
    const attachmentReview = staffPanel
      .getByRole("listitem")
      .filter({ hasText: entryBody });
    const moderatorDownload = page.waitForEvent("download");
    await attachmentReview
      .getByRole("button", { name: "Textdatei herunterladen" })
      .click();
    const moderatorFile = await moderatorDownload;
    expect(moderatorFile.suggestedFilename()).toBe("peer-attachment.txt");
    expect(await readFile((await moderatorFile.path())!)).toEqual(bytes);
    for (const body of [entryBody, ...registration.slice(1)]) {
      const entry = staffPanel.getByRole("listitem").filter({ hasText: body });
      await entry.getByRole("button", { name: "Beitrag freigeben" }).click();
      await expect(entry.getByText("Beitrag geprüft.")).toBeVisible();
    }
    await staffPanel
      .getByRole("button", { name: "Peerzuordnung starten" })
      .click();
    await expect.poll(async () => (await state(admin)).stage).toBe("reviewing");
    const reviewers = await Promise.all(
      learners.map((learner) => state(learner)),
    );
    const reviewer =
      learners[
        reviewers.findIndex(
          ({ assignment }) =>
            assignment?.attachment?.version_id === exactVersion,
        )
      ];
    expect(reviewer?.id).not.toBe(learners[0].id);
    expect(reviewer).toBeDefined();
    const reviewContext = await browser.newContext({
      baseURL,
      viewport: info.project.use.viewport,
      isMobile: info.project.use.isMobile,
      hasTouch: info.project.use.hasTouch,
    });
    try {
      const reviewPage = await reviewContext.newPage();
      await login(reviewPage, reviewer.email, /\/learning$/);
      await reviewPage.goto(workspace);
      const peerReview = reviewPage.locator("details").filter({
        has: reviewPage.getByText("Peerfeedback", { exact: true }),
      });
      await peerReview.getByText("Peerfeedback", { exact: true }).click();
      await expect(
        peerReview.getByText(entryBody, { exact: true }),
      ).toBeVisible();
      await expect(
        peerReview.getByText("fictional-personal-name.txt"),
      ).toHaveCount(0);
      const matchedDownload = reviewPage.waitForEvent("download");
      await peerReview
        .getByRole("button", { name: "Textdatei herunterladen" })
        .click();
      const anonymousFile = await matchedDownload;
      expect(anonymousFile.suggestedFilename()).toBe("peer-attachment.txt");
      expect(await readFile((await anonymousFile.path())!)).toEqual(bytes);
      const scoredFeedback = "The example is complete and reproducible";
      await peerReview.getByLabel("Deine Rückmeldung").fill(scoredFeedback);
      const submit = peerReview.getByRole("button", {
        name: "Rückmeldung zur Prüfung abgeben",
      });
      await expect(submit).toBeDisabled();
      await peerReview.getByLabel(criterion, { exact: true }).selectOption("1");
      await submit.click();
      await expect(peerReview.getByText("1 von 1 Punkten")).toBeVisible();
      expect((await state(learners[0])).received).toBeNull();
      await page.reload();
      await staffPanel.getByText("Peerfeedback", { exact: true }).click();
      const scoredReview = staffPanel
        .getByRole("listitem")
        .filter({ hasText: scoredFeedback });
      await expect(scoredReview.getByText("1 von 1 Punkten")).toBeVisible();
      await scoredReview
        .getByRole("button", { name: "Rückmeldung freigeben" })
        .click();
      await staffPanel
        .getByRole("button", { name: "Geprüfte Rückmeldungen veröffentlichen" })
        .click();
      await expect
        .poll(async () => (await state(learners[0])).received?.scores)
        .toEqual([1]);

      await learnerPage.reload();
      await learnerPanel.getByText("Peerfeedback", { exact: true }).click();
      await expect(learnerPanel.getByText("1 von 1 Punkten")).toBeVisible();
      const releasedAxe = await new AxeBuilder({ page: learnerPage })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(releasedAxe.violations).toEqual([]);
      const { error } = await reviewer.client.rpc(
        "course_peer_feedback_attachment",
        {
          p_run_id: run,
          p_round_number: 2,
          p_version_id: exactVersion,
        },
      );
      expect(error?.code).toBe("42501");
    } finally {
      await reviewContext.close();
    }
  } finally {
    await learnerContext.close();
  }
});
