/** Exercise the actual account Edge handler and its published request contract with isolated dependencies. */
import { expect, it } from "vitest";
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

it("documents the public ID only in the capability-authorized account directory", () => {
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
  expect(await response.json()).not.toHaveProperty("password");
  expect(test.calls).toEqual(["reserve", "create", "complete"]);
});

it("rejects a seven-character password before reservation or Auth creation", async () => {
  const test = fixture();
  const response = await test.request({ ...payload, password: "Aa1!aaa" });

  expect(response.status).toBe(400);
  expect(test.calls).toEqual([]);
});
