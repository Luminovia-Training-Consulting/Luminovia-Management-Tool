/** Upload-lease tests hold real promises across delayed writes and failures;
 * PostgreSQL/Storage race behavior is covered separately by isolated fixtures. */
import assert from "node:assert/strict";
import { withUploadLease } from "./deletion-lease.ts";
Deno.test("lease remains held until delayed promotion and cleanup settle", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const upload = withUploadLease({
    begin: async () => {
      calls.push("begin");
      return "lease";
    },
    end: async (id) => {
      assert.equal(id, "lease");
      calls.push("end");
    },
  }, async () => {
    calls.push("write");
    await pending;
    calls.push("cleanup");
    return 200;
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["begin", "write"]);
  release();
  assert.equal(await upload, 200);
  assert.deepEqual(calls, ["begin", "write", "cleanup", "end"]);
});
Deno.test("failure releases lease after the writer stops; rejected begin never writes", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () =>
      withUploadLease({
        begin: async () => "lease",
        end: async () => {
          calls.push("end");
        },
      }, async () => {
        calls.push("write");
        throw new Error("scanner");
      }),
    /scanner/,
  );
  assert.deepEqual(calls, ["write", "end"]);
  await assert.rejects(() =>
    withUploadLease({
      begin: async () => {
        throw new Error("fenced");
      },
      end: async () => {
        calls.push("unexpected");
      },
    }, async () => {
      calls.push("unexpected");
    }), /fenced/);
  assert.deepEqual(calls, ["write", "end"]);
});
Deno.test("uncertain lease release cannot return a successful upload acknowledgement", async () => {
  await assert.rejects(
    () =>
      withUploadLease({
        begin: async () => "lease",
        end: async () => {
          throw new Error("deletion_unavailable");
        },
      }, async () => 200),
    /deletion_unavailable/,
  );
});
