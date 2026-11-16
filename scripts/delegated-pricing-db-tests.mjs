/** Real PostgreSQL upgrade/permission/quote privacy checks; disposable UUID database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
let checks = 0;
const check = async (name, run) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};
await withTestDatabase(
  "delegated_pricing",
  async ({ sql, actor }) => {
    const owner = randomUUID(),
      admin = randomUUID(),
      manager = randomUUID(),
      teacher = randomUUID(),
      senior = randomUUID(),
      company = randomUUID(),
      guest = randomUUID(),
      org = randomUUID();
    const ids = [owner, admin, manager, teacher, senior, company, guest];
    await sql(
      `insert into auth.users(id,email) values${ids.map((id) => `('${id}','${id}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role) values('${owner}','owner'),('${admin}','admin'),('${manager}','management'),('${teacher}','lecturer'),('${senior}','senior_lecturer'),('${company}','client'),('${guest}','participant');insert into public.organisations(id,name) values('${org}','Fictional private pricing customer');`,
    );
    const rpc = (who, name, args = [], aal = "aal1") =>
      actor(
        who,
        `select ${["client_organisations", "client_requests"].includes(name) ? "coalesce(json_agg(x),'[]') from " : ""}public.${name}(${args.map((value) => (value === null ? "null" : typeof value === "boolean" || typeof value === "number" ? String(value) : q(value))).join(",")}) ${["client_organisations", "client_requests"].includes(name) ? "x" : ""}`,
        aal,
      ).then((value) => {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      });
    const payload = (day, gross = 100.01) => ({
      title: `Fictional role pricing ${day}`,
      delivery_type: "online",
      time_zone: "Europe/Berlin",
      gross_amount: gross,
      gross_total_amount: gross,
      currency: "EUR",
      rate_unit: "fixed_total",
      sessions: [
        {
          starts_at: new Date(
            Date.now() + (100 + day) * 86400000,
          ).toISOString(),
          ends_at: new Date(
            Date.now() + (100 + day) * 86400000 + 3600000,
          ).toISOString(),
        },
      ],
      topic_ids: [],
      terms: "Immutable personal compensation",
      requires_contract: false,
    });
    const legacy = await rpc(
      admin,
      "create_commission_job",
      [org, JSON.stringify(payload(0)), 50, randomUUID()],
      "aal2",
    );
    const untouched = await rpc(
      admin,
      "create_commission_job",
      [org, JSON.stringify(payload(1)), 50, randomUUID()],
      "aal2",
    );
    const historic = await rpc(teacher, "claim_job", [legacy, randomUUID(), 2]);
    assert.equal(historic.status, "confirmed");
    const beforeClaim = await sql(
      `select row_to_json(c) from public.job_claims c where id='${historic.claim_id}'`,
    );
    const beforeRevenue = await sql(
      `select row_to_json(c) from private.claim_revenue_ledger c where claim_id='${historic.claim_id}'`,
    );
    await sql(
      await readFile(
        new URL(
          "../supabase/migrations/20261116020953_delegated_roles_and_private_role_pricing.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const offers = (who) =>
      rpc(who, "job_offers", [], who === manager ? "aal2" : "aal1");
    const offer = async (who, id) =>
      (await offers(who)).find((row) => row.id === id);
    const create = (day, gross = 100.01, capacity = 1) =>
      rpc(
        admin,
        "create_capacity_job",
        [
          JSON.stringify(payload(day, gross)),
          capacity,
          randomUUID(),
          org,
          null,
        ],
        "aal2",
      );
    const claim = async (who, id, key = randomUUID(), version) =>
      rpc(who, "claim_job", [
        id,
        key,
        version ?? (await offer(who, id)).terms_version,
      ]);
    await check(
      "Upgrade preserves complete historical accepted deal and private revenue bytes",
      async () => {
        assert.equal(
          await sql(
            `select row_to_json(c) from public.job_claims c where id='${historic.claim_id}'`,
          ),
          beforeClaim,
        );
        assert.equal(
          await sql(
            `select row_to_json(c) from private.claim_revenue_ledger c where claim_id='${historic.claim_id}'`,
          ),
          beforeRevenue,
        );
        assert.equal(
          await sql(
            `select pricing_mode from private.job_commission_offers where job_id='${legacy}'`,
          ),
          "legacy",
        );
        assert.equal(
          await sql(
            `select pricing_mode from private.job_commission_offers where job_id='${untouched}'`,
          ),
          "role_split",
        );
        assert.equal(
          await sql(`select amount from public.jobs where id='${untouched}'`),
          "0.00",
        );
      },
    );
    await check(
      "Policy remains empty until administrative setup, never guessing a private production setting",
      async () => {
        assert.equal(
          (await rpc(admin, "commission_access", [], "aal2")).policy_configured,
          false,
        );
        assert.equal((await offer(teacher, untouched)).total_amount, null);
        await assert.rejects(create(9), /has not been configured/);
        for (const who of [manager, teacher, senior, company, guest])
          await assert.rejects(
            rpc(who, "configure_compensation_policy", [31, 73, 0], "aal2"),
            /42501/,
          );
        assert.equal(
          (
            await rpc(
              admin,
              "configure_compensation_policy",
              [31, 73, 0],
              "aal2",
            )
          ).policy_version,
          1,
        );
        await assert.rejects(
          rpc(admin, "configure_compensation_policy", [32, 74, 0], "aal2"),
          /40001/,
        );
      },
    );
    await check(
      "Current catalogue gives admin/management only subordinate assignable roles and guest no permissions",
      async () => {
        const adminRoles = await rpc(admin, "account_role_catalog", [], "aal2"),
          managerRoles = await rpc(manager, "account_role_catalog", [], "aal2");
        assert.deepEqual(
          adminRoles
            .filter((row) => row.assignable)
            .map((row) => row.role)
            .sort(),
          [
            "client",
            "guest",
            "lecturer",
            "management",
            "participant",
            "senior_lecturer",
          ],
        );
        assert.deepEqual(
          managerRoles
            .filter((row) => row.assignable)
            .map((row) => row.role)
            .sort(),
          ["client", "guest", "lecturer", "participant", "senior_lecturer"],
        );
        assert.deepEqual(
          managerRoles.find((row) => row.role === "guest").permissions,
          [],
        );
        assert.equal(
          (await rpc(manager, "account_users", ["", 50, 0], "aal2")).items.find(
            (row) => row.id === owner,
          ).can_assign_roles,
          false,
        );
        await assert.rejects(
          rpc(manager, "account_role_catalog"),
          /MFA required/,
        );
      },
    );
    await check(
      "Management assigns lecturer/senior/guest and never self/equal/higher or combined protected role targets",
      async () => {
        await rpc(manager, "set_account_roles", [guest, "{guest}"], "aal2");
        assert.deepEqual((await rpc(guest, "account_me")).roles, ["guest"]);
        assert.deepEqual(
          JSON.parse(
            await actor(
              guest,
              "select to_json(public.get_my_permissions())",
              "aal2",
            ),
          ),
          [],
        );
        assert.deepEqual(await offers(guest), []);
        for (const target of [owner, admin, manager])
          await assert.rejects(
            rpc(manager, "set_account_roles", [target, "{lecturer}"], "aal2"),
            /42501/,
          );
        for (const roles of [
          "{management}",
          "{admin}",
          "{owner}",
          "{lecturer,admin}",
        ])
          await assert.rejects(
            rpc(manager, "set_account_roles", [guest, roles], "aal2"),
            /42501/,
          );
        await rpc(admin, "set_account_roles", [guest, "{management}"], "aal2");
        await assert.rejects(
          rpc(manager, "set_account_roles", [guest, "{guest}"], "aal2"),
          /42501/,
        );
        await assert.rejects(
          rpc(admin, "set_account_roles", [admin, "{lecturer}"], "aal2"),
          /42501/,
        );
        await rpc(admin, "set_account_roles", [guest, "{guest}"], "aal2");
      },
    );
    await check(
      "Suspension and membership APIs cannot sidestep protected-account role hierarchy",
      async () => {
        for (const target of [owner, admin, manager])
          await assert.rejects(
            rpc(manager, "set_user_active", [target, false], "aal2"),
            /42501/,
          );
        await assert.rejects(
          rpc(admin, "set_user_active", [owner, false], "aal2"),
          /42501/,
        );
        await rpc(manager, "set_user_active", [guest, false], "aal2");
        await assert.rejects(rpc(guest, "account_me"), /Active login/);
        await rpc(manager, "set_user_active", [guest, true], "aal2");
        await assert.rejects(
          rpc(
            manager,
            "manage_client_organisation",
            [admin, org, false],
            "aal2",
          ),
          /42501/,
        );
        await assert.rejects(
          rpc(
            manager,
            "manage_client_organisation",
            [company, org, false],
            "aal2",
          ),
          /42501/,
        );
        await rpc(
          admin,
          "manage_client_organisation",
          [company, org, false],
          "aal2",
        );
      },
    );
    await check(
      "Subordinate invitation rights apply before sending and again at server-only completion",
      async () => {
        for (const role of ["management", "admin", "owner"])
          await assert.rejects(
            rpc(
              manager,
              "reserve_account_invitation",
              [
                `${randomUUID()}@example.invalid`,
                "Fictional",
                role,
                null,
                randomUUID(),
              ],
              "aal2",
            ),
            /42501/,
          );
        await assert.rejects(
          rpc(
            manager,
            "reserve_account_invitation",
            [
              `${randomUUID()}@example.invalid`,
              "Fictional",
              "client",
              org,
              randomUUID(),
            ],
            "aal2",
          ),
          /42501/,
        );
        const noGrant = await rpc(
          manager,
          "reserve_account_invitation",
          [
            `${randomUUID()}@example.invalid`,
            "Fictional",
            "client",
            null,
            randomUUID(),
          ],
          "aal2",
        );
        assert.equal(noGrant.status, "reserved");
        const invitation = await rpc(
          manager,
          "reserve_account_invitation",
          [
            `${randomUUID()}@example.invalid`,
            "Fictional",
            "senior_lecturer",
            null,
            randomUUID(),
          ],
          "aal2",
        );
        await rpc(admin, "set_account_roles", [manager, "{guest}"], "aal2");
        await assert.rejects(
          sql(
            `begin;set local role service_role;select public.complete_account_invitation('${invitation.invitation_id}','${guest}','Fictional',true);commit`,
          ),
          /Inviter authority revoked/,
        );
        await rpc(
          admin,
          "set_account_roles",
          [manager, "{management}"],
          "aal2",
        );
      },
    );
    await check(
      "Combined company/staff accounts cannot combine customer gross and personal net access",
      async () => {
        for (const roles of [
          "{client,lecturer}",
          "{client,senior_lecturer}",
          "{client,management}",
        ])
          await assert.rejects(
            rpc(admin, "set_account_roles", [guest, roles], "aal2"),
            /separate accounts/,
          );
        await sql(
          `insert into public.user_roles(user_id,role) values('${company}','lecturer')`,
        );
        assert.deepEqual(await rpc(company, "client_organisations"), []);
        assert.deepEqual(await rpc(company, "client_requests"), []);
        await sql(
          `delete from public.user_roles where user_id='${company}' and role='lecturer'`,
        );
        await rpc(manager, "set_account_roles", [company, "{guest}"], "aal2");
        await rpc(manager, "set_account_roles", [company, "{client}"], "aal2");
        assert.deepEqual(await rpc(company, "client_organisations"), []);
        await assert.rejects(
          rpc(
            manager,
            "manage_client_organisation",
            [company, org, false],
            "aal2",
          ),
          /42501/,
        );
        await rpc(
          admin,
          "manage_client_organisation",
          [company, org, false],
          "aal2",
        );
      },
    );
    await check(
      "Only administrative MFA responses contain policy, gross or platform amounts",
      async () => {
        for (const who of [manager, teacher, senior, company, guest]) {
          const access = await rpc(who, "commission_access", [], "aal2");
          assert.equal("regular_lecturer_percent" in access, false);
          assert.equal("senior_lecturer_percent" in access, false);
          await assert.rejects(
            actor(who, "select * from private.job_commission_offers"),
            /permission denied/,
          );
          await assert.rejects(
            actor(who, "select private.role_net(100,auth.uid(),null)"),
            /permission denied/,
          );
          await assert.rejects(
            actor(who, "select * from public.commission_report()", "aal2"),
            /Gross finance permission/,
          );
          await assert.rejects(
            rpc(who, "commission_offer_policy", [untouched], "aal2"),
            /Gross finance permission/,
          );
        }
        const access = await rpc(admin, "commission_access", [], "aal2");
        assert.equal(access.regular_lecturer_percent, 31);
        assert.equal(access.senior_lecturer_percent, 73);
        assert.equal(
          "regular_lecturer_percent" in (await rpc(admin, "commission_access")),
          false,
        );
      },
    );
    await check(
      "Maximum lecturer budget uses the captured senior price per position and keeps confidential totals administrative",
      async () => {
        const budgetJob = await create(10, 100.01, 3);
        const adminState = await rpc(
          admin,
          "job_lifecycle",
          [budgetJob],
          "aal2",
        );
        const ownerState = await rpc(
          owner,
          "job_lifecycle",
          [budgetJob],
          "aal2",
        );
        assert.equal(adminState.max_net_budget, 219.03);
        assert.equal(ownerState.max_net_budget, 219.03);
        assert.equal(
          Number((await offer(admin, budgetJob)).total_amount) * 3,
          93,
        );
        for (const who of [manager, teacher, senior])
          assert.equal(
            (
              await rpc(
                who,
                "job_lifecycle",
                [budgetJob],
                who === manager ? "aal2" : "aal1",
              )
            ).max_net_budget,
            null,
          );
        assert.equal(
          (await rpc(admin, "job_lifecycle", [budgetJob])).max_net_budget,
          null,
        );
        const receipt = await claim(teacher, budgetJob);
        assert.equal(receipt.status, "confirmed");
        const accepted = await sql(
          `select row_to_json(c) from public.job_claims c where id='${receipt.claim_id}'`,
        );
        const revenue = await sql(
          `select row_to_json(r) from private.claim_revenue_ledger r where claim_id='${receipt.claim_id}'`,
        );
        assert.equal(
          (await rpc(admin, "job_lifecycle", [budgetJob], "aal2"))
            .max_net_budget,
          219.03,
        );
        assert.equal(
          await sql(
            `select row_to_json(c) from public.job_claims c where id='${receipt.claim_id}'`,
          ),
          accepted,
        );
        assert.equal(
          await sql(
            `select row_to_json(r) from private.claim_revenue_ledger r where claim_id='${receipt.claim_id}'`,
          ),
          revenue,
        );
        assert.equal(
          (await rpc(admin, "job_lifecycle", [legacy], "aal2")).max_net_budget,
          50,
        );
        assert.equal(
          (await rpc(manager, "job_lifecycle", [legacy], "aal2"))
            .max_net_budget,
          50,
        );
        assert.equal(
          await sql(
            `select row_to_json(c) from public.job_claims c where id='${historic.claim_id}'`,
          ),
          beforeClaim,
        );
        assert.equal(
          await sql(
            `select row_to_json(r) from private.claim_revenue_ledger r where claim_id='${historic.claim_id}'`,
          ),
          beforeRevenue,
        );
      },
    );
    let id;
    await check(
      "Raw REST table has no pay quote; own role-specific RPC quote has exact net with no gross or percentage keys",
      async () => {
        id = await create(2, 100.01, 2);
        for (const who of [teacher, senior, manager]) {
          const raw = JSON.parse(
            await actor(
              who,
              `select row_to_json(j) from public.jobs j where id='${id}'`,
              who === manager ? "aal2" : "aal1",
            ),
          );
          assert.equal(Number(raw.amount), 0);
          assert.equal(Number(raw.total_amount), 0);
        }
        const regular = await offer(teacher, id),
          higher = await offer(senior, id),
          managed = await offer(manager, id);
        assert.equal(Number(regular.total_amount), 31);
        assert.equal(Number(higher.total_amount), 73.01);
        assert.equal(managed.total_amount, null);
        for (const row of [regular, higher, managed])
          assert.equal(
            Object.keys(row).some((key) =>
              /gross|platform|percent|pricing_mode/.test(key),
            ),
            false,
          );
        assert.notEqual(regular.terms_version, higher.terms_version);
      },
    );
    await check(
      "Tampered quote, opposite-role quote and pre-promotion quote cannot accept a different deal",
      async () => {
        const quote = await offer(teacher, id),
          seniorQuote = await offer(senior, id);
        assert.equal(
          (await claim(teacher, id, randomUUID(), seniorQuote.terms_version))
            .status,
          "terms_changed",
        );
        assert.equal(
          (await claim(teacher, id, randomUUID(), quote.terms_version + 10))
            .status,
          "terms_changed",
        );
        await rpc(
          manager,
          "set_account_roles",
          [teacher, "{senior_lecturer}"],
          "aal2",
        );
        assert.equal(
          (await claim(teacher, id, randomUUID(), quote.terms_version)).status,
          "terms_changed",
        );
        assert.equal(Number((await offer(teacher, id)).total_amount), 73.01);
        await rpc(
          manager,
          "set_account_roles",
          [teacher, "{lecturer}"],
          "aal2",
        );
      },
    );
    let firstClaim, key;
    await check(
      "Different roles claim one capacity offer at separate exact pay with conserved private revenue",
      async () => {
        key = randomUUID();
        const first = await claim(teacher, id, key);
        assert.equal(first.status, "confirmed");
        firstClaim = first.claim_id;
        assert.equal((await claim(senior, id)).status, "confirmed");
        const net = JSON.parse(
          await sql(
            `select json_agg(total_amount order by total_amount) from public.job_claims where job_id='${id}'`,
          ),
        );
        assert.deepEqual(net, [31, 73.01]);
        assert.equal(
          await sql(
            `select count(*) from private.claim_revenue_ledger where job_id='${id}' and gross_total_amount=platform_total_amount+lecturer_net_total_amount`,
          ),
          "2",
        );
        assert.equal(
          await sql(
            `select count(*) from public.assignment_sessions where claim_id in(select id from public.job_claims where job_id='${id}')`,
          ),
          "2",
        );
      },
    );
    await check(
      "Later senior promotion cannot reprice accepted claims and idempotent old quote retry keeps original receipt",
      async () => {
        const before = await sql(
          `select row_to_json(c) from public.job_claims c where id='${firstClaim}'`,
        );
        await rpc(
          manager,
          "set_account_roles",
          [teacher, "{senior_lecturer}"],
          "aal2",
        );
        const retry = await claim(teacher, id, key, 21);
        assert.equal(retry.status, "confirmed");
        assert.equal(retry.claim_id, firstClaim);
        assert.equal(
          await sql(
            `select row_to_json(c) from public.job_claims c where id='${firstClaim}'`,
          ),
          before,
        );
        await assert.rejects(
          sql(
            `update private.claim_revenue_ledger set lecturer_net_total_amount=999 where claim_id='${firstClaim}'`,
          ),
          /immutable/,
        );
        await assert.rejects(
          rpc(admin, "set_job_commission", [id, 200, 200, null], "aal2"),
          /Only unaccepted/,
        );
      },
    );
    await check(
      "Rounding uses exact cents and platform receives only residual; fixed policy rejects arbitrary parameters",
      async () => {
        const tiny = await create(3, 0.05, 2);
        assert.equal(Number((await offer(senior, tiny)).total_amount), 0.04);
        await rpc(
          manager,
          "set_account_roles",
          [teacher, "{lecturer}"],
          "aal2",
        );
        assert.equal(Number((await offer(teacher, tiny)).total_amount), 0.02);
        assert.equal((await claim(teacher, tiny)).status, "confirmed");
        assert.equal((await claim(senior, tiny)).status, "confirmed");
        assert.equal(
          await sql(
            `select count(*) from private.claim_revenue_ledger where job_id='${tiny}' and gross_total_amount=platform_total_amount+lecturer_net_total_amount`,
          ),
          "2",
        );
        await assert.rejects(
          rpc(
            admin,
            "create_commission_job",
            [org, JSON.stringify(payload(4)), 50, randomUUID()],
            "aal2",
          ),
          /configured separately/,
        );
      },
    );
    await check(
      "Policy changes affect future offers while quoted and accepted offer snapshots remain stable",
      async () => {
        const pending = await create(5, 100),
          before = await offer(teacher, pending);
        const updated = await rpc(
          admin,
          "configure_compensation_policy",
          [32, 74, 1],
          "aal2",
        );
        assert.equal(updated.policy_version, 2);
        assert.deepEqual(await offer(teacher, pending), before);
        assert.equal(
          (await rpc(admin, "job_lifecycle", [pending], "aal2")).max_net_budget,
          73,
        );
        const captured = await rpc(
          admin,
          "commission_offer_policy",
          [pending],
          "aal2",
        );
        assert.equal(captured.regular_lecturer_percent, 31);
        assert.equal(captured.senior_lecturer_percent, 73);
        assert.equal(captured.policy_version, 1);
        const future = await create(6, 100);
        assert.equal(Number((await offer(teacher, future)).total_amount), 32);
        assert.equal(
          (await claim(teacher, pending, randomUUID(), before.terms_version))
            .status,
          "confirmed",
        );
        await assert.rejects(
          rpc(admin, "configure_compensation_policy", [99, 10, 2], "aal2"),
          /Invalid compensation/,
        );
        const audit = await actor(
          manager,
          "select coalesce(json_agg(a),'[]') from public.audit_events a",
          "aal2",
        );
        assert.equal(
          /regular_percent|senior_percent|lecturer_percent/.test(audit),
          false,
        );
      },
    );
    await check(
      "Duplicated commissioned offers capture the current private policy and remain claimable without changing accepted source history",
      async () => {
        const sourceClaims = await sql(
          `select jsonb_agg(to_jsonb(c) order by c.id) from public.job_claims c where job_id='${id}'`,
        );
        const sourceRevenue = await sql(
          `select jsonb_agg(to_jsonb(r) order by r.claim_id) from private.claim_revenue_ledger r where job_id='${id}'`,
        );
        const sourcePolicy = await rpc(
          admin,
          "commission_offer_policy",
          [id],
          "aal2",
        );
        assert.equal(sourcePolicy.policy_version, 1);
        const sourceState = await rpc(admin, "job_lifecycle", [id], "aal2");
        const request = randomUUID();
        const parameters = [
          id,
          "duplicate",
          sourceState.version,
          request,
          JSON.stringify({ title: "Fictional policy-versioned duplicate" }),
        ];
        const duplicate = await rpc(
          admin,
          "manage_job_offer",
          parameters,
          "aal2",
        );
        assert.equal(
          await rpc(admin, "manage_job_offer", parameters, "aal2"),
          duplicate,
        );
        assert.notEqual(duplicate, id);
        const captured = await rpc(
          admin,
          "commission_offer_policy",
          [duplicate],
          "aal2",
        );
        assert.deepEqual(captured, {
          regular_lecturer_percent: 32,
          senior_lecturer_percent: 74,
          policy_version: 2,
        });
        assert.equal(
          await sql(
            `select amount||','||total_amount from public.jobs where id='${duplicate}'`,
          ),
          "0.00,0.00",
        );
        const draft = await rpc(admin, "job_lifecycle", [duplicate], "aal2");
        await rpc(
          admin,
          "manage_job_offer",
          [duplicate, "published", draft.version, randomUUID(), "{}"],
          "aal2",
        );
        await rpc(manager, "set_account_roles", [guest, "{lecturer}"], "aal2");
        const quote = await offer(guest, duplicate);
        assert.equal(Number(quote.amount), 32);
        assert.equal(Number(quote.total_amount), 32);
        assert.equal(
          Number((await offer(senior, duplicate)).total_amount),
          74.01,
        );
        const receipt = await claim(
          guest,
          duplicate,
          randomUUID(),
          quote.terms_version,
        );
        assert.equal(receipt.status, "confirmed");
        assert.equal(
          await sql(
            `select total_amount from public.job_claims where id='${receipt.claim_id}'`,
          ),
          "32.00",
        );
        assert.equal(
          await sql(
            `select jsonb_agg(to_jsonb(c) order by c.id) from public.job_claims c where job_id='${id}'`,
          ),
          sourceClaims,
        );
        assert.equal(
          await sql(
            `select jsonb_agg(to_jsonb(r) order by r.claim_id) from private.claim_revenue_ledger r where job_id='${id}'`,
          ),
          sourceRevenue,
        );
        assert.deepEqual(
          await rpc(admin, "commission_offer_policy", [id], "aal2"),
          sourcePolicy,
        );
        await rpc(manager, "set_account_roles", [guest, "{guest}"], "aal2");
      },
    );
    await check(
      "Own company request/spend projections expose gross only, no net or split",
      async () => {
        const requests = JSON.parse(
          await actor(
            company,
            "select coalesce(json_agg(r),'[]') from public.client_requests() r",
          ),
        );
        assert.ok(requests.length > 0);
        assert.equal(
          /lecturer_net|platform_percent|regular_lecturer_percent|senior_lecturer_percent/.test(
            JSON.stringify(requests),
          ),
          false,
        );
        assert.deepEqual(await offers(company), []);
        for (const who of [company, guest])
          for (const version of [1, 21, 999])
            assert.equal(
              (await rpc(who, "claim_job", [id, randomUUID(), version])).status,
              "not_eligible",
            );
      },
    );
    await check(
      "Anonymous/private helper execution and forged metadata cannot supply roles or pay",
      async () => {
        await assert.rejects(
          sql("set role anon;select public.job_offers()"),
          /permission denied/,
        );
        await assert.rejects(
          actor(guest, "select private.claim_job_base(null,null,null)"),
          /permission denied/,
        );
        const answer = await actor(
          guest,
          `set local request.jwt.claims=${q(JSON.stringify({ sub: guest, aal: "aal2", role: "authenticated", user_metadata: { roles: ["admin", "senior_lecturer"] } }))};select public.commission_access()`,
        );
        assert.equal(JSON.parse(answer).can_manage_gross, false);
      },
    );
  },
  { migrationsThrough: "20261115213550" },
);
console.log(
  `\n${checks} delegated-role/private-pricing PostgreSQL checks passed.`,
);
