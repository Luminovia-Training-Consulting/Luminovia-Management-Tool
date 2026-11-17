/** Real post-wait authority regressions in an owned SQL fixture. Revocation
 * owns the caller profile and request gate first; pg_blocking_pids proves the
 * public operation has reached that exact transaction before it commits.
 * Native Auth tokens/Storage/browser acceptance remain separate. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

/** Keep one explicitly owned transaction open until its observed waiter exists. */
async function hold(fixture, body) {
  const marker = "authority_" + randomUUID().replaceAll("-", "");
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      fixture.container,
      "psql",
      "-U",
      "postgres",
      "-d",
      fixture.database,
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "",
    error = "",
    finished = false;
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(Error(error || "Owned authority transaction failed")),
    );
  });
  void closed.catch(() => {});
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Owned authority transaction not ready")),
      10000,
    );
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const line = output
        .split("\n")
        .find((value) => value.startsWith(marker + ":"));
      if (line) {
        clearTimeout(timer);
        resolve(Number(line.slice(marker.length + 1)));
      }
    });
    child.stderr.on("data", (chunk) => (error += chunk));
    child.once("error", (reason) => {
      clearTimeout(timer);
      reject(reason);
    });
    child.once("close", () => {
      clearTimeout(timer);
      reject(Error(error || "Authority holder closed before readiness"));
    });
  });
  child.stdin.write(
    `begin;${body};select ${q(marker + ":")}||pg_backend_pid();\n`,
  );
  return {
    pid: await ready,
    finish: async () => {
      if (!finished) {
        finished = true;
        child.stdin.end("commit;\n\\q\n");
      }
      await closed;
    },
  };
}

/** Require this operation to be blocked by the exact revocation backend. */
async function waitBlocked(sql, request, holder) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (
      (await sql(
        `select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and position(${q(request)} in query)>0 and ${holder}=any(pg_blocking_pids(pid)))`,
      )) === "t"
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error(
    "The public operation never waited for its exact revocation transaction",
  );
}

await withTestDatabase("operations_authority", async (fixture) => {
  const { sql, actor } = fixture;
  const [admin, original, successor, manager, requester] = Array.from(
    { length: 5 },
    randomUUID,
  );
  await sql(
    `insert into auth.users(id,email)values ${[admin, original, successor, manager, requester].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};insert into public.user_roles(user_id,role)values(${q(admin)},'admin'),(${q(original)},'lecturer'),(${q(successor)},'lecturer'),(${q(manager)},'management'),(${q(requester)},'lecturer');update public.profiles set active=true where id in (${[admin, original, successor, manager, requester].map(q).join(",")});`,
  );
  const call = (who, expression, aal = "aal1") =>
    actor(who, "select " + expression, aal);
  const json = async (...args) => JSON.parse(await call(...args));
  const adminCall = (expression) => call(admin, expression, "aal1");
  let checks = 0;
  const check = async (name, run) => {
    await run();
    checks++;
    console.log("PASS " + name);
  };
  const roles = (who, role) =>
    `public.set_account_roles(${q(who)},array[${q(role)}]::text[])`;
  const status = (who, active) => `public.set_user_active(${q(who)},${active})`;
  /** Real account mutation stays uncommitted while the operation sees its old
   * role. Holding both gates accepts either correct guard placement, without
   * forcing a profile/request lock inversion after the implementation changes. */
  const revokedWhileWaiting = async ({
    who,
    request,
    gate,
    revoke,
    operation,
  }) => {
    const holder = await hold(
      fixture,
      `select 1 from public.profiles where id=${q(who)} for update;select pg_advisory_xact_lock(pg_catalog.hashtextextended(${q(gate)},0));set local role authenticated;set local request.jwt.claims=${q(JSON.stringify({ sub: admin, aal: "aal1", role: "authenticated" }))};select ${revoke};reset role`,
    );
    const pending = operation().then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    try {
      await waitBlocked(sql, request, holder.pid);
    } finally {
      await holder.finish();
    }
    return pending;
  };
  const denied = (outcome) =>
    assert.match(
      String(outcome.error?.message),
      /42501/,
      "A winning revocation must deny the waiting public operation",
    );
  const job = await adminCall(
    `public.create_job(${q(JSON.stringify({ title: "Fictional authority replacement", customer_name: "Fictional authority academy", delivery_type: "online", location: "https://example.invalid/class", status: "published", amount: 100, total_amount: 100, currency: "EUR", rate_unit: "fixed_total", terms: "Fictional retained consent", requires_contract: false, sessions: [{ starts_at: "2049-01-01T08:00Z", ends_at: "2049-01-01T09:00Z" }] }))})`,
  );
  const first = await json(
    original,
    `public.claim_job(${q(job)},${q(randomUUID())},1)`,
  );
  assert.equal(first.status, "confirmed");
  const offer = await call(
    original,
    `public.request_replacement(${q(first.claim_id)},'Fictional scheduling conflict','open','{}',false,${q(randomUUID())})`,
  );
  const replacementRequest = randomUUID();
  const receipt = await json(
    successor,
    `public.claim_replacement(${q(offer)},1,1,${q(replacementRequest)})`,
  );
  assert.equal(receipt.status, "confirmed");
  const receiptBefore = await sql(
    `select result::text from private.replacement_requests where actor_id=${q(successor)} and request_id=${q(replacementRequest)}`,
  );
  // Compare complete persisted business rows, including any installed revenue
  // and invoice entries. An empty ledger remains explicitly empty; this legacy
  // net fixture does not invent commissioned revenue for a stronger assertion.
  const handoverState = async () =>
    JSON.parse(
      await sql(`select jsonb_build_object(
      'job',(select to_jsonb(j) from public.jobs j where j.id=${q(job)}),
      'claims',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.job_claims c where c.job_id=${q(job)}),
      'allocations',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.job_id=${q(job)}),
      'revenue',(select coalesce(jsonb_agg(to_jsonb(l) order by l.claim_id),'[]'::jsonb) from private.claim_revenue_ledger l where l.job_id=${q(job)}),
      'commission',(select coalesce(jsonb_agg(to_jsonb(o) order by o.job_id),'[]'::jsonb) from private.job_commission_offers o where o.job_id=${q(job)}),
      'claim_events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) from public.claim_events e join public.job_claims c on c.id=e.claim_id where c.job_id=${q(job)}),
      'invoice_items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.invoice_id,i.claim_id),'[]'::jsonb) from public.invoice_items i join public.job_claims c on c.id=i.claim_id where c.job_id=${q(job)}),
      'replacement_offers',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]'::jsonb) from private.replacement_offers o join public.job_claims c on c.id=o.original_claim_id where c.job_id=${q(job)}),
      'replacement_receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.actor_id,r.request_id),'[]'::jsonb) from private.replacement_requests r where r.payload->>'offer'=${q(offer)} or r.payload->>'claim'=${q(first.claim_id)})
    )`),
    );
  const businessBefore = await handoverState();
  assert.equal(businessBefore.claims.length, 2);
  assert.equal(businessBefore.allocations.length, 2);
  assert.ok(businessBefore.claim_events.length > 0);
  for (const change of ["role", "suspension"]) {
    await check(
      `a winning ${change} withdrawal prevents a waiting replacement retry from returning its stored success`,
      async () => {
        const result = await revokedWhileWaiting({
          who: successor,
          request: replacementRequest,
          gate: "replacement:" + successor + replacementRequest,
          revoke:
            change === "role"
              ? roles(successor, "guest")
              : status(successor, false),
          operation: () =>
            json(
              successor,
              `public.claim_replacement(${q(offer)},1,1,${q(replacementRequest)})`,
            ),
        });
        denied(result);
        assert.equal(
          await sql(
            `select result::text from private.replacement_requests where actor_id=${q(successor)} and request_id=${q(replacementRequest)}`,
          ),
          receiptBefore,
        );
        assert.equal(
          await sql(
            `select status from public.job_claims where id=${q(receipt.claim_id)}`,
          ),
          "confirmed",
        );
        assert.deepEqual(await handoverState(), businessBefore);
        await adminCall(
          change === "role"
            ? roles(successor, "lecturer")
            : status(successor, true),
        );
      },
    );
  }
  const run = await sql(
    `select course_run_id from public.jobs where id=${q(job)}`,
  );
  await check(
    "course management revoked during the preparation gate wait cannot confirm a schedule",
    async () => {
      const request = randomUUID();
      const result = await revokedWhileWaiting({
        who: manager,
        request,
        gate: "course-readiness:" + run,
        revoke: roles(manager, "guest"),
        operation: () =>
          call(
            manager,
            `public.confirm_course_sessions(${q(run)},0,${q(request)})`,
            "aal1",
          ),
      });
      denied(result);
      assert.equal(
        await sql(
          `select count(*) from private.course_readiness_requests where actor_id=${q(manager)} and request_id=${q(request)}`,
        ),
        "0",
      );
      await adminCall(roles(manager, "management"));
    },
  );
  const ticketRequest = randomUUID();
  const ticketPayload = q(
    JSON.stringify({
      title: "Fictional waiting support question",
      category: "technical",
      description: "Fictional private authority check",
    }),
  );
  const ticket = await call(
    requester,
    `public.create_support_ticket(${ticketPayload},${q(ticketRequest)})`,
  );
  await check(
    "revoked support management cannot append an internal note after waiting",
    async () => {
      const request = randomUUID();
      const result = await revokedWhileWaiting({
        who: manager,
        request,
        gate: "support:" + manager,
        revoke: roles(manager, "guest"),
        operation: () =>
          call(
            manager,
            `public.update_support_ticket(${q(ticket)},'internal_note',${q(JSON.stringify({ body: "Fictional confidential internal note" }))},1,${q(request)})`,
            "aal1",
          ),
      });
      denied(result);
      assert.equal(
        await sql(
          `select count(*) from private.support_messages where ticket_id=${q(ticket)} and internal`,
        ),
        "0",
      );
    },
  );
  await check(
    "a suspended requester cannot retrieve a waiting support-create retry receipt",
    async () => {
      const result = await revokedWhileWaiting({
        who: requester,
        request: ticketRequest,
        gate: "support:" + requester,
        revoke: status(requester, false),
        operation: () =>
          call(
            requester,
            `public.create_support_ticket(${ticketPayload},${q(ticketRequest)})`,
          ),
      });
      denied(result);
      assert.equal(
        await sql(
          `select count(*) from private.support_tickets where requester_id=${q(requester)}`,
        ),
        "1",
      );
    },
  );
  await check(
    "the existing delivery profile guard rejects a suspension that wins before a draft",
    async () => {
      const allocation = await sql(
          `select id from public.assignment_sessions where claim_id=${q(receipt.claim_id)} limit 1`,
        ),
        request = randomUUID();
      const draft = q(
        JSON.stringify({
          outcome: "cancelled",
          actual_start: null,
          actual_end: null,
          time_zone: "UTC",
          notes: "Fictional cancelled teaching",
          correction_reason: "",
        }),
      );
      const result = await revokedWhileWaiting({
        who: successor,
        request,
        gate: "delivery-request:" + successor + ":" + request,
        revoke: status(successor, false),
        operation: () =>
          call(
            successor,
            `public.save_delivery_draft(${q(allocation)},0,${draft},${q(request)})`,
          ),
      });
      denied(result);
      assert.equal(
        await sql(
          `select count(*) from private.delivery_operations where actor_id=${q(successor)} and request_id=${q(request)}`,
        ),
        "0",
      );
    },
  );
  console.log(
    `${checks} observed post-wait operational authority groups passed.`,
  );
});
