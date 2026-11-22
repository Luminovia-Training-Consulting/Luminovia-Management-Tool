/** Exercise the published Academy client and validate its HTTP exchanges against OpenAPI. */
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

const client = fileURLToPath(
  new URL("./examples/academy-workflows.ts", import.meta.url),
);
const jwt = (role) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.fixture`;

test("Academy quickstarts invite and author drafts over the documented endpoints", async (t) => {
  const org = randomUUID();
  const template = randomUUID();
  const course = randomUUID();
  const user = randomUUID();
  const actor = randomUUID();
  const creation = randomUUID();
  const access = jwt("authenticated");
  const apiKey = jwt("anon");
  const contract = academyOpenApi("https://academy.example.invalid/backend", {
    installationId: randomUUID(),
    edition: "customer-self-hosted",
    name: "Fictional Academy",
  });
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
  const expectedAccountPaths = new Set([
    "/functions/v1/accounts/v1/academy/users",
    "/functions/v1/accounts/v1/academy/company-invitations",
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
      assert.equal(request.headers.origin, origin);
      if (!request.url.startsWith("/backend/")) {
        reply.writeHead(307, { Location: `/backend${request.url}` }).end();
        return;
      }
      const path = request.url.slice("/backend".length);
      assert.equal(request.method, "POST");
      const operation = contract.paths[path].post;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      const requestSchema =
        operation.requestBody.content["application/json"].schema;
      // The draft branches apply to the already-required object. Make their
      // implicit type explicit for Zod's JSON Schema decoder.
      const schema =
        path === "/rest/v1/rpc/academy_create_course_draft"
          ? {
              ...requestSchema,
              oneOf: requestSchema.oneOf.map((branch) => ({
                type: "object",
                ...branch,
              })),
            }
          : requestSchema;
      z.fromJSONSchema(schema).parse(data);
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
    authenticate: async () => false,
    authenticateAcademy: async (token) => token === access,
    resolveAcademyActor: async (token) => (token === access ? actor : null),
    rpc: async (token, name, args) => {
      assert.equal(token, access);
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
    completeInvitation: async () =>
      assert.fail("Internal worker is outside the Academy example"),
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
  assert.deepEqual(deliveries, [
    ["lecturer", invitation.email],
    ["participant", learner.email],
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
