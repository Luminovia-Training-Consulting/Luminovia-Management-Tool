import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

const actors = [
  { name: "owner", primary: "owner" },
  { name: "admin", primary: "admin" },
  { name: "management", primary: "management" },
  { name: "company", primary: "client", landing: "/client" },
  { name: "participant", primary: "participant", landing: "/learning" },
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
    const profile = await actor(`Fictional ${role.name}`, role.primary);
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
      await login(
        page,
        profile.email,
        role.primary === "participant" ? destination : /\/$/,
      );
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      const sidebarLink = (href: string) =>
        page.locator(`.sidebar a[href="${href}"]`);
      const consent = page.getByRole("checkbox", { name: claimTerms });
      const claim = page.getByRole("button", { name: claimAssignment });

      await page.goto(`/jobs/${job}`);
      if ("landing" in role) {
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
        await expect(sidebarLink("/finance")).toHaveCount(0);
      } else {
        const dialog = page.getByRole("dialog", { name: submitInvoice });
        if (teaching) {
          await expect(dialog).toBeVisible();
          await dialog
            .getByRole("button", { name: /^(Schließen|Close)$/i })
            .click();
        }
        await expect(
          page.getByRole("heading", {
            name: /^(Honorare & Rechnungen|Earnings & invoices)$/i,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: submitInvoice }),
        ).toHaveCount(teaching ? 1 : 0);
        await expect(dialog).toHaveCount(0);
      }

      if (role.primary !== "participant") {
        await page.goto("/files");
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
