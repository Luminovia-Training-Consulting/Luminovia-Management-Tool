/** Disposable PostgreSQL replay with fictional captured policies; no private production rates are used. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
await withTestDatabase("role_job_discovery", async ({ sql, actor }) => {
  const [regular, senior, manager, admin, org, a, b, legacy] = Array.from(
    { length: 8 },
    randomUUID,
  );
  await sql(
    `insert into auth.users(id,email)values ${[regular, senior, manager, admin].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};insert into public.user_roles(user_id,role)values(${q(regular)},'lecturer'),(${q(senior)},'senior_lecturer'),(${q(manager)},'management'),(${q(admin)},'admin');insert into public.organisations(id,name)values(${q(org)},'Fictional captured policy academy');insert into private.compensation_policy(singleton,version,regular_percent,senior_percent,updated_by)values(true,1,10,90,${q(admin)});`,
  );
  for (const [id, title, amount, customer] of [
    [a, "Captured policy A", 0, "RoleSplit"],
    [b, "Captured policy B", 0, "RoleSplit"],
    [legacy, "Legacy quote", 250, "Legacy"],
  ])
    await sql(
      `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,terms_version,requires_contract)values(${q(id)},${q(title)},${q(customer)},'online','published',${amount},${amount},'EUR','fixed_total','Fictional terms',3,false);insert into public.job_sessions(job_id,starts_at,ends_at)values(${q(id)},'2099-04-01T08:00:00Z','2099-04-01T09:00:00Z');`,
    );
  for (const [id, gross, regularPercent, seniorPercent] of [
    [a, 1000, 20, 50],
    [b, 500, 60, 80],
  ])
    await sql(
      `insert into private.job_commission_offers(job_id,organisation_id,gross_amount,gross_total_amount,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency,pricing_mode,regular_percent,senior_percent,policy_version)values(${q(id)},${q(org)},${gross},${gross},0,0,0,'EUR','role_split',${regularPercent},${seniorPercent},1);`,
    );
  const rpc = async (who, name, args = []) =>
    JSON.parse(
      await actor(
        who,
        `select public.${name}(${args.join(",")})`,
        who === manager || who === admin ? "aal2" : "aal1",
      ),
    );
  const discover = (who, filter = {}, cursor = null, limit = 50) =>
    rpc(who, "job_discovery", [
      q(JSON.stringify(filter)),
      cursor ? q(JSON.stringify(cursor)) : "null",
      String(limit),
    ]);
  const detail = (who, id) => rpc(who, "job_detail", [q(id)]);
  let count = 0;
  const check = async (name, fn) => {
    await fn();
    count++;
    console.log("PASS " + name);
  };
  await check(
    "Current regular/senior quotes use captured offer policy, never public zero or mutable global percentages",
    async () => {
      const r = await detail(regular, a),
        s = await detail(senior, a);
      assert.equal(r.amount, 200);
      assert.equal(r.total_amount, 200);
      assert.equal(r.terms_version, 31);
      assert.equal(s.amount, 500);
      assert.equal(s.terms_version, 32);
      assert.equal((await detail(regular, b)).amount, 300);
      assert.equal((await detail(senior, b)).amount, 400);
      assert.equal(
        await actor(
          regular,
          `select (amount=0 and total_amount=0)::text from public.jobs where id=${q(a)}`,
        ),
        "true",
      );
      assert.ok(!JSON.stringify(r).includes("percent"));
      assert.ok(!JSON.stringify(r).includes("gross"));
      assert.ok(!JSON.stringify(r).includes("policy_version"));
    },
  );
  await check(
    "Price filters and ascending/descending keyset order operate on the same current actor quote",
    async () => {
      const filter = {
        customer: "RoleSplit",
        currency: "EUR",
        sort: "total_asc",
      };
      const first = await discover(regular, filter, null, 1),
        second = await discover(regular, filter, first.next_cursor, 1);
      assert.equal(first.items[0].id, a);
      assert.equal(second.items[0].id, b);
      assert.equal(second.has_more, false);
      assert.deepEqual(
        (await discover(senior, filter)).items.map((i) => i.id),
        [b, a],
      );
      assert.deepEqual(
        (await discover(senior, { ...filter, sort: "total_desc" })).items.map(
          (i) => i.id,
        ),
        [a, b],
      );
      assert.deepEqual(
        (await discover(regular, { ...filter, min_total: 250 })).items.map(
          (i) => i.id,
        ),
        [b],
      );
      assert.deepEqual(
        (await discover(senior, { ...filter, max_total: 450 })).items.map(
          (i) => i.id,
        ),
        [b],
      );
      assert.deepEqual(
        (
          await discover(regular, {
            ...filter,
            unit: "fixed_total",
            min_rate: 250,
            sort: "rate_desc",
          })
        ).items.map((i) => i.id),
        [b],
      );
    },
  );
  await check(
    "Nonlecturer managers receive null prospective rates with stable unknown-last paging and no price-bound match",
    async () => {
      const item = await detail(manager, a);
      assert.equal(item.amount, null);
      assert.equal(item.total_amount, null);
      assert.equal(item.terms_version, 3);
      assert.equal(
        (await discover(manager, { currency: "EUR", min_total: 0 })).items.some(
          (i) => i.id === a || i.id === b,
        ),
        false,
      );
      const filter = { currency: "EUR", sort: "total_asc" },
        first = await discover(manager, filter, null, 1);
      assert.equal(first.items[0].id, legacy);
      const rest = await discover(manager, filter, first.next_cursor, 2);
      assert.equal(rest.items.length, 2);
      assert.ok(rest.items.every((i) => i.total_amount === null));
      assert.equal(rest.has_more, false);
      assert.equal(
        (await discover(manager, { currency: "EUR", sort: "total_desc" }))
          .items[0].id,
        legacy,
      );
    },
  );
  await check(
    "Exact detail and dashboard suggestions carry identical role quote and consent version",
    async () => {
      const dashboard = await rpc(regular, "job_dashboard");
      assert.ok(dashboard.suggestions.length > 0);
      for (const suggestion of dashboard.suggestions) {
        const exact = await detail(regular, suggestion.id);
        assert.equal(suggestion.total_amount, exact.total_amount);
        assert.equal(suggestion.terms_version, exact.terms_version);
      }
      const managed = await rpc(manager, "job_dashboard");
      for (const suggestion of managed.suggestions.filter(
        (i) => i.id === a || i.id === b,
      ))
        assert.equal(suggestion.total_amount, null);
      assert.equal((await detail(regular, legacy)).amount, 250);
      assert.equal((await detail(regular, legacy)).terms_version, 3);
    },
  );
  await check(
    "Tier change invalidates old page/consent while fresh quotes use current captured tier",
    async () => {
      const filter = {
          customer: "RoleSplit",
          currency: "EUR",
          sort: "total_asc",
        },
        page = await discover(regular, filter, null, 1);
      await sql(
        `insert into public.user_roles(user_id,role)values(${q(regular)},'senior_lecturer')`,
      );
      await assert.rejects(
        discover(regular, filter, page.next_cursor, 1),
        /22023/,
      );
      assert.equal((await detail(regular, a)).terms_version, 32);
      assert.equal(
        (await rpc(regular, "claim_job", [q(a), q(randomUUID()), "31"])).status,
        "terms_changed",
      );
      assert.equal((await detail(regular, a)).total_amount, 500);
    },
  );
  await check(
    "Policy context invalidates stale cursor without rewriting an existing captured quote",
    async () => {
      const filter = {
          customer: "RoleSplit",
          currency: "EUR",
          sort: "rate_asc",
          unit: "fixed_total",
        },
        page = await discover(senior, filter, null, 1);
      await sql(
        "update private.compensation_policy set version=2,regular_percent=11,senior_percent=91",
      );
      await assert.rejects(
        discover(senior, filter, page.next_cursor, 1),
        /22023/,
      );
      assert.equal((await detail(senior, a)).amount, 500);
      await sql(
        `update public.profiles set active=false where id=${q(senior)}`,
      );
      await assert.rejects(detail(senior, a), /42501/);
      await assert.rejects(
        actor(regular, `select * from private.job_discovery_quote(${q(a)})`),
        /42501/,
      );
    },
  );
  console.log(`${count} real role-aware discovery PostgreSQL groups passed.`);
});
