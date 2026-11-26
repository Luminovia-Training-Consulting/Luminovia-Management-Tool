import { randomUUID, createPublicKey, verify } from "node:crypto";
import { expect, test } from "@playwright/test";
import { enablePremiumAndLinkParticipant } from "./company-participant.mjs";
import {
  actor,
  api,
  checked,
  login,
} from "../../tests/e2e/helpers/accounts-support";

test("same-tab LTI launch to a synthetic tool validates live JWT claims", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(75_000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const auth = async (name: string, role: string) => {
    const account = await actor(name, role);
    const client = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
      client.auth.signInWithPassword({
        email: account.email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    return { ...account, client };
  };
  const admin = await auth("Fictional LTI administrator", "admin");
  const company = await auth("Fictional LTI customer", "client");
  const learner = await auth("Fictional LTI learner", "participant");
  const organisation = randomUUID(),
    template = randomUUID(),
    course = randomUUID();
  await checked(
    service
      .from("organisations")
      .insert({ id: organisation, name: "Fictional LTI company" }),
  );
  await checked(
    service
      .from("client_organisation_memberships")
      .insert({ user_id: company.id, organisation_id: organisation }),
  );
  await checked(
    service
      .from("course_templates")
      .insert({ id: template, title: "Fictional LTI course" }),
  );
  await checked(
    service.from("course_runs").insert({
      id: course,
      template_id: template,
      organisation_id: organisation,
      published: true,
    }),
  );
  await enablePremiumAndLinkParticipant({
    admin,
    company,
    learner,
    organisation,
    service,
    checked,
  });
  await checked(
    admin.client.rpc("manage_course_enrolment", {
      p_course_run_id: course,
      p_user_id: learner.id,
      p_status: "enrolled",
    }),
  );
  const fake = "https://lti-fixture-tool.example.invalid";
  const issuer = "https://lti-fixture-portal.example.invalid";
  const redirect = fake + "/receive";
  const target = fake + "/resource";
  const clientId = "native-local-browser-fixture";
  const workspace = `/courses/${course}/workspace#course-lti`;
  const managerContext = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  let deployment: string;
  try {
    const manager = await managerContext.newPage();
    await login(manager, admin.email);
    await manager.goto(workspace);
    const tools = manager.getByRole("region", {
      name: "Externe Lernwerkzeuge",
    });
    await tools
      .getByRole("button", { name: "Lernwerkzeug registrieren" })
      .click();
    await tools
      .getByLabel("Name des Lernwerkzeugs")
      .fill("Fictional local LTI tool");
    await tools.getByLabel("LTI-Client-ID").fill(clientId);
    await tools.getByLabel("Anmelde-URL des Werkzeugs").fill(fake + "/login");
    await tools.getByLabel("Registrierte Rückgabe-URL").fill(redirect);
    await tools.getByLabel("Ziel-URL des Kurslinks").fill(target);
    await tools.getByLabel("Für diesen Kurs freigeben").check();
    await tools
      .getByRole("button", { name: "Registrierung speichern" })
      .click();
    const registration = tools
      .getByRole("listitem")
      .filter({ hasText: "Fictional local LTI tool" });
    await expect(registration.getByText("LTI-Deployment-ID")).toBeVisible();
    deployment = await registration.locator("code").innerText();
    expect(deployment).toMatch(/^[a-f0-9-]{36}$/);
  } finally {
    await managerContext.close();
  }
  const nonce = randomUUID(),
    state = randomUUID();
  await page.route(fake + "/**", async (route) => {
    const request = route.request(),
      at = new URL(request.url());
    if (at.pathname === "/login") {
      expect(at.searchParams.get("iss")).toBe(issuer);
      expect(at.searchParams.get("lti_deployment_id")).toBe(deployment);
      expect(at.searchParams.get("target_link_uri")).toBe(target);
      expect(at.searchParams.has("proof")).toBe(false);
      const callback = new URL("/lti/authorize", baseURL);
      for (const [name, value] of Object.entries({
        login_hint: at.searchParams.get("login_hint")!,
        lti_message_hint: at.searchParams.get("lti_message_hint")!,
        client_id: clientId,
        redirect_uri: redirect,
        nonce,
        state,
        prompt: "none",
        scope: "openid",
        response_type: "id_token",
        response_mode: "form_post",
      }))
        callback.searchParams.set(name, value);
      await route.fulfill({
        status: 302,
        headers: { location: callback.href },
      });
      return;
    }
    expect(at.pathname).toBe("/receive");
    expect(request.method()).toBe("POST");
    const body = new URLSearchParams(request.postData() ?? "");
    expect(body.get("state")).toBe(state);
    const [header, data, sig] = body.get("id_token")!.split(".");
    const keyResponse = await fetch(
      process.env.SUPABASE_URL + "/functions/v1/learning-lti/jwks",
    );
    expect(keyResponse.status).toBe(200);
    const { keys } = await keyResponse.json();
    expect(
      verify(
        "sha256",
        Buffer.from(header + "." + data),
        createPublicKey({ key: keys[0], format: "jwk" }),
        Buffer.from(sig, "base64url"),
      ),
    ).toBe(true);
    const claims = JSON.parse(Buffer.from(data, "base64url").toString());
    expect(claims.nonce).toBe(nonce);
    expect(claims.sub).not.toBe(learner.id);
    expect(claims).not.toHaveProperty("email");
    expect(claims.aud).toBe(clientId);
    expect(claims.iss).toBe(issuer);
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>Verified fictional LTI launch</h1>",
    });
  });
  await login(page, learner.email, /\/learning$/);
  await page.goto(workspace);
  await expect(page.getByText("LTI-Deployment-ID")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Externes Lernwerkzeug öffnen" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verified fictional LTI launch" }),
  ).toBeVisible({ timeout: 25_000 });
});
