import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  actor,
  adminLogin,
  api,
  checked,
  login,
} from "./helpers/accounts-support";
const isolated = process.env.PORTAL_TEST_MODE === "1";
test.skip(
  !isolated,
  "Scoped picker fixtures belong only to the canonical disposable test project.",
);
test("purpose-scoped choices page real metadata and connect scanned job uploads and participant channels", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const admin = await actor("Fictional picker manager", "admin"),
    learner = await actor("Fictional picker learner", "lecturer");
  const org = randomUUID(),
    template = randomUUID(),
    oldTemplate = randomUUID(),
    runs = Array.from({ length: 65 }, randomUUID).sort(),
    jobs = Array.from({ length: 65 }, randomUUID).sort(),
    duplicate = randomUUID(),
    standalone = randomUUID(),
    prefix = `Fictional picker ${randomUUID().slice(0, 8)}`,
    needle = `${prefix} literal %_ course`;
  const requests: {
    purpose: string;
    search: string;
    cursor: unknown;
    selected: string | null;
  }[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/rest/v1/rpc/job_picker") &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON();
      requests.push({
        purpose: body.p_purpose,
        search: body.p_search,
        cursor: body.p_cursor,
        selected: body.p_selected_id,
      });
    }
  });
  try {
    await checked(
      service.from("organisations").insert({ id: org, name: prefix }),
    );
    await checked(
      service.from("course_templates").insert([
        { id: template, title: `${prefix} general course` },
        { id: oldTemplate, title: needle },
      ]),
    );
    await checked(
      service.from("course_runs").insert(
        runs.map((id, index) => ({
          id,
          template_id: index === 0 ? oldTemplate : template,
          organisation_id: org,
          created_at: "2040-01-01T00:00:00Z",
        })),
      ),
    );
    await checked(
      service.from("course_sessions").insert(
        runs.map((course_run_id, index) => ({
          course_run_id,
          starts_at: new Date(Date.UTC(2060, 0, index + 1, 8)).toISOString(),
          ends_at: new Date(Date.UTC(2060, 0, index + 1, 10)).toISOString(),
        })),
      ),
    );
    await checked(
      service.from("jobs").insert(
        [
          ...jobs.map((id, index) => ({ id, course_run_id: runs[index] })),
          { id: duplicate, course_run_id: runs[0] },
          { id: standalone, course_run_id: null },
        ].map((row, index) => ({
          ...row,
          title: `${prefix} hidden commercial ${index}`,
          customer_name: prefix,
          delivery_type: "online",
          status: "draft",
          amount: 50,
          total_amount: 100,
          currency: "EUR",
          rate_unit: "fixed_total",
          terms: "Fictional private conditions",
          requires_contract: false,
          created_at:
            index >= 65 ? "2041-01-01T00:00:00Z" : "2040-01-01T00:00:00Z",
          created_by: admin.id,
        })),
      ),
    );
    await adminLogin(page, admin);
    await page.goto("/files");
    await page
      .getByRole("button", { name: "Datei hochladen", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Freigabe", { exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    await dialog
      .getByLabel("Freigabe", { exact: true })
      .selectOption("job_after");
    await expect(
      dialog.getByLabel("Auftrag für die Datei", { exact: true }),
    ).toBeVisible();
    const beforeTyping = requests.length;
    await dialog
      .getByLabel("Auftrag oder Kurs suchen", { exact: true })
      .fill(prefix);
    expect(requests).toHaveLength(beforeTyping);
    await dialog
      .getByRole("button", { name: "Auswahl durchsuchen", exact: true })
      .click();
    await expect(
      dialog.getByText("40 Auswahlmöglichkeiten geladen", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", {
        name: "Weitere Auswahlmöglichkeiten laden",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText("67 Auswahlmöglichkeiten geladen", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByLabel("Auftrag für die Datei", { exact: true })
      .selectOption(jobs[0]);
    await dialog.getByLabel("Datei auswählen", { exact: true }).setInputFiles({
      name: "fictional-picker.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Fictional permission-scoped course handout."),
    });
    await dialog
      .getByRole("button", { name: "Datei hochladen", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const stored = await checked(
      service
        .from("documents")
        .select("id,status,scope,job_id")
        .eq("owner_id", admin.id)
        .single(),
    );
    expect(stored.status).toBe("clean");
    expect(stored.scope).toBe("job_after");
    expect(stored.job_id).toBe(jobs[0]);
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.goto("/chats");
    const beforeTopic = requests.length;
    await page
      .getByRole("button", { name: "Create group", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await expect(
      dialog.getByLabel("Group name", { exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(beforeTopic);
    await dialog
      .getByLabel("Group name", { exact: true })
      .fill(`${prefix} participant channel`);
    await dialog
      .getByLabel("Group type", { exact: true })
      .selectOption("participant_course");
    await expect(
      dialog.getByLabel("Course for the participant channel", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByLabel("Search for an offer or course", { exact: true })
      .fill(prefix);
    await dialog
      .getByRole("button", { name: "Search choices", exact: true })
      .click();
    await expect(
      dialog.getByText("40 choices loaded", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", {
        name: "Load more choices",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText("65 choices loaded", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("option", { name: /hidden commercial/ }),
    ).toHaveCount(0);
    await dialog
      .getByLabel("Search for an offer or course", { exact: true })
      .fill(needle);
    await dialog
      .getByRole("button", { name: "Search choices", exact: true })
      .click();
    await expect(
      dialog.getByText("1 choice loaded", { exact: true }),
    ).toBeVisible();
    const courseChoice = dialog.getByLabel(
      "Course for the participant channel",
      {
        exact: true,
      },
    );
    await expect(
      courseChoice.getByRole("option", {
        name: new RegExp(`^${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      }),
    ).toHaveCount(1);
    await courseChoice.selectOption(jobs[0]);
    await expect(
      dialog.getByRole("button", { name: "Create group", exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByLabel("Course for the participant channel", { exact: true }),
    ).toHaveValue(jobs[0]);
    await page.evaluate(() => document.fonts.ready);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations.map((v) => v.id),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("scoped-course-picker.png"),
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Create group", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const channel = await checked(
      service
        .from("chat_rooms")
        .select("course_run_id,job_id")
        .eq("owner_id", admin.id)
        .eq("kind", "participant_course")
        .single(),
    );
    expect(channel.course_run_id).toBe(runs[0]);
    expect(channel.job_id).toBeNull();
    expect(
      requests.some((r) => r.purpose === "job_attachment" && r.cursor),
    ).toBe(true);
    expect(
      requests.some((r) => r.purpose === "participant_course" && r.cursor),
    ).toBe(true);
    const context = await browser.newContext();
    try {
      const ordinary = await context.newPage();
      const privileged: string[] = [];
      ordinary.on("request", (request) => {
        if (request.url().includes("/rpc/job_picker"))
          privileged.push(request.url());
      });
      await login(ordinary, learner.email);
      await ordinary.goto("/files");
      await ordinary
        .getByRole("button", { name: "Datei hochladen", exact: true })
        .click();
      await expect(
        ordinary.getByRole("option", {
          name: "Nach der Übernahme sichtbar",
          exact: true,
        }),
      ).toHaveCount(0);
      await ordinary
        .getByRole("button", { name: "Schließen", exact: true })
        .click();
      await ordinary.goto("/chats");
      await expect(
        ordinary.getByRole("heading", { name: "Chats", exact: true }),
      ).toBeVisible();
      await expect(
        ordinary.getByRole("button", { name: "Gruppe erstellen", exact: true }),
      ).toHaveCount(0);
      expect(privileged).toEqual([]);
    } finally {
      await context.close();
    }
  } finally {
    const rooms = await checked(
      service.from("chat_rooms").select("id").eq("owner_id", admin.id),
    );
    if (rooms.length) {
      const ids = rooms.map((r) => r.id);
      await checked(service.from("chat_members").delete().in("room_id", ids));
      await checked(service.from("chat_rooms").delete().in("id", ids));
    }
    const docs = await checked(
      service.from("documents").select("id").eq("owner_id", admin.id),
    );
    if (docs.length) {
      const ids = docs.map((d) => d.id);
      const versions = await checked(
        service
          .from("document_versions")
          .select("object_path")
          .in("document_id", ids),
      );
      for (const bucket of ["portal-clean", "portal-quarantine"])
        await checked(
          service.storage
            .from(bucket)
            .remove(versions.map((v) => v.object_path)),
        );
      await checked(
        service
          .from("documents")
          .update({ current_version_id: null })
          .in("id", ids),
      );
      await checked(
        service.from("document_versions").delete().in("document_id", ids),
      );
      await checked(service.from("documents").delete().in("id", ids));
    }
    await checked(service.from("jobs").delete().eq("created_by", admin.id));
    await checked(
      service.from("course_sessions").delete().in("course_run_id", runs),
    );
    await checked(
      service.from("course_runs").delete().eq("organisation_id", org),
    );
    await checked(
      service
        .from("course_templates")
        .delete()
        .in("id", [template, oldTemplate]),
    );
    await checked(service.from("organisations").delete().eq("id", org));
    await checked(
      service
        .from("audit_events")
        .delete()
        .in("actor_id", [admin.id, learner.id]),
    );
    for (const person of [learner, admin])
      await checked(service.auth.admin.deleteUser(person.id));
  }
});
