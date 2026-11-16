/** Upload-lease tests hold real promises across delayed writes and failures;
 * PostgreSQL/Storage race behavior is covered separately by isolated fixtures. */
import assert from "node:assert/strict";
import { withUploadLease } from "./deletion-lease.ts";
Deno.test("unknown remote write outcome retains the lease after client transport failure", async () => {
  let released = false;
  let finishRemote!: () => void;
  const remote = new Promise<void>((resolve) => {
    finishRemote = resolve;
  });
  await assert.rejects(() =>
    withUploadLease({
      begin: async () => "lease",
      end: async () => {
        released = true;
      },
    }, (writes) => {
      writes.begin();
      // The server accepted work but the response connection was lost. The
      // caller's rejection is deliberately independent of backend completion.
      void remote.then(() => {
        assert.equal(released, false);
      });
      return Promise.reject(new Error("transport_lost"));
    }), /transport_lost/);
  assert.equal(released, false);
  finishRemote();
  await remote;
  assert.equal(released, false);
});
Deno.test("all remote writes need definite acknowledgements before release or success", async () => {
  let released = 0;
  const deps = {
    begin: async () => "lease",
    end: async () => {
      released++;
    },
  };
  await assert.rejects(() =>
    withUploadLease(deps, async (writes) => {
      const first = writes.begin();
      writes.begin();
      first();
      first();
      return 200;
    }), /deletion_unavailable/);
  assert.equal(released, 0);
  assert.equal(
    await withUploadLease(deps, async (writes) => {
      const quarantine = writes.begin();
      quarantine();
      const clean = writes.begin();
      clean();
      return 200;
    }),
    200,
  );
  assert.equal(released, 1);
});
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
