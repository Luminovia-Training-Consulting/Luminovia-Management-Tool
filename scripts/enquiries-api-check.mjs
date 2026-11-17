/** Actual isolated Deno HTTP→Auth/REST/SQL intake and management conversion. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { withApiFixture } from "./testing/api.mjs";

await withApiFixture(
  async ({ service, actor, passwordOnly, checked, sql, defer, suffix, url }) => {
    const manager = await actor("enquiry-manager", "management"),
      peer = await actor("enquiry-peer", "lecturer"),
      client = await actor("enquiry-client", "client");
    const token = randomBytes(48).toString("base64url"),
      senderSubmission = randomUUID();
    const senderHash = createHash("sha256").update(token).digest("hex");
    const payload = {
      submission_id: senderSubmission,
      company_name: `Fictional Enquiry Company ${suffix}`,
      contact_name: "Fictional Contact",
      email: "enquiry@example.invalid",
      phone: "",
      topic: `Fictional training ${suffix}`,
      message: "Fictional requirements without actual customer records.",
      preferred_dates: "A future fictional month",
      duration: "Two days",
      delivery_type: "online",
      time_zone: "Europe/Berlin",
      locale: "en",
      privacy_notice_version: "fictional-v1",
      consent: true,
      website: "",
    };
    let organization, run, template, enquiry;
    defer(async () => {
      const retained = JSON.parse(
        await sql(
          `select coalesce((select jsonb_build_object('id',id,'organisation_id',organisation_id,'course_run_id',course_run_id) from private.website_enquiries where sender_hash='${senderHash}' and submission_id='${senderSubmission}'),'{}'::jsonb)`,
        ),
      );
      enquiry ??= retained.id;
      organization ??= retained.organisation_id;
      run ??= retained.course_run_id;
      if (run && !template)
        template = await sql(
          `select template_id from public.course_runs where id='${run}'`,
        );
      if (enquiry)
        await sql(
          `delete from public.notifications where resource_id='${enquiry}';delete from private.website_enquiry_requests where enquiry_id='${enquiry}';delete from private.website_enquiry_events where enquiry_id='${enquiry}';delete from private.website_enquiries where id='${enquiry}';`,
        );
      if (run) {
        await checked(
          service.from("course_sessions").delete().eq("course_run_id", run),
        );
        await checked(service.from("course_runs").delete().eq("id", run));
      }
      if (template)
        await checked(
          service.from("course_templates").delete().eq("id", template),
        );
      if (organization) {
        await checked(
          service
            .from("organisation_contacts")
            .delete()
            .eq("organisation_id", organization),
        );
        await checked(
          service
            .from("organisation_private_details")
            .delete()
            .eq("organisation_id", organization),
        );
        await checked(
          service.from("organisations").delete().eq("id", organization),
        );
      }
    });
    // withApiFixture has already validated the canonical endpoint, or the native
    // scratch adapter's exact project/origin and actual database ownership label.
    // Carry that confirmed tuple to the listener rather than relaxing it to any
    // loopback port. The child repeats the project/config/endpoint guards.
    const confirmedProject =
      /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
        readFileSync("supabase/config.toml", "utf8"),
      )?.[1];
    assert.ok(confirmedProject, "Confirmed isolated enquiry project required");
    // Native candidate HTTPS uses its own fixture CA. Keep certificate and
    // hostname validation enabled; Deno does not consume NODE_EXTRA_CA_CERTS.
    const candidateCertificate = process.env.PORTAL_CANDIDATE_OWNER
      ? process.env.NODE_EXTRA_CA_CERTS
      : undefined;
    const child = spawn(
      // Run the installed binary directly: killing npm's synchronous Node shim
      // leaves its Deno descendant and HTTP socket alive during fixture cleanup.
      "./node_modules/deno/deno",
      [
        "run",
        ...(candidateCertificate ? [`--cert=${candidateCertificate}`] : []),
        "--allow-env",
        "--allow-read=supabase/config.toml",
        "--allow-net=127.0.0.1,localhost,[::1]",
        "scripts/testing/enquiries-edge-http.ts",
      ],
      {
        env: {
          ...process.env,
          PORTAL_ENQUIRY_TEST_API_ORIGIN: new URL(url).origin,
          PORTAL_ENQUIRY_TEST_PROJECT: confirmedProject,
          PORTAL_WEBSITE_ENQUIRIES_ENABLED: "true",
          PORTAL_WEBSITE_INTEGRATION_TOKEN: token,
          PORTAL_WEBSITE_ORIGIN: "https://website.example.invalid",
          PORTAL_WEBSITE_PRIVACY_NOTICE_VERSION: "fictional-v1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const ended = new Promise((resolve) => child.once("close", resolve));
    defer(async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        await ended;
        clearTimeout(timer);
      }
    });
    const port = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(Error("Isolated enquiry listener did not become ready")),
        30000,
      );
      child.stdout.on("data", (data) => {
        output += data;
        const match = /PORTAL_ENQUIRY_TEST_PORT=(\d+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.on("error", () => {
        clearTimeout(timer);
        reject(Error("Isolated enquiry listener failed to start"));
      });
      child.once("close", () => {
        clearTimeout(timer);
        reject(
          Error(
            "Isolated enquiry listener exited before readiness; credentials withheld",
          ),
        );
      });
      // Never relay a child stream that could contain runtime configuration.
      child.stderr.resume();
    });
    const send = (body = payload, credential = token) =>
      fetch(`http://127.0.0.1:${port}/website-enquiries`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Luminovia-Integration-Token": credential,
        },
        body: JSON.stringify(body),
      });
    assert.equal((await send(payload, "")).status, 401);
    const received = await Promise.all([send(), send()]);
    for (const response of received) {
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), {
        received: true,
        receipt: senderSubmission,
      });
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    }
    assert.equal(
      (await send({ ...payload, message: "Changed duplicate" })).status,
      409,
    );
    assert.equal(
      (await send({ ...payload, submission_id: randomUUID(), consent: false }))
        .status,
      400,
    );
    assert.ok((await manager.client.rpc("enquiry_inbox")).error);
    await passwordOnly(manager.client);
    const inbox = await checked(
      manager.client.rpc("enquiry_inbox", { p_search: suffix }),
    );
    assert.equal(inbox.items.length, 1);
    enquiry = inbox.items[0].id;
    for (const person of [peer, client])
      assert.ok(
        (await person.client.rpc("enquiry_detail", { p_enquiry_id: enquiry }))
          .error,
      );
    assert.ok(
      (
        await peer.client.rpc("receive_website_enquiry", {
          p_sender_hash: "a".repeat(64),
          p_submission_id: randomUUID(),
          p_payload: payload,
        })
      ).error,
      "Public actor cannot bypass integration through RPC",
    );
    const manage = (action, body, version, request = randomUUID()) =>
      manager.client.rpc("manage_enquiry", {
        p_enquiry_id: enquiry,
        p_action: action,
        p_payload: body,
        p_expected_version: version,
        p_request_id: request,
      });
    const get = () =>
      checked(manager.client.rpc("enquiry_detail", { p_enquiry_id: enquiry }));
    const customerKey = randomUUID();
    await checked(manage("create_customer", {}, 1, customerKey));
    await checked(manage("create_customer", {}, 1, customerKey));
    organization = (await get()).organisation_id;
    const starts = new Date(Date.now() + 90 * 86400000).toISOString(),
      ends = new Date(Date.now() + 90 * 86400000 + 3600000).toISOString();
    await checked(
      manage(
        "convert",
        {
          template_id: "",
          time_zone: "Europe/Berlin",
          delivery_type: "online",
          venue: "",
          sessions: [{ starts_at: starts, ends_at: ends }],
        },
        2,
      ),
    );
    const converted = await get();
    run = converted.course_run_id;
    assert.equal(converted.status, "converted");
    const runRow = await checked(
      service
        .from("course_runs")
        .select("template_id,published")
        .eq("id", run)
        .single(),
    );
    template = runRow.template_id;
    assert.equal(runRow.published, false);
    assert.equal(
      (
        await checked(
          service.from("course_sessions").select("id").eq("course_run_id", run),
        )
      ).length,
      1,
    );
    assert.equal(converted.payload.message, payload.message);
    await checked(
      service.from("user_roles").delete().eq("user_id", manager.id),
    );
    assert.ok(
      (await manager.client.rpc("enquiry_detail", { p_enquiry_id: enquiry }))
        .error,
    );
    const disabled = await fetch(`${url}/functions/v1/website-enquiries`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        apikey: process.env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    assert.equal(
      disabled.status,
      503,
      "Unconfigured deployed worker fails closed",
    );
    console.log(
      "PASS exact enquiry worker adapter over real loopback HTTP/REST: validated/idempotent receipt, invalid/auth denial, real password-only authentication triage/customer/conversion, private reads and current revocation; normal worker disabled",
    );
  },
);
