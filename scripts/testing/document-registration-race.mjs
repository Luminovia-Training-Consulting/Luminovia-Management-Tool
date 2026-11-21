/** Observe two real SQL operations waiting on one owned document row, including
 * PostgreSQL's intervening tuple-lock queue. No timing-only race is accepted. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { quoteSql as q } from "./database.mjs";

/** Release the fixture's lock only after both operations have an observed row
 * dependency on it. Operations own their authentic actor/SQL setup; this helper
 * never manufactures application authority or changes a business function. */
export async function documentRegistrationRace({
  sql,
  container,
  database,
  document,
  operations,
}) {
  assert.equal(operations.length, 2);
  const holder = "document_gate_" + randomUUID(),
    marker = "held_" + randomUUID();
  const child = spawn("docker", [
    "exec",
    "-i",
    container,
    "psql",
    "-U",
    "postgres",
    "-d",
    database,
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
  ]);
  let output = "",
    error = "",
    observer,
    closed = false;
  const completion = new Promise((resolve) => {
    child.on("error", (cause) => (error += cause.message));
    child.on("close", (code) => {
      closed = true;
      observer?.();
      resolve({ code, error });
    });
  });
  child.stdout.on("data", (data) => {
    output += data;
    observer?.();
  });
  child.stderr.on("data", (data) => (error += data));
  const requests = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Document hold point timed out: " + error)),
        7000,
      );
      observer = () => {
        if (output.includes(marker)) {
          clearTimeout(timer);
          resolve();
        } else if (closed) {
          clearTimeout(timer);
          reject(new Error(error || output));
        }
      };
      child.stdin.write(
        `begin;set local application_name=${q(holder)};set local idle_in_transaction_session_timeout='10s';select id from public.documents where id=${q(document)}for update;\n\\echo ${marker}\n`,
      );
    });
    observer = undefined;
    for (const operation of operations) {
      const tag = "document_waiter_" + randomUUID();
      // Handle rejection immediately while deliberately retaining the lock.
      requests.push(
        operation(tag).then(
          (value) => ({ value }),
          (error) => ({ error }),
        ),
      );
      const deadline = Date.now() + 5000;
      let observed = false;
      while (Date.now() < deadline) {
        const dependency = await sql(
          `with recursive blockers(pid)as(select unnest(pg_blocking_pids(w.pid))from pg_stat_activity w where w.datname=${q(database)}and w.application_name=${q(tag)}and w.wait_event_type='Lock'and w.wait_event in('transactionid','tuple')union select unnest(pg_blocking_pids(b.pid))from blockers b)select exists(select 1 from blockers b join pg_stat_activity h on h.pid=b.pid where h.application_name=${q(holder)})`,
        );
        if (dependency === "t") {
          observed = true;
          break;
        }
        await delay(20);
      }
      assert.ok(
        observed,
        "Actual document row/tuple-queue wait must be observed",
      );
    }
  } finally {
    if (!closed) child.stdin.end("rollback;\n\\q\n");
    const result = await completion;
    // Always settle the started operations before the UUID fixture is dropped.
    await Promise.all(requests);
    assert.equal(result.code, 0, result.error);
  }
  return await Promise.all(requests);
}
