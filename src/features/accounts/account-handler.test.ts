/** Exercise the actual account Edge handler and its published request contract with isolated dependencies. */
import { expect, it } from "vitest";
import { z } from "zod";
import {
  type AccountDependencies,
  createAccountHandler,
} from "../../../supabase/functions/accounts/handler";
import { accountOpenApi } from "../../../supabase/functions/accounts/openapi";

const creationId = "11111111-1111-4111-8111-111111111111";
const userId = "33333333-3333-4333-8333-333333333333";
const password = "Aa1!aaaa";

/** Record every external boundary so rejected credentials cannot reserve or create an account. */
function fixture() {
  const calls: string[] = [];
  const dependencies: AccountDependencies = {
    origins: ["http://127.0.0.1:6473"],
    appOrigin: "http://127.0.0.1:6473",
    invitationsEnabled: true,
    authenticate: async () => true,
    openapi: {},
    rpc: async (_token, name, args) => {
      expect(name).toBe("reserve_account_creation");
      expect(args).not.toHaveProperty("password");
      calls.push("reserve");
      return { data: { status: "reserved", creation_id: creationId } };
    },
    createAccount: async (account) => {
      expect(account.password).toBe(password);
      calls.push("create");
      return userId;
    },
    completeAccount: async (_id, _user, success) => {
      calls.push(success ? "complete" : "failed");
    },
    removeCreatedAccount: async () => {
      calls.push("rollback");
    },
    sendInvitation: async () => {
      throw new Error("unexpected invitation");
    },
    completeInvitation: async () => {},
  };
  const handler = createAccountHandler(dependencies);
  return {
    calls,
    request: (value: unknown) =>
      handler(
        new Request("http://localhost/accounts/v1/users", {
          method: "POST",
          headers: {
            authorization: "Bearer fictional-test-token",
            origin: "http://127.0.0.1:6473",
            "content-type": "application/json",
          },
          body: JSON.stringify(value),
        }),
      ),
  };
}

const payload = {
  email: "fictional-user@example.invalid",
  display_name: "Fictional user",
  role: "admin",
  organisation_id: null,
  idempotency_key: "22222222-2222-4222-8222-222222222222",
  password,
};

it("documents the same password bounds and character classes enforced by account creation", () => {
  const schema = accountOpenApi.paths["/v1/users"].post.requestBody.content[
    "application/json"
  ].schema as {
    properties: {
      password: { minLength: number; maxLength: number; pattern: string };
    };
  };

  expect(schema.properties.password).toMatchObject({
    minLength: 8,
    maxLength: 128,
  });
  const policy = new RegExp(schema.properties.password.pattern);
  expect(policy.test("Aa1!aaaa")).toBe(true);
  expect(policy.test("Aa1 aaaa")).toBe(false);
});

it("documents the display identifier in the capability-authorized account directory", () => {
  const response = accountOpenApi.paths["/v1/users"].get.responses["200"] as {
    content: {
      "application/json": {
        schema: {
          properties: {
            items: {
              items: {
                properties: {
                  luminovia_user_id: { type: string; description: string };
                };
              };
            };
          };
        };
      };
    };
  };

  expect(
    response.content["application/json"].schema.properties.items.items,
  ).toHaveProperty("properties.luminovia_user_id.type", "string");
  expect(
    response.content["application/json"].schema.properties.items.items
      .properties.luminovia_user_id.description,
  ).toMatch(/not an account lookup/i);
  expect(accountOpenApi.paths["/v1/users"].get.description).toMatch(
    /users\.manage/,
  );
});

it("accepts an eight-character password after caller-scoped reservation", async () => {
  const test = fixture();
  const response = await test.request(payload);

  expect(response.status).toBe(201);
  const parsed = successSchema("/v1/users", "post", 201).parse(
    await response.json(),
  );
  expect(parsed).toEqual({
    status: "created",
    creation_id: creationId,
    user_id: userId,
  });
  expect(test.calls).toEqual(["reserve", "create", "complete"]);
});

it("rejects a seven-character password before reservation or Auth creation", async () => {
  const test = fixture();
  const response = await test.request({ ...payload, password: "Aa1!aaa" });

  expect(response.status).toBe(400);
  expect(test.calls).toEqual([]);
});

function successSchema(
  path: keyof typeof accountOpenApi.paths,
  method: string,
  status = 200,
) {
  const methods = accountOpenApi.paths[path] as Record<
    string,
    {
      responses: Record<
        number,
        { content?: Record<string, { schema: unknown }> }
      >;
    }
  >;
  const schema =
    methods[method].responses[status].content?.["application/json"].schema;
  expect(schema).toBeDefined();
  return z.fromJSONSchema(schema as z.core.JSONSchema.JSONSchema);
}

it("validates the HTTP account, role, invitation and deletion responses against the published schema", async () => {
  const account = {
    profile: {
      id: userId,
      luminovia_user_id: "LV-ABCD-1234-5678-9012-BCDE",
      display_name: "Fictional user",
      bio_de: "",
      bio_en: "",
      phone: null,
      time_zone: "UTC",
      locale: "en",
      active: true,
      created_at: "2040-05-01T10:00:00Z",
      email: "fictional-user@example.invalid",
    },
    roles: ["lecturer"],
    permissions: [],
  };
  const operation = {
    operation_id: creationId,
    status: "completed" as const,
    kind: "job",
    id: userId,
  };
  const pending = { ...operation, status: "pending" };
  const responses: Record<string, unknown> = {
    account_me: account,
    save_account_profile: account,
    account_role_catalog: [
      { role: "lecturer", permissions: [], assignable: true },
    ],
    set_account_roles: { id: userId, roles: ["lecturer"] },
    set_account_roles_with_organisation: null,
    manage_client_organisation: null,
    deletion_access: { can_admin: true, kinds: ["job", "account"] },
    deletion_resources: {
      items: [
        {
          id: userId,
          kind: "job",
          label: "Fictional job",
          owner_label: "",
          can_delete: true,
        },
      ],
      next_cursor: null,
    },
    deletion_preview: {
      plan_id: creationId,
      id: userId,
      kind: "job",
      label: "Fictional job",
      counts: { "public.jobs": 1 },
      blockers: [{ code: "depends_on", kind: "invoice", count: 2 }],
      can_confirm: false,
      expires_at: "2040-05-01T10:00:00Z",
    },
    deletion_operations: { items: [pending] },
    deletion_confirm: pending,
    reserve_account_creation: {
      status: "created",
      creation_id: creationId,
      user_id: userId,
    },
    reserve_account_invitation: { status: "in_progress" },
  };
  let complete = true;
  const appOrigin = "http://127.0.0.1:6473";
  const handler = createAccountHandler({
    origins: [appOrigin],
    appOrigin,
    invitationsEnabled: true,
    authenticate: async () => true,
    openapi: accountOpenApi,
    rpc: async (_token, name) => {
      expect(responses).toHaveProperty(name);
      return { data: responses[name] };
    },
    createAccount: async () => {
      throw new Error("unexpected creation");
    },
    completeAccount: async () => {},
    removeCreatedAccount: async () => {},
    sendInvitation: async () => {
      throw new Error("unexpected email");
    },
    completeInvitation: async () => {},
    executeDeletion: async () =>
      complete ? operation : { ...operation, status: "pending" },
  });
  const verify = async (
    template: keyof typeof accountOpenApi.paths,
    path: string = template,
    method = "GET",
    body?: object,
    status = 200,
  ) => {
    const response = await handler(
      new Request(`http://localhost/accounts${path}`, {
        method,
        headers: {
          authorization: "Bearer fictional-test-token",
          origin: appOrigin,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    expect(response.status).toBe(status);
    const data = await response.json();
    expect(
      successSchema(template, method.toLowerCase(), status).safeParse(data)
        .success,
    ).toBe(true);
    return data;
  };

  await verify("/v1/me");
  await verify("/v1/me", "/v1/me", "PATCH", { locale: "en" });
  await verify("/v1/roles");
  await verify("/v1/users", "/v1/users", "POST", payload);
  const person = `/v1/users/${userId}`;
  await verify("/v1/users/{id}/roles", `${person}/roles`, "PUT", {
    roles: ["lecturer"],
  });
  const assigned = await verify(
    "/v1/users/{id}/roles",
    `${person}/roles`,
    "PUT",
    {
      roles: ["client"],
      organisation_id: creationId,
    },
  );
  expect(assigned).toBeNull();
  for (const method of ["PUT", "DELETE"])
    await verify(
      "/v1/users/{id}/organisations/{organisationId}",
      `${person}/organisations/${creationId}`,
      method,
    );
  await verify("/v1/invitations", "/v1/invitations", "POST", {
    email: "fictional@example.invalid",
    idempotency_key: creationId,
  });
  await verify("/v1/deletions/access");
  await verify("/v1/deletions/resources", "/v1/deletions/resources?kind=job");
  await verify("/v1/deletions/preview", "/v1/deletions/preview", "POST", {
    kind: "job",
    id: userId,
  });
  await verify("/v1/deletions/operations");
  const confirm = {
    plan_id: creationId,
    request_id: userId,
    confirmation: "DELETE",
  };
  await verify(
    "/v1/deletions/confirm",
    "/v1/deletions/confirm",
    "POST",
    confirm,
  );
  const resume = `/v1/deletions/operations/${creationId}`;
  await verify("/v1/deletions/operations/{id}", resume, "POST", {});
  complete = false;
  await verify(
    "/v1/deletions/confirm",
    "/v1/deletions/confirm",
    "POST",
    confirm,
    202,
  );
  await verify("/v1/deletions/operations/{id}", resume, "POST", {}, 202);
  expect(
    successSchema("/v1/deletions/confirm", "post").safeParse(pending).success,
  ).toBe(false);
  expect(
    successSchema("/v1/me", "get").safeParse({
      ...account,
      service_role_key: "forbidden",
    }).success,
  ).toBe(false);
});
