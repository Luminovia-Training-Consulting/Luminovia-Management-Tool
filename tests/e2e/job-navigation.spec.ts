/** Real actor-scoped job-to-course/chat/calendar navigation on the disposable stack. */
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Requires the isolated portal test environment.",
);
test("opens only the assigned course, member chat and own assignment calendar", async ({
                                                                                           page,
                                                                                       }) => {
    test.setTimeout(100_000);
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const teacher = await actor(
        "Fictional assigned navigation teacher",
        "lecturer",
    );
    const job = randomUUID(),
        run = randomUUID(),
        template = randomUUID(),
        session = randomUUID(),
        claim = randomUUID(),
        room = randomUUID();
    const start = "2051-06-03T08:00:00Z",
        end = "2051-06-03T10:00:00Z";
    const title = `Fictional navigation ${randomUUID().slice(0, 8)}`;
    await checked(
        service.from("course_templates").insert({id: template, title}),
    );
    await checked(
        service
            .from("course_runs")
            .insert({id: run, template_id: template, time_zone: "Europe/Berlin"}),
    );
    await checked(
        service.from("jobs").insert({
            id: job,
            course_run_id: run,
            title,
            customer_name: "Fictional organisation",
            delivery_type: "online",
            status: "published",
            amount: 100,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Fictional agreed terms",
        }),
    );
    await checked(
        service
            .from("job_sessions")
            .insert({id: session, job_id: job, starts_at: start, ends_at: end}),
    );
    await checked(
        service.from("job_claims").insert({
            id: claim,
            job_id: job,
            lecturer_id: teacher.id,
            idempotency_key: randomUUID(),
            status: "confirmed",
            amount: 100,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Fictional agreed terms",
            terms_version: 1,
        }),
    );
    await checked(
        service.from("assignment_sessions").insert({
            claim_id: claim,
            lecturer_id: teacher.id,
            starts_at: start,
            ends_at: end,
        }),
    );
    await checked(
        service.from("chat_rooms").insert({
            id: room,
            job_id: job,
            kind: "lecturer_course",
            owner_id: teacher.id,
            title: "Fictional course chat",
        }),
    );
    await checked(
        service.from("chat_members").insert({room_id: room, user_id: teacher.id}),
    );
    await login(page, teacher.email);
    await page.goto(`/jobs/${job}`);
    const course = page.getByRole("link", {
        name: "Kursarbeitsraum öffnen",
        exact: true,
    });
    const chat = page.getByRole("link", {
        name: "Dozierenden-Chat öffnen",
        exact: true,
    });
    await expect(course).toHaveAttribute("href", `/courses/${run}/workspace`);
    await expect(chat).toHaveAttribute("href", `/chats?room=${room}`);
    await chat.click();
    await expect(page).toHaveURL(new RegExp(`/chats\\?room=${room}`));
    await expect(
        page.getByRole("heading", {name: "Fictional course chat", exact: true}),
    ).toBeVisible();
    await page.goto(`/jobs/${job}`);
    await page.getByRole("link", {name: "Zum Kalender", exact: true}).click();
    await expect(page).toHaveURL(new RegExp(`/calendar\\?assignment=${job}`));
    const assignment = page.locator(".calendar-panel")
        .getByRole("link")
        .filter({hasText: title});
    await expect(assignment).toBeVisible();
    await expect(assignment).toHaveAttribute("href", `/jobs/${job}`);
    await page.goto(`/jobs/${job}`);
    await checked(
        service
            .from("chat_members")
            .update({removed_at: new Date().toISOString()})
            .eq("room_id", room)
            .eq("user_id", teacher.id),
    );
    await page.reload();
    await expect(
        page.getByRole("link", {name: "Kursarbeitsraum öffnen", exact: true}),
    ).toBeVisible();
    await expect(
        page.getByRole("link", {name: "Dozierenden-Chat öffnen", exact: true}),
    ).toHaveCount(0);
});
