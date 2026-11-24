import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

const actors = [
  { name: "owner", primary: "owner" },
  { name: "admin", primary: "admin" },
  { name: "management", primary: "management" },
  { name: "company", primary: "client", landing: "/client" },
  { name: "participant", primary: "participant", landing: "/learning" },
  { name: "guest", primary: "guest", landing: "/profile" },
  { name: "lecturer", primary: "lecturer", teaches: true },
  { name: "senior lecturer", primary: "senior_lecturer", teaches: true },
  {
    name: "management, company, lecturer and participant",
    primary: "management",
    additional: ["client", "lecturer", "participant"],
    teaches: true,
  },
] as const;

const claimTerms = /^(Konditionen akzeptieren|Accept the terms)$/i;
const claimAssignment = /^(Auftrag übernehmen|Claim now)$/i;
const submitInvoice = /^(Rechnung einreichen|Submit invoice)$/i;

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Role fixtures require the isolated portal test project.",
);

for (const role of actors) {
  test(`${role.name} sees only the assigned workflow controls`, async ({
    page,
    isMobile,
  }) => {
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const job = randomUUID();
    const organisation = randomUUID();
    const title = `Fictional teaching offer ${job.slice(0, 8)}`;
    const displayName =
      "additional" in role
        ? "Fictional Academic Programme Management and Customer Collaboration Coordinator for Continuous Professional Development"
        : `Fictional ${role.name}`;
    const profile = await actor(displayName, role.primary);
    const teaching = "teaches" in role;
    const company = role.primary === "client" || "additional" in role;
    const language = isMobile ? "de" : "en";

    try {
      if ("additional" in role) {
        await checked(
          service.from("user_roles").insert(
            role.additional.map((additional) => ({
              user_id: profile.id,
              role: additional,
            })),
          ),
        );
      }
      if (company) {
        await checked(
          service.from("organisations").insert({
            id: organisation,
            name: `Fictional company ${organisation.slice(0, 8)}`,
          }),
        );
        await checked(
          service.from("client_organisation_memberships").insert({
            user_id: profile.id,
            organisation_id: organisation,
          }),
        );
      }
      await checked(
        service
          .from("profiles")
          .update({ locale: language })
          .eq("id", profile.id),
      );
      await checked(
        service.from("jobs").insert({
          id: job,
          title,
          customer_name: "Fictional company",
          delivery_type: "online",
          status: "published",
          amount: 200,
          total_amount: 200,
          currency: "EUR",
          rate_unit: "fixed_total",
          terms: "Fictional terms",
          requires_contract: false,
        }),
      );
      await checked(
        service.from("job_sessions").insert({
          job_id: job,
          starts_at: "2051-06-03T08:00:00Z",
          ends_at: "2051-06-03T10:00:00Z",
        }),
      );

      const destination =
        "landing" in role ? new RegExp(`${role.landing}$`) : /\/$/;
      const restricted =
        role.primary === "participant" || role.primary === "guest";
      await login(page, profile.email, restricted ? destination : /\/$/);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      const viewport = page.viewportSize()!;
      for (const width of [320, 390, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: viewport.height });
        await expect
          .poll(
            () => page.evaluate(() => document.documentElement.scrollWidth),
            { message: `${role.name} dashboard at ${width}px` },
          )
          .toBeLessThanOrEqual(width);
        if (width === 390 && role.primary === "participant") {
          const preferences = page.locator(".topbar .preferences");
          await expect(preferences.locator("select").last()).toBeVisible();
          const fitsTheme = await preferences
            .locator("select")
            .last()
            .evaluate((control) => {
              if (!(control instanceof HTMLSelectElement)) {
                throw new TypeError("The theme preference must be a select");
              }
              // Measure an unconstrained clone while attached, then always
              // remove it so a failed layout read cannot alter the page.
              const natural = control.cloneNode(true) as HTMLSelectElement;
              natural.style.position = "absolute";
              natural.style.maxWidth = "none";
              control.after(natural);
              try {
                return control.offsetWidth >= natural.offsetWidth;
              } finally {
                natural.remove();
              }
            });
          expect(fitsTheme).toBe(true);
          const avatar = await page
            .locator(".account-menu .profile-avatar")
            .boundingBox();
          expect(avatar?.width).toBeGreaterThanOrEqual(32);
          expect(avatar?.width).toBe(avatar?.height);
        }
        if (width === 390 && "additional" in role) {
          const metrics = page.locator(".dashboard-metric");
          await expect(metrics.first()).toBeVisible();
          for (const metric of await metrics.all()) {
            const label = await metric.locator(":scope > span").boundingBox();
            const arrow = await metric
              .locator(".dashboard-metric-arrow")
              .boundingBox();
            expect(label).not.toBeNull();
            expect(arrow).not.toBeNull();
            expect(label!.x + label!.width).toBeLessThanOrEqual(arrow!.x);
          }
        }
        if ("additional" in role && width === 1440) {
          const search = page.getByRole("textbox", {
            name: /^(Search the portal|Im Portal suchen)$/,
          });
          await expect
            .poll(async () => (await search.boundingBox())?.width ?? 0)
            .toBeGreaterThanOrEqual(120);
          await expect(page.locator(".account-menu > summary")).toContainText(
            displayName,
          );
        }
      }
      await page.setViewportSize(viewport);
      const sidebarLink = (href: string) =>
        page.locator(`.sidebar a[href="${href}"]`);
      const consent = page.getByRole("checkbox", { name: claimTerms });
      const claim = page.getByRole("button", { name: claimAssignment });

      await page.goto(`/jobs/${job}`);
      if (role.primary === "client") {
        await expect(
          page.getByText(
            /^(Dieser Auftrag ist derzeit nicht verfügbar\.|This job is currently unavailable\.)$/,
          ),
        ).toBeVisible();
        await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
        await expect(sidebarLink("/jobs")).toHaveCount(0);
      } else if ("landing" in role) {
        await expect(page).toHaveURL(destination);
        await expect(sidebarLink("/jobs")).toHaveCount(0);
      } else {
        await expect(page.getByRole("heading", { name: title })).toBeVisible();
        await expect(consent).toHaveCount(teaching ? 1 : 0);
      }
      await expect(claim).toHaveCount(teaching ? 1 : 0);
      if (teaching) {
        await expect(claim).toBeDisabled();
        await consent.check();
        await expect(claim).toBeEnabled();
      }

      await page.goto(`/finance?claim=${randomUUID()}`);
      if ("landing" in role) {
        await expect(page).toHaveURL(destination);
        if (role.primary === "client") {
          if (isMobile) {
            await page.locator("details.mobile-more > summary").click();
            await page.locator('#mobile-shell-navigation a[href="/client/finance"]').click();
          } else {
            await sidebarLink("/client/finance").click();
          }
          await expect(page).toHaveURL(/\/client\/finance\/accounting$/);
          await expect(
            page.getByRole("heading", {
              name: /^(Buchhaltungsexporte|Accounting exports)$/i,
            }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: submitInvoice }),
          ).toHaveCount(0);
        } else {
          await expect(sidebarLink("/finance")).toHaveCount(0);
        }
      } else {
        const dialog = page.getByRole("dialog", { name: submitInvoice });
        if (teaching) {
          await expect(dialog).toBeVisible();
          await dialog
            .getByRole("button", { name: /^(Schließen|Close)$/i })
            .click();
        }
        await expect(page).toHaveURL(
          teaching ? /\/finance$/ : /\/admin\/finance\?claim=/,
        );
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: teaching
              ? /^(Meine Finanzen|My finances)$/i
              : /^(Plattformfinanzen|Platform finances)$/i,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: submitInvoice }),
        ).toHaveCount(teaching ? 1 : 0);
        await expect(dialog).toHaveCount(0);
      }

      await page.goto("/files");
      if (restricted) {
        await expect(page).toHaveURL(destination);
        await expect(sidebarLink("/files")).toHaveCount(0);
      } else {
        await page
          .getByRole("button", { name: /^(Datei hochladen|Upload file)$/i })
          .click();
        await expect(
          page.getByRole("combobox", { name: /^(Kategorie|Category)$/i }),
        ).toBeVisible();
        await expect(
          page.getByRole("option", { name: /^(Rechnung|Invoice)$/i }),
        ).toHaveCount(teaching ? 1 : 0);
      }

      if (role.primary === "guest") {
        await page.goto("/notifications");
        await expect(page).toHaveURL(destination);
        await expect(sidebarLink("/notifications")).toHaveCount(0);
      }

      if ("additional" in role) {
        await checked(
          service
            .from("user_roles")
            .delete()
            .eq("user_id", profile.id)
            .eq("role", "lecturer"),
        );
        await page.goto(`/jobs/${job}`);
        await expect(page.getByRole("heading", { name: title })).toBeVisible();
        await expect(consent).toHaveCount(0);
        await expect(claim).toHaveCount(0);
        for (const href of ["/jobs", "/client", "/learning", "/my-reviews"]) {
          await expect(sidebarLink(href)).toHaveCount(1);
        }
      }
    } finally {
      await checked(service.from("jobs").delete().eq("id", job));
      if (company) {
        await checked(
          service
            .from("client_organisation_memberships")
            .delete()
            .eq("user_id", profile.id)
            .eq("organisation_id", organisation),
        );
        await checked(
          service.from("organisations").delete().eq("id", organisation),
        );
      }
      await checked(service.auth.admin.deleteUser(profile.id));
    }
  });
}
