import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  dropTestDatabaseTemplate,
  prepareTestDatabaseTemplate,
} from "./testing/database.mjs";

const container = "supabase_db_luminovia-portal-test-12345678";
const template = "portal_test_template_12345678";

test("prepares one isolated template from every exact migration in version order", async () => {
  const commands = [];
  await prepareTestDatabaseTemplate({
    container,
    template,
    execute: async (sql, database) => commands.push({ sql, database }),
  });
  const files = readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.equal(
    commands[0].sql,
    `create database ${template} template template0`,
  );
  assert.equal(commands[0].database, "postgres");
  assert.equal(commands[1].database, template);
  assert.match(commands[1].sql, /create schema auth;create schema extensions/);
  assert.equal(commands.length, files.length + 2);
  for (let index = 0; index < files.length; index++) {
    assert.equal(commands[index + 2].database, template);
    assert.equal(
      commands[index + 2].sql,
      readFileSync(
        new URL(`../supabase/migrations/${files[index]}`, import.meta.url),
        "utf8",
      ),
    );
  }
});

test("refuses invalid template names and non-owned containers before SQL", async () => {
  let calls = 0;
  const execute = async () => calls++;
  await assert.rejects(
    prepareTestDatabaseTemplate({
      container,
      template: "postgres",
      execute,
    }),
    /random isolated SQL template/,
  );
  await assert.rejects(
    prepareTestDatabaseTemplate({
      container: "supabase_db_production",
      template,
      execute,
    }),
    /owned isolated portal test database/,
  );
  await dropTestDatabaseTemplate({ container, template, execute });
  assert.equal(calls, 1);
});

test("drops exactly the current run's owned migration template", async () => {
  const commands = [];
  await dropTestDatabaseTemplate({
    container,
    template,
    execute: async (sql) => commands.push(sql),
  });
  assert.deepEqual(commands, [
    `drop database if exists ${template} with (force)`,
  ]);
});
