/** Cross-branch PostgreSQL compatibility proof. Run against the actual pending
 * private role-pricing migrations plus the NEW operational migrations, never by
 * rewriting either history. Every account, price and policy below is fictional;
 * a random owned UUID database is removed by the standard fixture afterwards.
 * SQL authorization assertions exercise the current permission gate, not native Auth/TOTP.
 * This remains a manual test until the real pricing prerequisite is accepted on
 * main; it intentionally has no auto-discovered -db-tests suffix.
 * Run: PORTAL_DB_CONTAINER=<owned-test-container> node scripts/replacement-role-pricing-compat.mjs */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

assert.match(
  process.env.PORTAL_DB_CONTAINER ?? "",
  /^supabase_db_luminovia-portal-test-[a-zA-Z0-9_-]+$/,
  "An explicitly owned disposable PostgreSQL fixture is required; no default development database is permitted.",
);
let checks = 0;
await withTestDatabase("replacement_role_compat", async ({ sql, actor }) => {
  for (const name of [
    "public.configure_compensation_policy(numeric,numeric,integer)",
    "public.job_offers()",
    "public.replacement_marketplace()",
    "private.role_net(numeric,uuid,uuid)",
    "private.role_quote_version(integer,uuid)",
  ])
    assert.equal(
      await sql(`select to_regprocedure(${q(name)}) is not null`),
      "t",
      `Prerequisite missing: the real pending role-pricing and operational APIs must be installed before this manual compatibility test can run; unavailable API: ${name}`,
    );
  const admin = randomUUID(),
    original = randomUUID(),
    regular = randomUUID(),
    senior = randomUUID(),
    promoted = randomUUID(),
    manager = randomUUID(),
    organisation = randomUUID();
  const users = [admin, original, regular, senior, promoted, manager];
  await sql(
    `insert into auth.users(id,email) values${users.map((id) => `(${q(id)},${q(`fictional-compat-${id}@example.invalid`)})`).join(",")};
     insert into public.user_roles(user_id,role) values(${q(admin)},'admin'),(${q(original)},'lecturer'),(${q(regular)},'lecturer'),(${q(senior)},'senior_lecturer'),(${q(promoted)},'lecturer'),(${q(manager)},'management');
     insert into public.organisations(id,name) values(${q(organisation)},'Fictional role-pricing compatibility organisation');`,
  );
  /** Current actor and assurance are supplied only to the SQL fixture. No
   * service credential, editable role metadata or browser actor ID authorises a call. */
  const rpc = async (who, name, args = [], aal = "aal1") => {
    const value = await actor(
      who,
      `select public.${name}(${args.join(",")})`,
      aal,
    );
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  const check = async (name, run) => {
    await run();
    checks++;
    console.log(`PASS ${name}`);
  };
  // Deliberately fictional values differ from all application defaults and from
  // each other; integer basis points prevent the fixture from guessing rounding.
  const regularBasisPoints = 2917n,
    seniorBasisPoints = 7643n,
    grossAmountCents = 123457n,
    grossTotalCents = 246913n;
  const amount = (cents) =>
    `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
  const net = (gross, basisPoints) => (gross * basisPoints + 5000n) / 10000n;
  const regularAmount = amount(net(grossAmountCents, regularBasisPoints)),
    regularTotal = amount(net(grossTotalCents, regularBasisPoints)),
    seniorAmount = amount(net(grossAmountCents, seniorBasisPoints)),
    seniorTotal = amount(net(grossTotalCents, seniorBasisPoints));
  let job, originalClaim, replacement, originalLedger, originalAccepted;
  /** Candidate projections must contain only their own quote, not private
   * captured policy, customer gross figures or another lecturer's quote. */
  const noPricingLeak = (value) => {
    const walk = (item) => {
      if (Array.isArray(item)) return item.forEach(walk);
      if (!item || typeof item !== "object") return;
      for (const [key, field] of Object.entries(item)) {
        assert.equal(
          /gross|platform|percent|policy|pricing_mode/i.test(key),
          false,
          key,
        );
        walk(field);
      }
    };
    walk(value);
  };
  const marketplace = (who, aal = "aal1") =>
    rpc(who, "replacement_marketplace", [], aal);
  const offered = async (who, aal = "aal1") =>
    (await marketplace(who, aal)).find((row) => row.id === replacement);
  const replacementClaim = (who, quote, key = randomUUID()) =>
    rpc(who, "claim_replacement", [
      q(replacement),
      "1",
      String(quote.terms_version),
      q(key),
    ]);

  await check(
    "Fictional policy setup requires current permission and preserves an empty-policy start",
    async () => {
      assert.equal(
        await sql("select count(*) from private.compensation_policy"),
        "0",
      );
      await assert.rejects(
        rpc(admin, "configure_compensation_policy", ["29.17", "76.43", "0"]),
        /42501/,
      );
      const configured = await rpc(
        admin,
        "configure_compensation_policy",
        ["29.17", "76.43", "0"],
        "aal1",
      );
      assert.equal(configured.policy_version, 1);
    },
  );

  await check(
    "A real commissioned offer is accepted through its own role token and creates the original immutable revenue",
    async () => {
      const payload = {
        title: "Fictional role-priced replacement compatibility block",
        delivery_type: "online",
        location: "https://meeting.example.invalid/compatibility",
        time_zone: "Europe/Berlin",
        status: "published",
        gross_amount: Number(amount(grossAmountCents)),
        gross_total_amount: Number(amount(grossTotalCents)),
        currency: "AUD",
        rate_unit: "per_day",
        sessions: [
          {
            starts_at: "2071-01-01T08:00:00Z",
            ends_at: "2071-01-01T09:00:00Z",
          },
          {
            starts_at: "2071-01-02T08:00:00Z",
            ends_at: "2071-01-02T09:00:00Z",
          },
        ],
        terms: "Fictional immutable role-priced replacement terms",
        requires_contract: false,
        topic_ids: [],
      };
      job = await rpc(
        admin,
        "create_capacity_job",
        [
          q(JSON.stringify(payload)) + "::jsonb",
          "1",
          q(randomUUID()),
          q(organisation),
          "null",
        ],
        "aal1",
      );
      const quote = (await rpc(original, "job_offers")).find(
        (row) => row.id === job,
      );
      assert.equal(Number(quote.amount), Number(regularAmount));
      assert.equal(Number(quote.total_amount), Number(regularTotal));
      const raw = JSON.parse(
        await sql(
          `select jsonb_build_object('amount',amount,'total_amount',total_amount) from public.jobs where id=${q(job)}`,
        ),
      );
      assert.equal(Number(raw.amount), 0);
      assert.equal(Number(raw.total_amount), 0);
      const accepted = await rpc(original, "claim_job", [
        q(job),
        q(randomUUID()),
        String(quote.terms_version),
      ]);
      assert.equal(accepted.status, "confirmed");
      originalClaim = accepted.claim_id;
      originalAccepted = await sql(
        `select to_jsonb(c) from public.job_claims c where id=${q(originalClaim)}`,
      );
      originalLedger = await sql(
        `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id=${q(originalClaim)}`,
      );
      assert.equal(
        await sql(
          `select total_amount::text from public.job_claims where id=${q(originalClaim)}`,
        ),
        regularTotal,
      );
      replacement = await rpc(original, "request_replacement", [
        q(originalClaim),
        q("Fictional authorised replacement needed"),
        q("open"),
        "'{}'::uuid[]",
        "false",
        q(randomUUID()),
      ]);
    },
  );

  await check(
    "Replacement discovery exposes each candidate's own captured role quote and token only",
    async () => {
      const regularOffer = await offered(regular),
        seniorOffer = await offered(senior),
        managementOffer = await offered(manager, "aal1");
      assert.ok(regularOffer?.can_claim);
      assert.ok(seniorOffer?.can_claim);
      for (const offer of [regularOffer, seniorOffer, managementOffer])
        noPricingLeak(offer);
      assert.equal(Number(regularOffer.quote.amount), Number(regularAmount));
      assert.equal(
        Number(regularOffer.quote.total_amount),
        Number(regularTotal),
      );
      assert.equal(Number(seniorOffer.quote.amount), Number(seniorAmount));
      assert.equal(Number(seniorOffer.quote.total_amount), Number(seniorTotal));
      assert.equal(managementOffer.quote, null);
      assert.equal(managementOffer.can_claim, false);
      assert.notEqual(
        regularOffer.quote.terms_version,
        seniorOffer.quote.terms_version,
      );
      assert.equal(regularOffer.quote.terms_version % 10, 1);
      assert.equal(seniorOffer.quote.terms_version % 10, 2);
      assert.equal(JSON.stringify(regularOffer).includes(seniorTotal), false);
      assert.equal(JSON.stringify(seniorOffer).includes(regularTotal), false);
    },
  );

  await check(
    "Role promotion invalidates the reviewed replacement consent without releasing the original",
    async () => {
      const before = await offered(promoted);
      await rpc(
        admin,
        "set_account_roles",
        [q(promoted), "'{senior_lecturer}'::text[]"],
        "aal1",
      );
      const current = await offered(promoted);
      assert.notEqual(before.quote.terms_version, current.quote.terms_version);
      assert.equal(Number(current.quote.total_amount), Number(seniorTotal));
      const denied = await replacementClaim(promoted, before.quote);
      assert.equal(denied.status, "terms_changed");
      assert.equal(
        await sql(
          `select to_jsonb(c) from public.job_claims c where id=${q(originalClaim)}`,
        ),
        originalAccepted,
      );
      assert.equal(
        await sql(
          `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id=${q(originalClaim)}`,
        ),
        originalLedger,
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id=${q(originalClaim)} and released_at is null`,
        ),
        "2",
      );
    },
  );

  await check(
    "Later global policy changes do not silently reprice the captured existing replacement",
    async () => {
      await rpc(
        admin,
        "configure_compensation_policy",
        ["37.19", "81.23", "1"],
        "aal1",
      );
      assert.equal(
        Number((await offered(regular)).quote.total_amount),
        Number(regularTotal),
      );
      assert.equal(
        Number((await offered(senior)).quote.total_amount),
        Number(seniorTotal),
      );
      assert.equal(
        await sql(
          `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id=${q(originalClaim)}`,
        ),
        originalLedger,
      );
    },
  );

  await check(
    "Senior handover commits the correct new immutable net/gross ledger and preserves original commercial history",
    async () => {
      const quote = (await offered(senior)).quote,
        key = randomUUID();
      const accepted = await replacementClaim(senior, quote, key);
      assert.equal(accepted.status, "confirmed");
      assert.notEqual(accepted.claim_id, originalClaim);
      assert.deepEqual(await replacementClaim(senior, quote, key), accepted);
      const newClaim = JSON.parse(
        await sql(
          `select to_jsonb(c) from public.job_claims c where id=${q(accepted.claim_id)}`,
        ),
      );
      const newLedger = JSON.parse(
        await sql(
          `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id=${q(accepted.claim_id)}`,
        ),
      );
      assert.equal(Number(newClaim.amount), Number(seniorAmount));
      assert.equal(Number(newClaim.total_amount), Number(seniorTotal));
      assert.equal(newClaim.currency, "AUD");
      assert.equal(
        Number(newLedger.gross_amount),
        Number(amount(grossAmountCents)),
      );
      assert.equal(
        Number(newLedger.gross_total_amount),
        Number(amount(grossTotalCents)),
      );
      assert.equal(Number(newLedger.lecturer_net_amount), Number(seniorAmount));
      assert.equal(
        Number(newLedger.lecturer_net_total_amount),
        Number(seniorTotal),
      );
      assert.equal(
        Number(newLedger.platform_total_amount),
        Number(
          amount(grossTotalCents - net(grossTotalCents, seniorBasisPoints)),
        ),
      );
      assert.equal(Number(newLedger.platform_percent), 23.57);
      assert.equal(
        await sql(
          `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id=${q(originalClaim)}`,
        ),
        originalLedger,
      );
      assert.deepEqual(
        JSON.parse(
          await sql(
            `select to_jsonb(c) from public.job_claims c where id=${q(originalClaim)}`,
          ),
        ),
        { ...JSON.parse(originalAccepted), status: "cancelled" },
      );
      assert.equal(
        await sql(
          `select count(*) from public.job_claims where job_id=${q(job)} and status='confirmed'`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id=${q(accepted.claim_id)} and released_at is null`,
        ),
        "2",
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id=${q(originalClaim)} and released_at is not null`,
        ),
        "2",
      );
      assert.equal(
        await sql(
          `select count(*) from private.claim_revenue_ledger where job_id=${q(job)}`,
        ),
        "2",
      );
      const currentClaim = await sql(
        `select to_jsonb(c) from public.job_claims c where id=${q(accepted.claim_id)}`,
      );
      const currentLedger = await sql(
        `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id=${q(accepted.claim_id)}`,
      );
      await rpc(
        admin,
        "set_account_roles",
        [q(senior), "'{lecturer}'::text[]"],
        "aal1",
      );
      assert.equal(
        await sql(
          `select to_jsonb(c) from public.job_claims c where id=${q(accepted.claim_id)}`,
        ),
        currentClaim,
      );
      assert.equal(
        await sql(
          `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id=${q(accepted.claim_id)}`,
        ),
        currentLedger,
      );
      for (const who of [regular, senior, promoted, manager]) {
        await assert.rejects(
          actor(who, "select * from private.compensation_policy", "aal1"),
          /42501/,
        );
        await assert.rejects(
          actor(who, "select * from private.claim_revenue_ledger", "aal1"),
          /42501/,
        );
      }
    },
  );
  console.log(
    `\n${checks} actual role-pricing replacement compatibility groups passed.`,
  );
});
