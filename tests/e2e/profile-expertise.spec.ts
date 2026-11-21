/** Verify self-declared skills through the real profile, database and authorized people directory. */
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Profile expertise writes require the isolated ./portal test project.",
);

test("lecturers can add expertise without attestation and find it after reload", async ({
                                                                                            page,
                                                                                        }) => {
    const lecturer = await actor(
            `Fictional expertise lecturer ${randomUUID().slice(0, 8)}`,
            "lecturer",
        ),
        service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        topic = randomUUID(),
        label = `Fictional expertise ${randomUUID().slice(0, 8)}`;

    try {
        await checked(
            service.from("topics").insert({
                id: topic,
                kind: "topic",
                label_de: label,
                label_en: label,
            }),
        );
        await login(page, lecturer.email);
        await page.goto("/profile");
        const option = page.locator(".expertise-option").filter({hasText: label}),
            checkbox = option.getByRole("checkbox");
        await expect(checkbox).not.toBeChecked();
        // This controlled input changes only after the server confirms the save.
        await checkbox.click();
        await expect(checkbox).toBeChecked();
        await expect(option).toContainText(
            /Als Expertise angegeben|Declared expertise/,
        );

        const declaration = await checked(
            service
                .from("lecturer_topics")
                .select("verified,valid_until")
                .eq("user_id", lecturer.id)
                .eq("topic_id", topic)
                .single(),
        );
        expect(declaration).toEqual({verified: false, valid_until: null});

        await page.reload();
        await expect(
            page
                .locator(".expertise-option")
                .filter({hasText: label})
                .getByRole("checkbox"),
        ).toBeChecked();
        await page.goto("/people");
        await page.getByLabel("Thema filtern", {exact: true}).selectOption(topic);
        const card = page
            .locator(".person-card")
            .filter({hasText: lecturer.name});
        await expect(card).toBeVisible();
        await expect(card.getByText("Luminovia User ID")).toBeVisible();
        await expect(card.locator(".public-user-id code")).toHaveText(
            /^LV-[0-9A-F]{4}(?:-[0-9A-F]{4}){4}$/,
        );
    } finally {
        await checked(
            service.from("lecturer_topics").delete().eq("user_id", lecturer.id),
        );
        await checked(service.from("topics").delete().eq("id", topic));
        await checked(service.auth.admin.deleteUser(lecturer.id));
    }
});
