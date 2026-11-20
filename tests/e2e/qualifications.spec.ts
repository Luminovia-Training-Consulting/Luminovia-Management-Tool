import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Only canonical disposable project fixtures.",
);

async function fixture() {
    const suffix = randomUUID().slice(0, 8),
        teacher = await actor(`Evidence Teacher ${suffix}`, "lecturer"),
        manager = await actor(`Evidence Manager ${suffix}`, "management"),
        service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        topic = randomUUID();
    await checked(
        service.from("topics").insert({
            id: topic,
            label_de: `Belegthema ${suffix}`,
            label_en: `Evidence topic ${suffix}`,
            kind: "topic",
        }),
    );
    const own = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
        own.auth.signInWithPassword({
            email: teacher.email,
            password: process.env.E2E_PASSWORD!,
        }),
    );
    await checked(
        own
            .from("lecturer_topics")
            .insert({user_id: teacher.id, topic_id: topic}),
    );

    async function upload(name: string, bytes: string, replace?: string) {
        const {session} = await checked(own.auth.getSession());
        const form = new FormData();
        form.set("file", new File([bytes], name, {type: "text/plain"}));
        form.set("scope", "personal");
        form.set("kind", "certificate");
        form.set("client_id", randomUUID());
        if (replace) form.set("replace_id", replace);
        const response = await fetch(
            `${process.env.SUPABASE_URL}/functions/v1/files`,
            {
                method: "POST",
                headers: {
                    Origin: new URL(process.env.E2E_BASE_URL!).origin,
                    Authorization: `Bearer ${session!.access_token}`,
                    apikey: process.env.SUPABASE_ANON_KEY!,
                },
                body: form,
            },
        );
        expect(response.status).toBe(200);
        return (await response.json()).document as {
            id: string;
            current_version_id: string;
        };
    }

    return {suffix, teacher, manager, topic, own, upload};
}

async function accessible(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const result = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(result.violations).toEqual([]);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
}

test("explicit own certificate consent, exact V1 manager download after V2, evidence decision and history", async ({
                                                                                                                       page,
                                                                                                                   }) => {
    test.setTimeout(100000);
    const f = await fixture(),
        filename = `Original-${f.suffix}.txt`,
        bytes = "Fictional actual original evidence V1.";
    const doc = await f.upload(filename, bytes);
    await login(page, f.teacher.email);
    await page.goto("/profile");
    await page
        .getByLabel("Ausgewähltes Thema", {exact: true})
        .selectOption(f.topic);
    const panel = page.locator(".qualification-evidence");
    await panel
        .getByRole("button", {name: "Zertifikatsversion auswählen", exact: true})
        .click();
    await panel
        .getByRole("button", {
            name: `Auswählen: ${filename}, Version 1`,
            exact: true,
        })
        .click();
    const share = panel.getByRole("button", {
        name: "Version freigeben",
        exact: true,
    });
    await expect(share).toBeDisabled();
    await panel
        .getByRole("checkbox", {
            name: "Ich gebe genau diese Zertifikatsversion für die Qualifikationsprüfung durch berechtigtes Management frei.",
            exact: true,
        })
        .check();
    await share.click();
    await expect(
        panel.getByText("Die Freigabe wurde gespeichert.", {exact: true}),
    ).toBeVisible();
    await f.upload(
        `Replacement-${f.suffix}.txt`,
        "Fictional different replacement V2.",
        doc.id,
    );
    await page.reload();
    await page
        .getByLabel("Ausgewähltes Thema", {exact: true})
        .selectOption(f.topic);
    await expect(
        page
            .locator(".qualification-evidence")
            .getByText(filename, {exact: true}),
    ).toBeVisible();
    await accessible(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await adminLogin(page, f.manager);
    await page.goto(`/admin/people?user=${f.teacher.id}`);
    await page
        .getByRole("button", {
            name: "Beleg und Prüfverlauf anzeigen",
            exact: true,
        })
        .click();
    const review = page.locator(".qualification-evidence");
    await expect(review.getByText(filename, {exact: true})).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await review
        .getByRole("button", {
            name: "Freigegebene Version herunterladen",
            exact: true,
        })
        .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(filename);
    const stream = await download.createReadStream(),
        chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe(bytes);
    await review
        .getByLabel("Gültig bis (UTC)", {exact: true})
        .fill("2045-01-01T00:00");
    await review
        .getByRole("button", {name: "Mit diesem Beleg verifizieren", exact: true})
        .click();
    await expect(
        review.getByText("Die beleggebundene Verifikation wurde bestätigt.", {
            exact: true,
        }),
    ).toBeVisible();
    await review
        .getByRole("button", {name: "Prüfverlauf", exact: true})
        .click();
    await expect(
        review.getByText(/Prüfung der freigegebenen Zertifikatsversion/),
    ).toBeVisible();
    await accessible(page);
});

test("withdrawn topic evidence stays unavailable and does not alter an existing verification", async ({
                                                                                                          page,
                                                                                                      }) => {
    test.setTimeout(90000);
    const f = await fixture(),
        filename = `Withdraw-${f.suffix}.txt`,
        doc = await f.upload(filename, "Fictional withdraw evidence.");
    await checked(
        f.own.rpc("save_qualification_evidence", {
            p_topic_id: f.topic,
            p_version_id: doc.current_version_id,
            p_expected_version: 0,
            p_request_id: randomUUID(),
        }),
    );
    // Real manual review goes through the retained legacy endpoint and same history.
    await adminLogin(page, f.manager);
    await page.goto(`/admin/people?user=${f.teacher.id}`);
    await page
        .getByRole("button", {name: "Expertise verifizieren", exact: true})
        .click();
    await expect(
        page.getByText("Die Verifizierung wurde gespeichert.", {exact: true}),
    ).toBeVisible();
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await login(page, f.teacher.email);
    await page.goto("/profile");
    await page
        .getByLabel("Ausgewähltes Thema", {exact: true})
        .selectOption(f.topic);
    const panel = page.locator(".qualification-evidence");
    await panel
        .getByRole("button", {name: "Freigabe zurückziehen", exact: true})
        .click();
    await expect(
        panel.getByText("Für dieses Thema ist kein Zertifikatsbeleg freigegeben.", {
            exact: true,
        }),
    ).toBeVisible();
    await panel.getByRole("button", {name: "Prüfverlauf", exact: true}).click();
    await expect(
        panel.getByText("Freigabe zurückgezogen", {exact: true}),
    ).toBeVisible();
    const state = await checked(
        f.own.rpc("qualification_review", {
            p_user_id: f.teacher.id,
            p_topic_id: f.topic,
        }),
    );
    expect(state.verified).toBe(true);
    expect(state.evidence).toBeNull();
    await accessible(page);
});