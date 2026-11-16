/** Actual Supabase safeupdate library regression for service-only Push setup.
 * Every test backend loads the real installed hook and keeps it enabled. Owned
 * UUID databases, fictional subscriptions and public throwaway keys are cleaned
 * by the shared fixture; no provider or ordinary application data is contacted.
 */
import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

const execute = promisify(execFile);
/** A valid public P-256 key without retained or operational VAPID material. */
const key = () => {
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  return curve.getPublicKey().toString("base64url");
};
await withTestDatabase(
  "push_safeupdate",
  async ({ sql, actor, container, database }) => {
    if (process.env.PORTAL_PUSH_SAFEUPDATE_VULNERABLE_CONTROL === "1") {
      const source = await readFile(
        new URL(
          "../supabase/migrations/20261116091013_web_push_notifications.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const routine = source.match(
        /create function private\.configure_web_push\(.*?end;\$\$;/s,
      );
      assert.ok(
        routine,
        "The actual original configure routine must remain available",
      );
      await sql(
        routine[0].replace("create function", "create or replace function"),
      );
    }
    // These pinned Supabase images install extensions in the Nix store.
    // Discover the actual module rather than assuming the CLI/native image
    // share a safeupdate version, loader alias or store hash.
    const discovered = await execute("docker", [
      "exec",
      container,
      "find",
      "/nix/store",
      "-maxdepth",
      "3",
      "-name",
      "safeupdate*.so",
      "-type",
      "f",
    ]);
    const libraries = discovered.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
    for (const candidate of libraries)
      assert.match(
        candidate,
        /^\/nix\/store\/[A-Za-z0-9_.-]+\/lib\/safeupdate(?:-[0-9.]+)?\.so$/,
      );
    const safeupdate = libraries[0];
    assert.ok(
      safeupdate,
      "The actual installed safeupdate hook must exist; it may not be skipped",
    );
    /** Supabase's operator loads its actual hook before assuming the same service
     * role as PostgREST. The service identity still faces its original RPC ACLs. */
    const guarded = async (statement, role = "service_role") => {
      try {
        const result = await execute("docker", [
          "exec",
          container,
          "psql",
          "-U",
          "supabase_admin",
          "-d",
          database,
          "-X",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "VERBOSITY=verbose",
          "-c",
          `load ${q(safeupdate)};set safeupdate.enabled=on;begin;set local role ${role};${statement};commit;`,
        ]);
        return result.stdout.trim();
      } catch (error) {
        throw new Error(error.stderr || error.message, { cause: error });
      }
    };
    const configure = (publicKey, enabled) =>
      guarded(`select public.configure_web_push(${q(publicKey)},${enabled})`);
    const configuration = async () =>
      JSON.parse(
        await sql(
          "select to_jsonb(c)from private.push_configuration c where singleton=true",
        ),
      );
    const subscriptions = async () =>
      JSON.parse(
        await sql(
          "select coalesce(jsonb_agg(to_jsonb(s)order by s.id),'[]')from private.push_subscriptions s",
        ),
      );
    const [owner, peer] = Array.from({ length: 2 }, randomUUID);
    await sql(
      `insert into auth.users(id,email)values(${q(owner)},${q(owner + "@example.invalid")}),(${q(peer)},${q(peer + "@example.invalid")});insert into public.user_roles(user_id,role)values(${q(owner)},'lecturer'),(${q(peer)},'lecturer');`,
    );
    const publicA = key(),
      publicB = key();
    let checks = 0;
    /** Counts only completed behavior checks, never merely authored assertions. */
    const check = async (name, run) => {
      await run();
      checks++;
      console.log(`PASS ${name}`);
    };
    await check(
      "The actual loaded safeupdate hook is enabled and rejects an unrestricted UPDATE with21000",
      async () => {
        assert.equal(await guarded("show safeupdate.enabled"), "on");
        await assert.rejects(
          guarded(
            "update private.push_configuration set enabled=false",
            "supabase_admin",
          ),
          /21000/,
        );
        assert.deepEqual(await configuration(), {
          singleton: true,
          enabled: false,
          public_key: null,
        });
      },
    );
    await check(
      "Service-only first configuration succeeds with safeupdate enabled",
      async () => {
        await configure(publicA, true);
        assert.deepEqual(await configuration(), {
          singleton: true,
          enabled: true,
          public_key: publicA,
        });
      },
    );
    const register = async (who, label) => {
      const subscription = {
        endpoint: `https://fcm.googleapis.com/fcm/send/fictional-${randomUUID()}`,
        keys: { p256dh: key(), auth: randomBytes(16).toString("base64url") },
      };
      return actor(
        who,
        `select public.register_push_device(${q(JSON.stringify(subscription))}::jsonb,${q(randomUUID())},${q(label)})`,
      );
    };
    const first = await register(owner, "Fictional active owner"),
      second = await register(peer, "Fictional active peer"),
      inactive = await register(owner, "Fictional removed device");
    await actor(owner, `select public.remove_push_device(${q(inactive)})`);
    await check(
      "Same-key configuration preserves every active and inactive subscription byte",
      async () => {
        const before = await subscriptions();
        await configure(publicA, true);
        assert.deepEqual(await subscriptions(), before);
      },
    );
    await check(
      "Key rotation invalidates active subscriptions and preserves inactive device history exactly",
      async () => {
        const before = await subscriptions();
        await configure(publicB, true);
        const after = await subscriptions();
        assert.deepEqual(await configuration(), {
          singleton: true,
          enabled: true,
          public_key: publicB,
        });
        for (const prior of before) {
          const current = after.find((row) => row.id === prior.id);
          assert.ok(current);
          if (prior.active) {
            assert.equal(current.active, false);
            assert.deepEqual(
              { ...current, active: true, updated_at: prior.updated_at },
              prior,
            );
            assert.ok(
              Date.parse(current.updated_at) >= Date.parse(prior.updated_at),
            );
          } else assert.deepEqual(current, prior);
        }
        assert.equal(after.filter((row) => row.active).length, 0);
        assert.ok(after.some((row) => row.id === first));
        assert.ok(after.some((row) => row.id === second));
      },
    );
    await check(
      "Disabling with the same key preserves subscriptions and denies new registration",
      async () => {
        await register(owner, "Fictional fresh rotated device");
        const before = await subscriptions();
        await configure(publicB, false);
        assert.deepEqual(await configuration(), {
          singleton: true,
          enabled: false,
          public_key: publicB,
        });
        assert.deepEqual(await subscriptions(), before);
        await assert.rejects(
          register(owner, "Fictional disabled registration"),
          /55000/,
        );
        await configure(publicB, true);
        assert.deepEqual(await subscriptions(), before);
      },
    );
    await check(
      "Original key validation and service-only grants remain authoritative with the hook enabled",
      async () => {
        const before = await configuration();
        for (const value of [
          "malformed",
          Buffer.alloc(65).toString("base64url"),
        ])
          await assert.rejects(configure(value, true), /22023/);
        await assert.rejects(configure(publicB, "null"), /22023/);
        for (const role of ["anon", "authenticated"]) {
          for (const signature of [
            "public.configure_web_push(text,boolean)",
            "private.configure_web_push(text,boolean)",
          ])
            assert.equal(
              await sql(
                `select has_function_privilege(${q(role)},${q(signature)},'execute')`,
              ),
              "f",
            );
          await assert.rejects(
            guarded(
              `select public.configure_web_push(${q(publicB)},true)`,
              role,
            ),
            /42501/,
          );
        }
        for (const signature of [
          "public.configure_web_push(text,boolean)",
          "private.configure_web_push(text,boolean)",
        ])
          assert.equal(
            await sql(
              `select has_function_privilege('service_role',${q(signature)},'execute')`,
            ),
            "t",
          );
        assert.deepEqual(await configuration(), before);
      },
    );
    console.log(
      `${checks} actual safeupdate Web Push PostgreSQL groups passed.`,
    );
  },
);
