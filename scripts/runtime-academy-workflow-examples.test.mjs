/** Exercise the published workflow client and validate its HTTP exchanges against OpenAPI. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { createAccountHandler } from "../supabase/functions/accounts/handler.ts";
import { accountOpenApi } from "../supabase/functions/accounts/openapi.ts";
import { portalOpenApi } from "../src/features/developer-api/contract.ts";

const client = fileURLToPath(
  new URL("./examples/academy-workflows.ts", import.meta.url),
);
const jwt = (role) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.fixture`;

test("workflow examples invite accounts and author courses over the documented endpoints", async (t) => {
  const org = randomUUID();
  const template = randomUUID();
  const course = randomUUID();
  const user = randomUUID();
  const actor = randomUUID();
  const creation = randomUUID();
  const session = randomUUID();
  const access = jwt("authenticated");
  const apiKey = jwt("anon");
  const contract = academyOpenApi("https://academy.example.invalid/backend", {
    installationId: randomUUID(),
    edition: "customer-self-hosted",
    name: "Fictional Academy",
  });
  const portal = portalOpenApi("https://portal.example.invalid/backend");
  const invitation = {
    email: "teacher@example.invalid",
    display_name: "Fictional Teacher",
    idempotency_key: randomUUID(),
  };
  const learner = {
    ...invitation,
    idempotency_key: randomUUID(),
    email: "learner@example.invalid",
    course_id: course,
  };
  const portalInvitation = {
    ...invitation,
    email: "cms-teacher@example.invalid",
    idempotency_key: randomUUID(),
  };
  const portalParticipant = {
    ...invitation,
    email: "cms-learner@example.invalid",
    idempotency_key: randomUUID(),
    organisation_id: org,
  };
  const draft = {
    p_request_id: randomUUID(),
    p_organisation_id: org,
    p_template_id: template,
    p_template_title: null,
    p_payload: {
      time_zone: "Europe/Berlin",
      delivery_type: "online",
      venue: "",
      sessions: [
        {
          starts_at: "2030-05-06T10:00:00+02:00",
          ends_at: "2030-05-06T12:00:00+02:00",
        },
      ],
    },
  };
  const options = {
    organisations: [{ id: org, name: "Fictional Organisation" }],
    templates: [{ id: template, title: "Fictional Course" }],
  };
  const receipt = { course_run_id: course, template_id: template };
  const draftSchema = z.fromJSONSchema(
    contract.paths["/rest/v1/rpc/academy_create_course_draft"].post.requestBody
      .content["application/json"].schema,
  );
  assert.ok(draftSchema.safeParse(draft).success);
  assert.ok(
    draftSchema.safeParse({
      ...draft,
      p_template_id: null,
      p_template_title: "New Fictional Template",
    }).success,
  );
  for (const input of [
    { ...draft, p_template_title: "Duplicate Template Choice" },
    { ...draft, p_template_id: null },
  ]) {
    assert.equal(draftSchema.safeParse(input).success, false);
  }
  const courseId = { p_course_id: course };
  const scheduled = {
    ...draft.p_payload,
    sessions: [{ ...draft.p_payload.sessions[0], id: session }],
  };
  const revision = {
    ...courseId,
    p_expected_revision: 1,
    p_payload: { ...scheduled, venue: "Fictional lab" },
  };
  const candidates = { ...courseId, p_search: "Teacher" };
  const assignment = {
    ...courseId,
    p_instructor_id: user,
    p_request_id: randomUUID(),
  };
  const publication = { ...courseId, p_capacity: 12 };
  const portalTemplate = {
    p_id: null,
    p_payload: { title: "Fictional CMS course" },
  };
  const portalRun = {
    p_id: null,
    p_payload: {
      ...draft.p_payload,
      template_id: template,
      organisation_id: org,
    },
  };
  const courseSteps = {
    academy_draft_schedule: [courseId, { ...scheduled, revision: 1 }],
    academy_save_draft_schedule: [
      revision,
      { ...revision.p_payload, revision: 2 },
    ],
    academy_course_instructor_candidates: [
      candidates,
      [{ id: user, name: "Fictional Teacher", assignment_id: null }],
    ],
    academy_assign_course_instructor: [
      assignment,
      { status: "confirmed", claim_id: creation },
    ],
    academy_publish_course: [publication, { published: true, capacity: 12 }],
    save_course_template: [portalTemplate, template],
    save_course_run: [portalRun, course],
  };
  const expectedAccountPaths = new Set([
    "/functions/v1/accounts/v1/academy/users",
    "/functions/v1/accounts/v1/academy/company-invitations",
    "/functions/v1/accounts/v1/invitations",
    "/functions/v1/accounts/v1/company-participant-invitations",
  ]);
  const deliveries = [];
  const receipts = new Map();
  const errors = [];
  let attempts = 0;

  const server = createServer(async (request, reply) => {
    attempts++;
    try {
      assert.equal(request.headers.authorization, `Bearer ${access}`);
      assert.equal(request.headers.apikey, apiKey);
      assert.equal(request.headers.origin, undefined);
      if (!request.url.startsWith("/backend/")) {
        reply.writeHead(307, { Location: `/backend${request.url}` }).end();
        return;
      }
      const path = request.url.slice("/backend".length);
      const rpc = path.split("/").at(-1);
      assert.equal(request.method, "POST");
      const operation = (contract.paths[path] ?? portal.paths[path]).post;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      const requestSchema =
        operation.requestBody.content["application/json"].schema;
      z.fromJSONSchema(requestSchema).parse(data);
      let response;
      if (expectedAccountPaths.has(path)) {
        response = await accounts(
          new Request(origin + path, {
            method: request.method,
            headers: request.headers,
            body: JSON.stringify(data),
          }),
        );
      } else if (path === "/rest/v1/rpc/academy_course_draft_options") {
        assert.deepEqual(data, {
          p_organisation_query: "Fictional",
          p_template_query: "Course",
        });
        response = Response.json(options);
      } else if (Object.hasOwn(courseSteps, rpc)) {
        const [expected, result] = courseSteps[rpc];
        if (
          rpc === "academy_save_draft_schedule" &&
          data.p_expected_revision !== 1
        ) {
          response = Response.json(
            {
              code: "PT409",
              message: "Draft schedule changed",
              details: null,
              hint: null,
            },
            { status: 409 },
          );
        } else {
          assert.deepEqual(data, expected);
          response = Response.json(result);
        }
      } else {
        assert.equal(path, "/rest/v1/rpc/academy_create_course_draft");
        response =
          data.p_organisation_id === org
            ? Response.json(receipts.get(data.p_request_id) ?? receipt)
            : Response.json(
                { code: "42501", message: "Denied", details: null, hint: null },
                { status: 403 },
              );
        if (response.ok) receipts.set(data.p_request_id, receipt);
      }
      const body = await response.json();
      z.fromJSONSchema(
        operation.responses[response.status].content["application/json"].schema,
      ).parse(body);
      reply
        .writeHead(response.status, { "Content-Type": "application/json" })
        .end(JSON.stringify(body));
    } catch (error) {
      errors.push(error);
      reply.writeHead(500).end();
    }
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => assert.deepEqual(errors, []));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const accounts = createAccountHandler({
    origins: [origin],
    appOrigin: origin,
    invitationsEnabled: true,
    openapi: {},
    authenticate: async (token) => token === access,
    authenticateAcademy: async (token) => token === access,
    resolveAcademyActor: async (token) => (token === access ? actor : null),
    rpc: async (token, name, args) => {
      assert.equal(token, access);
      if (name === "reserve_account_invitation") {
        assert.deepEqual(args, {
          p_email: portalInvitation.email,
          p_display_name: portalInvitation.display_name,
          p_role: "lecturer",
          p_organisation_id: null,
          p_idempotency_key: portalInvitation.idempotency_key,
        });
        return { data: { status: "reserved", invitation_id: creation } };
      }
      if (name === "reserve_company_participant_invitation") {
        assert.deepEqual(args, {
          p_organisation_id: org,
          p_email: portalParticipant.email,
          p_display_name: portalParticipant.display_name,
          p_request_id: portalParticipant.idempotency_key,
        });
        return { data: { status: "requested", request_id: null } };
      }
      assert.equal(name, "reserve_academy_account");
      assert.deepEqual(args, {
        p_request_id: invitation.idempotency_key,
        p_email: invitation.email,
        p_display_name: invitation.display_name,
        p_role: "lecturer",
        p_organisation_id: null,
        p_mode: "invite",
      });
      return { data: { status: "reserved", creation_id: creation } };
    },
    privilegedRpc: async (name, args) => {
      if (name === "reserve_academy_company_invitation") {
        assert.deepEqual(args, {
          p_request_id: learner.idempotency_key,
          p_email: learner.email,
          p_display_name: learner.display_name,
          p_creator: actor,
          p_course_id: course,
        });
        return { data: { status: "reserved", creation_id: creation } };
      }
      assert.equal(name, "finish_academy_account");
      assert.deepEqual(args, {
        p_creation_id: creation,
        p_user_id: user,
        p_decision: "complete",
      });
      return { data: { status: "created", user_id: user } };
    },
    sendInvitation: async (item, callback) => {
      assert.equal(callback, `${origin}/auth/callback`);
      deliveries.push([item.role, item.email]);
      return user;
    },
    completeInvitation: async (id, invitedUser, displayName, success) => {
      assert.deepEqual(
        [id, invitedUser, displayName, success],
        [creation, user, portalInvitation.display_name, true],
      );
    },
    removeCreatedAccount: async () =>
      assert.fail("Successful fixture must not clean up an account"),
  });

  const run = (command, data, env = {}) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [client, command],
        {
          env: {
            PATH: process.env.PATH,
            LUMINOVIA_API_BASE_URL: `${origin}/backend`,
            LUMINOVIA_PUBLISHABLE_KEY: apiKey,
            LUMINOVIA_ACCESS_TOKEN: access,
            ...env,
          },
          timeout: 20_000,
        },
        (error, stdout, stderr) =>
          error
            ? reject(errors[0] ?? Object.assign(error, { stdout, stderr }))
            : resolve(stdout),
      );
      child.stdin.on("error", reject);
      child.stdin.end(JSON.stringify(data));
    }).then(JSON.parse);

  assert.deepEqual(
    await run("invite-account", {
      ...invitation,
      role: "lecturer",
      organisation_id: null,
      mode: "invite",
    }),
    {
      status: "created",
      user_id: user,
    },
  );
  assert.deepEqual(await run("invite-learner", learner), {
    status: "requested",
  });
  assert.deepEqual(await run("invite-portal-account", portalInvitation), {
    status: "sent",
    invitation_id: creation,
  });
  assert.deepEqual(await run("invite-portal-participant", portalParticipant), {
    status: "requested",
  });
  assert.deepEqual(deliveries, [
    ["lecturer", invitation.email],
    ["participant", learner.email],
    ["lecturer", portalInvitation.email],
  ]);
  assert.deepEqual(
    await run("draft-options", {
      p_organisation_query: "Fictional",
      p_template_query: "Course",
    }),
    options,
  );
  assert.deepEqual(await run("create-draft", draft), receipt);
  assert.deepEqual(await run("create-draft", draft), receipt);
  assert.equal(receipts.size, 1);
  for (const [command, name] of [
    ["draft-schedule", "academy_draft_schedule"],
    ["save-draft-schedule", "academy_save_draft_schedule"],
    ["instructor-candidates", "academy_course_instructor_candidates"],
    ["assign-instructor", "academy_assign_course_instructor"],
    ["publish-course", "academy_publish_course"],
    ["create-portal-template", "save_course_template"],
    ["create-portal-run", "save_course_run"],
  ]) {
    const [request, response] = courseSteps[name];
    assert.deepEqual(await run(command, request), response);
  }
  await assert.rejects(
    run("save-draft-schedule", { ...revision, p_expected_revision: 3 }),
    { code: 1, stderr: "HTTP 409 (PT409)\n", stdout: "" },
  );
  await assert.rejects(
    run("create-draft", { ...draft, p_organisation_id: randomUUID() }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /HTTP 403 \(42501\)/);
      assert.equal(error.stdout, "");
      return true;
    },
  );
  const beforeRedirect = attempts;
  await assert.rejects(
    run("create-draft", draft, { LUMINOVIA_API_BASE_URL: origin }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /HTTP 307/);
      return true;
    },
  );
  assert.equal(attempts, beforeRedirect + 1);
  await assert.rejects(
    run("create-draft", draft, { LUMINOVIA_ACCESS_TOKEN: jwt("service_role") }),
    { code: 2 },
  );
  await assert.rejects(
    run("create-draft", draft, {
      LUMINOVIA_PUBLISHABLE_KEY: jwt("service_role"),
    }),
    { code: 2 },
  );
  await assert.rejects(
    run("invite-account", { ...invitation, mode: "password" }),
    { code: 2 },
  );
  assert.equal(attempts, beforeRedirect + 1);
});

test("the Portal invitation contracts match transport errors and retained outcomes", async () => {
  const origin = "https://portal.example.invalid";
  const invitation = {
    email: "fictional@example.invalid",
    display_name: "Fictional Account",
    idempotency_key: randomUUID(),
  };
  const organisation = randomUUID();
  const companyInvitation = { ...invitation, organisation_id: organisation };
  const staffPath = "/v1/invitations";
  const companyPath = "/v1/company-participant-invitations";
  const schemas = (path, status) =>
    z.fromJSONSchema(
      accountOpenApi.paths[path].post.responses[status].content[
        "application/json"
      ].schema,
    );
  const staffRequest = z.fromJSONSchema(
    accountOpenApi.paths[staffPath].post.requestBody.content["application/json"]
      .schema,
  );
  assert.ok(staffRequest.safeParse(invitation).success);
  assert.ok(staffRequest.safeParse({ ...invitation, role: "client" }).success);
  assert.ok(
    staffRequest.safeParse({
      ...invitation,
      role: "client",
      organisation_id: organisation,
    }).success,
  );
  for (const input of [
    { ...invitation, organisation_id: organisation },
    { ...invitation, role: "participant" },
    { ...invitation, role: "owner" },
  ]) {
    assert.equal(staffRequest.safeParse(input).success, false);
  }
  const companyReceipt = schemas(companyPath, 202);
  assert.equal(companyReceipt.safeParse({}).success, false);
  assert.equal(
    companyReceipt.safeParse({ status: "requested", user_id: organisation })
      .success,
    false,
  );

  let databaseReply = { data: null };
  const handler = createAccountHandler({
    appOrigin: origin,
    origins: [origin],
    authenticate: async (token) => token === "fictional-actor",
    invitationsEnabled: true,
    openapi: {},
    rpc: async () => databaseReply,
    privilegedRpc: async () => ({ data: { deliver: false } }),
    sendInvitation: async () =>
      assert.fail("The test exercises errors and previously retained receipts"),
    completeInvitation: async () => assert.fail("No invitation was delivered"),
  });
  const verify = async (
    path,
    {
      input = path === staffPath ? invitation : companyInvitation,
      headers = {},
      status,
      response,
    },
  ) => {
    const result = await handler(
      new Request(origin + "/functions/v1/accounts" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer fictional-actor",
          ...headers,
        },
        body: typeof input === "string" ? input : JSON.stringify(input),
      }),
    );
    assert.equal(result.status, status);
    assert.deepEqual(
      schemas(path, status).parse(await result.json()),
      response,
    );
  };
  for (const path of [staffPath, companyPath]) {
    await verify(path, {
      headers: { Authorization: "Bearer expired-test-actor" },
      status: 401,
      response: { error: "authentication_required" },
    });
    await verify(path, {
      headers: { Origin: "https://other.example.invalid" },
      status: 403,
      response: { error: "origin_not_allowed" },
    });
    await verify(path, {
      input: { ...invitation, authority: "administrator" },
      status: 400,
      response: { error: "invalid_request" },
    });
    await verify(path, {
      input: "x".repeat(16 * 1024 + 1),
      status: 413,
      response: { error: "request_too_large" },
    });
    await verify(path, {
      headers: { "Content-Type": "text/plain" },
      status: 415,
      response: { error: "json_required" },
    });
    databaseReply = { error: { code: "42501" } };
    await verify(path, {
      status: 403,
      response: { error: "permission_required" },
    });
  }
  databaseReply = { error: { code: "40001" } };
  await verify(companyPath, {
    status: 409,
    response: { error: "invalid_request" },
  });
  databaseReply = { data: { status: "idempotency_conflict" } };
  await verify(staffPath, {
    status: 409,
    response: databaseReply.data,
  });
  databaseReply = { data: { status: "failed", invitation_id: randomUUID() } };
  await verify(staffPath, {
    status: 200,
    response: databaseReply.data,
  });
});
