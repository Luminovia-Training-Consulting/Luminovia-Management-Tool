/** Verifies the LRS transport using a disposable loopback server and fictional records. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { deliverXapiArchive } from "./xapi-lrs-delivery.mjs";

const statement = {
  id: randomUUID(),
  timestamp: "2026-11-26T01:00:00Z",
  actor: {
    objectType: "Agent",
    account: { homePage: "https://luminovia.org", name: "a".repeat(64) },
  },
  verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
  object: {
    objectType: "Activity",
    id: "https://luminovia.org/xapi/activities/course/" + "b".repeat(64),
  },
  result: { completion: true },
};
const archive = {
  profile: "luminovia-lms-1",
  xapi_version: "1.0.3",
  statements: [statement],
};
const basic = { username: "fictional-user", password: "fictional-password" };

test("retries a transient receipt with the same request ID, credentials and stored body", async (context) => {
  const received = [];
  const server = createServer(async (request, response) => {
    const buffers = [];
    for await (const buffer of request) buffers.push(buffer);
    received.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: JSON.parse(Buffer.concat(buffers)),
    });
    response.writeHead(received.length === 1 ? 503 : 204).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const config = {
    ...basic,
    endpoint: `http://127.0.0.1:${server.address().port}/lrs`,
  };
  assert.deepEqual(await deliverXapiArchive(archive, config), {
    submitted: 1,
    retries: 1,
    pending: 0,
    failure: null,
  });
  assert.deepEqual(await deliverXapiArchive(archive, config), {
    submitted: 1,
    retries: 0,
    pending: 0,
    failure: null,
  });
  assert.equal(received.length, 3);
  for (const event of received) {
    assert.equal(event.url, "/lrs/statements?statementId=" + statement.id);
    assert.equal(event.method, "PUT");
    assert.equal(
      event.headers.authorization,
      "Basic " +
        Buffer.from("fictional-user:fictional-password").toString("base64"),
    );
    assert.equal(event.headers["x-experience-api-version"], "1.0.3");
    assert.deepEqual(event.body, statement);
  }
  await assert.rejects(
    deliverXapiArchive(
      { ...archive, statements: [statement, statement] },
      config,
    ),
    /unique/,
  );
  assert.equal(received.length, 3);
});

test("never follows an LRS redirect or retries a conflicting statement", async (context) => {
  const statuses = [302, 409];
  const server = createServer((request, response) => {
    request.resume();
    response
      .writeHead(statuses.shift(), {
        Location: "https://unapproved.example.invalid/xapi",
      })
      .end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const config = {
    ...basic,
    endpoint: `http://127.0.0.1:${server.address().port}/lrs`,
  };
  for (const failure of [302, 409]) {
    assert.deepEqual(await deliverXapiArchive(archive, config), {
      submitted: 0,
      retries: 0,
      pending: 1,
      failure,
    });
  }
  assert.equal(statuses.length, 0);
  await assert.rejects(
    deliverXapiArchive(archive, {
      ...basic,
      endpoint: "http://example.invalid/lrs",
    }),
    /HTTPS/,
  );
});
