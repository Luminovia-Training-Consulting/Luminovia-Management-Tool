/** Actual Auth/REST proof: the unchanged 1000-row API limit is not a catalogue. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";
await withApiFixture(
  async ({ actor, service, passwordOnly, checked, sql, defer, suffix }) => {
    const admin = await actor("discovery-admin", "admin"),
      teacher = await actor("discovery-teacher", "lecturer"),
      peer = await actor("discovery-peer", "lecturer"),
      learner = await actor("discovery-learner", "participant");
    const customer = `Fictional discovery ${suffix}`,
      ids = Array.from({ length: 1057 }, randomUUID).sort(),
      created = "2040-01-01T00:00:00Z",
      view = randomUUID();
    defer(async () => {
      await sql(
        `delete from private.saved_job_views where user_id in('${teacher.id}','${peer.id}');delete from public.notifications where user_id in('${admin.id}','${teacher.id}','${peer.id}','${learner.id}');delete from public.job_sessions where job_id in(select id from public.jobs where customer_name=${q(customer)}and created_by='${admin.id}');delete from public.jobs where customer_name=${q(customer)}and created_by='${admin.id}';`,
      );
    });
    for (let offset = 0; offset < ids.length; offset += 100) {
      const part = ids.slice(offset, offset + 100);
      await checked(
        service.from("jobs").insert(
          part.map((id) => ({
            id,
            title: `Fictional literal %_ ${id}`,
            customer_name: customer,
            description: "Fictional authoritative discovery",
            delivery_type: "online",
            time_zone: "Europe/Berlin",
            status: "published",
            amount: 25,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "per_hour",
            terms: "Fictional immutable original terms",
            requires_contract: false,
            created_at: created,
            created_by: admin.id,
          })),
        ),
        "Seed owned large fictional catalogue",
      );
      await checked(
        service.from("job_sessions").insert(
          part.map((job_id) => ({
            job_id,
            starts_at: "2060-04-01T08:00:00Z",
            ends_at: "2060-04-01T10:00:00Z",
          })),
        ),
        "Seed own exact sessions",
      );
    }
    const old = await checked(
      teacher.client
        .from("jobs")
        .select("id")
        .eq("customer_name", customer)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      "Reproduce old unpaged request",
    );
    assert.equal(
      old.length,
      1000,
      "The unchanged native Data API limit truncates the old request",
    );
    assert.ok(
      !old.some((row) => row.id === ids[0]),
      "The old catalogue omits a legitimate authorized deep link",
    );
    const filters = { customer, sort: "newest" },
      found = [];
    let cursor = null;
    do {
      const page = await checked(
        teacher.client.rpc("job_discovery", {
          p_filters: filters,
          p_cursor: cursor,
          p_limit: 100,
        }),
        "Read real bounded page",
      );
      assert.ok(page.items.length <= 100);
      assert.ok(
        page.items.every(
          (item) => !("gross_amount" in item) && !("platform_percent" in item),
        ),
      );
      found.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
      assert.equal(page.has_more, Boolean(cursor));
    } while (cursor);
    assert.deepEqual(found, [...ids].reverse());
    assert.equal(new Set(found).size, 1057);
    const detail = await checked(
      teacher.client.rpc("job_detail", { p_job_id: ids[0] }),
      "Read exact old page-omitted job",
    );
    assert.equal(detail.id, ids[0]);
    assert.equal(detail.job_sessions.length, 1);
    assert.ok(
      (
        await checked(
          teacher.client.rpc("job_dashboard"),
          "Read complete authorized scalar counts",
        )
      ).open_count >= 1057,
    );
    const combined = await checked(
      teacher.client.rpc("job_discovery", {
        p_filters: {
          customer,
          q: "%_",
          currency: "EUR",
          unit: "per_hour",
          min_rate: 25,
          max_rate: 25,
          min_total: 100,
          max_total: 100,
          min_hours: 2,
          max_hours: 2,
          from: "2060-04-01",
          to: "2060-04-01",
          zone: "Europe/Berlin",
          sort: "rate_asc",
        },
        p_limit: 3,
      }),
      "Combined literal original-currency filters",
    );
    assert.equal(combined.items.length, 3);
    assert.equal(
      (
        await checked(
          teacher.client.rpc("job_discovery", {
            p_filters: { customer, q: "%X_" },
          }),
          "No wildcard interpretation",
        )
      ).items.length,
      0,
    );
    assert.equal(
      (
        await teacher.client.rpc("job_discovery", {
          p_filters: { min_total: 1 },
        })
      ).error?.code,
      "22023",
    );
    const own = await checked(
      teacher.client.rpc("save_job_view", {
        p_id: view,
        p_name: "Fictional persisted job view",
        p_filters: filters,
        p_expected_version: 0,
      }),
      "Save own private view",
    );
    assert.equal(own.version, 1);
    assert.equal(
      (
        await checked(
          teacher.client.rpc("save_job_view", {
            p_id: view,
            p_name: own.name,
            p_filters: filters,
            p_expected_version: 0,
          }),
          "Retry create safely",
        )
      ).id,
      view,
    );
    assert.deepEqual(
      await checked(peer.client.rpc("saved_job_views"), "No peer views"),
      [],
    );
    assert.equal(
      (
        await peer.client.rpc("save_job_view", {
          p_id: view,
          p_name: "Foreign forged",
          p_filters: {},
          p_expected_version: 1,
        })
      ).error?.code,
      "42501",
    );
    const concurrent = await Promise.all(
      ["A", "B"].map((name) =>
        teacher.client.rpc("save_job_view", {
          p_id: view,
          p_name: `Fictional rename ${name}`,
          p_filters: filters,
          p_expected_version: 1,
        }),
      ),
    );
    assert.equal(concurrent.filter((r) => !r.error).length, 1);
    assert.equal(concurrent.find((r) => r.error).error.code, "40001");
    await teacher.client.auth.signOut();
    await checked(
      teacher.client.auth.signInWithPassword({
        email: teacher.email,
        password: process.env.E2E_PASSWORD,
      }),
      "New authenticated session",
    );
    const persisted = await checked(
      teacher.client.rpc("saved_job_views"),
      "Read durable saved view after new session",
    );
    assert.equal(persisted[0].version, 2);
    assert.equal(persisted[0].filters.customer, customer);
    await checked(
      teacher.client.rpc("remove_job_view", {
        p_id: view,
        p_expected_version: 2,
      }),
      "Delete own observed version",
    );
    assert.deepEqual(
      await checked(teacher.client.rpc("saved_job_views"), "Own removed view"),
      [],
    );
    assert.equal(
      (await learner.client.rpc("job_discovery")).error?.code,
      "42501",
    );
    assert.equal(
      (await learner.client.rpc("saved_job_views")).error?.code,
      "42501",
    );
    await passwordOnly(admin.client);
    await checked(
      service.from("user_roles").delete().eq("user_id", teacher.id),
      "Revoke own fixture lecturer role",
    );
    assert.equal(
      (await teacher.client.rpc("job_discovery")).error?.code,
      "42501",
    );
    assert.equal(
      (await teacher.client.rpc("saved_job_views")).error?.code,
      "42501",
    );
    console.log(
      "PASS Actual REST1000-row truncation reproduced;1057 authorized offers fully/keyset paged, exact missing-job deep link, aggregate counts, literal combined original-currency/unit/date/duration filters, private persisted views, CAS/new-session retention and current-role revocation.",
    );
  },
);
