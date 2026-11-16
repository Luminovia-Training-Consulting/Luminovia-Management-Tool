/**
 * Gemeinsame Fixtures für echte Auth-/REST-/RPC-/Storage-Prüfungen.
 * Nur das kanonische Zufallstestprojekt ist zulässig; Ressourcen werden vor ihren fiktiven Konten aufgeräumt.
 */
/** Real API fixtures belong only to the canonical disposable project, never dev. */
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

/** Berechnet den aktuellen sechsstelligen TOTP aus dem fiktiven MFA-Geheimnis; keine Codes protokollieren. */
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((character) => {
      const value = alphabet.indexOf(character);
      assert.ok(value >= 0, "Valid base32 MFA secret required");
      return value.toString(2).padStart(5, "0");
    })
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g).map((value) => Number.parseInt(value, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
/** Wertet den tatsächlichen SDK-Erfolg aus und gibt erst danach dessen Daten zurück. */
async function checked(request, label = "API operation") {
  const { data, error } = await request;
  assert.equal(error, null, `${label}: ${error?.message}`);
  return data;
}

/** Prüft Testmodus, Zufallsprojekt und API-Port vor jeder Mutation und sammelt Fachfehler sowie Cleanupfehler getrennt. */
export async function withApiFixture(run) {
  assert.equal(
    process.env.PORTAL_TEST_MODE,
    "1",
    "Only ./portal test owns mutating API fixtures.",
  );
  const config = readFileSync("supabase/config.toml", "utf8");
  const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
    config,
  )?.[1];
  assert.ok(
    project,
    "Only the canonical random disposable project is permitted.",
  );
  process.loadEnvFile(".env.test.local");
  const url = process.env.SUPABASE_URL;
  assert.ok(
    url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
    "Loopback API required.",
  );
  assert.equal(
    new URL(url).port,
    "55321",
    "Dedicated canonical API port required.",
  );
  /** Erzeugt einen getrennten SDK-Client ohne persistierte oder automatisch erneuerte Testsitzung. */
  const make = (key) =>
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
    clients = [],
    users = [],
    cleanups = [];
  const suffix = randomUUID();
  /** Sendet SQL an die eigene Testdatenbank und lässt jeden psql-Fehler den Prüflauf ablehnen. */
  const sql = (text) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          "exec",
          "-i",
          `supabase_db_${project}`,
          "psql",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-X",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "",
        error = "";
      child.stdout.on("data", (value) => (out += value));
      child.stderr.on("data", (value) => (error += value));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve(out.trim())
          : reject(new Error(error || "Isolated SQL failed")),
      );
      child.stdin.end(text);
    });
  /** Erstellt eine fiktive Auth-Identität, weist ihre Fixture-Rolle zu und meldet einen getrennten flüchtigen Client an. */
  const actor = async (name, role) => {
    assert.match(name, /^[a-z][a-z0-9-]{0,40}$/i);
    const email = `m4-${name}-${suffix}@example.invalid`;
    const result = await checked(
      service.auth.admin.createUser({
        email,
        password: process.env.E2E_PASSWORD,
        email_confirm: true,
      }),
      "Create fictional API actor",
    );
    users.push(result.user.id);
    await checked(
      service.from("user_roles").insert({ user_id: result.user.id, role }),
      "Assign fictional role",
    );
    await checked(
      service
        .from("profiles")
        .update({ display_name: `Fictional ${name}` })
        .eq("id", result.user.id),
      "Name fictional actor",
    );
    const client = make(process.env.SUPABASE_ANON_KEY);
    clients.push(client);
    await checked(
      client.auth.signInWithPassword({
        email,
        password: process.env.E2E_PASSWORD,
      }),
      "Sign in with actual Auth",
    );
    return { id: result.user.id, email, client };
  };
  /** Verifiziert einen echten TOTP-Faktor, damit privilegierte Prüfaufrufe tatsächlich AAL2 verwenden. */
  const mfa = async (client) => {
    const factor = await checked(
      client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Isolated M4 QA",
      }),
      "Enroll real MFA factor",
    );
    await checked(
      client.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: totp(factor.totp.secret),
      }),
      "Verify real TOTP",
    );
  };
  // Fachfehler bleiben erhalten, während abhängige Ressourcen vor Kanälen und Konten in umgekehrter Reihenfolge verschwinden.
  let failure;
  let result;
  const cleanupErrors = [];
  try {
    result = await run({
      service,
      actor,
      mfa,
      sql,
      defer: (callback) => cleanups.push(callback),
      checked,
      suffix,
      url,
    });
  } catch (error) {
    failure = error;
  } finally {
    for (const callback of cleanups.reverse())
      try {
        await callback();
      } catch (error) {
        cleanupErrors.push(error);
      }
    for (const client of clients)
      try {
        await client.removeAllChannels();
      } catch (error) {
        cleanupErrors.push(error);
      }
    if (users.length) {
      try {
        await checked(
          service.from("audit_events").delete().in("actor_id", users),
          "Remove own test audit",
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
      for (const id of users)
        try {
          await checked(
            service.auth.admin.deleteUser(id),
            "Remove own fictional account",
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
    }
  }
  // Auch ein fachlich erfolgreicher Lauf darf bei unvollständigem Cleanup keinen Erfolg melden.
  if (cleanupErrors.length)
    throw new AggregateError(
      failure ? [failure, ...cleanupErrors] : cleanupErrors,
      "Scoped API cleanup did not fully succeed",
    );
  if (failure) throw failure;
  return result;
}
