/** Exercises the customer brief through real UI, Auth, scanner and exact-byte gateway. */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {readFile, readFileSync} from "node:fs";
import {promisify} from "node:util";
import {execFileSync} from "node:child_process";
import {actor, api, checked, login} from "./helpers/accounts-support";

const read = promisify(readFile);
test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Only canonical disposable request fixtures.",
);

/** Removes only this test organisation's unpublished requests in its random QA DB. */
function deleteRequests(org: string) {
    if (!/^[0-9a-f-]{36}$/.test(org))
        throw new Error("Exact fixture organisation required");
    const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
        readFileSync("supabase/config.toml", "utf8"),
    )?.[1];
    if (!project || process.env.PORTAL_TEST_MODE !== "1")
        throw new Error("Disposable fixture database required");
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
            input: `delete
                    from private.client_course_requests
                    where organisation_id = '${org}';`,
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 20000,
        },
    );
}

async function accessible(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const scan = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        scan.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
        })),
    ).toEqual([]);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
    ).toBe(true);
}

test("customer records teaching units, revises the brief, shares scanned bytes and retains history after reload", async ({
                                                                                                                             page,
                                                                                                                         }, info) => {
    test.setTimeout(120000);
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        customer = await actor("Fictional request brief customer", "client"),
        org = randomUUID(),
        token = randomUUID().slice(0, 8),
        title = `Fictional request brief ${token}`,
        filename = `Request-brief-${token}.txt`;
    await checked(
        service
            .from("organisations")
            .insert({id: org, name: `Fictional request academy ${token}`}),
    );
    await checked(
        service
            .from("client_organisation_memberships")
            .insert({user_id: customer.id, organisation_id: org}),
    );
    try {
        await login(page, customer.email);
        await page.goto("/client");
        await page
            .getByRole("button", {name: "Kurs anfragen", exact: true})
            .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Titel", {exact: true}).fill(title);
        await dialog
            .getByLabel("Benötigte Unterrichtseinheiten", {exact: true})
            .fill("4");
        await dialog
            .getByLabel("Benötigte Unterlagen (eine Anforderung pro Zeile)", {
                exact: true,
            })
            .fill("Accessible course handout\nLab access instructions");
        await dialog
            .getByLabel("Hinweise zur Kursvorbereitung", {exact: true})
            .fill("Original fictional course preparation");
        await dialog
            .getByRole("button", {
                name: "Anfrage verbindlich speichern",
                exact: true,
            })
            .click();
        await expect(dialog).toBeHidden();
        const card = page
            .getByRole("article")
            .filter({has: page.getByRole("heading", {name: title, exact: true})});
        await card
            .getByRole("button", {
                name: "Unterrichtsbedarf und Unterlagen",
                exact: true,
            })
            .click();
        await expect(
            card
                .getByText("Benötigte Unterrichtszeit: 180 Minuten", {exact: true})
                .first(),
        ).toBeVisible();
        await card
            .getByRole("button", {
                name: "Anforderungsprofil bearbeiten",
                exact: true,
            })
            .click();
        await card
            .getByLabel("Benötigte Unterrichtseinheiten", {exact: true})
            .fill("3");
        await card
            .getByLabel("Hinweise zur Kursvorbereitung", {exact: true})
            .fill("Revised fictional preparation");
        await card
            .getByRole("button", {name: "Anforderungen speichern", exact: true})
            .click();
        // The editor previews teaching minutes before the save commits. Wait for
        // the enabled non-editing action: the confirmed revision/refetch has then
        // finished, and the real file input is available to a user again.
        await expect(
            card.getByRole("button", {
                name: "Anforderungsprofil bearbeiten",
                exact: true,
            }),
        ).toBeEnabled();
        await expect(
            card
                .getByText("Benötigte Unterrichtszeit: 135 Minuten", {exact: true})
                .first(),
        ).toBeVisible();
        const bytes = Buffer.from(
            "Fictional request material through the real quarantine and scanner.",
        );
        await card
            .getByLabel("Datei für diese Anfrage", {exact: true})
            .setInputFiles({name: filename, mimeType: "text/plain", buffer: bytes});
        await card
            .getByRole("button", {
                name: "Geprüfte Datei hochladen und freigeben",
                exact: true,
            })
            .click();
        await expect(
            card.getByText(`${filename} · Material`, {exact: true}),
        ).toBeVisible({timeout: 45000});
        const downloadPromise = page.waitForEvent("download");
        await card
            .getByRole("button", {name: "Herunterladen", exact: true})
            .click();
        const download = await downloadPromise;
        expect(await read((await download.path())!)).toEqual(bytes);
        await page.reload();
        await card
            .getByRole("button", {
                name: "Unterrichtsbedarf und Unterlagen",
                exact: true,
            })
            .click();
        await expect(
            card.getByText("Revised fictional preparation", {exact: true}).first(),
        ).toBeVisible();
        await expect(
            card.getByText("Original fictional course preparation", {exact: true}),
        ).toBeVisible();
        await expect(
            card.getByText(`${filename} · Material`, {exact: true}),
        ).toBeVisible();
        await accessible(page);
        await page.screenshot({
            path: info.outputPath("request-brief-de.png"),
            fullPage: true,
        });
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await expect(
            card.getByRole("heading", {
                name: "Request revision history",
                exact: true,
            }),
        ).toBeVisible();
        await accessible(page);
        await page.screenshot({
            path: info.outputPath("request-brief-en.png"),
            fullPage: true,
        });
    } finally {
        // Request removal cascades only its own brief/history, then exact uploaded paths/accounts.
        deleteRequests(org);
        const docs = await checked(
            service.from("documents").select("id").eq("owner_id", customer.id),
        );
        for (const document of docs) {
            const versions = await checked(
                service
                    .from("document_versions")
                    .select("object_path")
                    .eq("document_id", document.id),
            );
            const paths = versions.map((v) => v.object_path);
            await checked(service.storage.from("portal-clean").remove(paths));
            await checked(service.storage.from("portal-quarantine").remove(paths));
            await checked(
                service
                    .from("documents")
                    .update({current_version_id: null})
                    .eq("id", document.id),
            );
            await checked(
                service
                    .from("document_versions")
                    .delete()
                    .eq("document_id", document.id),
            );
            await checked(service.from("documents").delete().eq("id", document.id));
        }
        await checked(
            service.from("notifications").delete().eq("user_id", customer.id),
        );
        await checked(
            service.from("audit_events").delete().eq("actor_id", customer.id),
        );
        await checked(
            service
                .from("client_organisation_memberships")
                .delete()
                .eq("organisation_id", org),
        );
        await checked(service.from("organisations").delete().eq("id", org));
        await checked(service.auth.admin.deleteUser(customer.id));
    }
});