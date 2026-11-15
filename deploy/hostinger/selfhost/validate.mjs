#!/usr/bin/env node
/** Offline cryptography, permissions and Docker Compose boundary validation. */
import assert from "node:assert/strict";
import { createHash, createHmac, createPublicKey, verify } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createConfiguration, writeConfiguration } from "./generate-env.mjs";
import { checkGatewayRouting } from "./gateway-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const directory = mkdtempSync(
  resolve(tmpdir(), "luminovia-selfhost-validation-"),
);
try {
  const options = {
    portalOrigin: "https://portal.example.invalid",
    apiOrigin: "https://portal.example.invalid/backend",
    dataDirectory: resolve(directory, "data"),
  };
  const configuration = createConfiguration(options);
  const server = configuration.server;
  for (const [key, role] of [
    ["ANON_KEY", "anon"],
    ["SERVICE_ROLE_KEY", "service_role"],
  ]) {
    const [header, payload, signature] = server[key].split(".");
    assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "HS256");
    assert.equal(JSON.parse(Buffer.from(payload, "base64url")).role, role);
    assert.equal(
      signature,
      createHmac("sha256", server.JWT_SECRET)
        .update(header + "." + payload)
        .digest("base64url"),
    );
  }
  const jwks = JSON.parse(server.JWT_JWKS);
  const privateKeys = JSON.parse(server.JWT_KEYS);
  assert.equal(
    Buffer.from(jwks.keys[1].k, "base64url").toString(),
    server.JWT_SECRET,
  );
  assert(!("d" in jwks.keys[0]));
  assert.equal(privateKeys[0].kid, jwks.keys[0].kid);
  const publicKey = createPublicKey({ key: jwks.keys[0], format: "jwk" });
  for (const [key, role] of [
    ["ANON_KEY_ASYMMETRIC", "anon"],
    ["SERVICE_ROLE_KEY_ASYMMETRIC", "service_role"],
  ]) {
    const [header, payload, signature] = server[key].split(".");
    assert.equal(JSON.parse(Buffer.from(payload, "base64url")).role, role);
    assert(
      verify(
        "SHA256",
        Buffer.from(header + "." + payload),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    );
  }
  for (const name of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
    const key = server[name];
    const cut = key.length - 9;
    assert.equal(key[cut], "_");
    assert.equal(
      key.slice(cut + 1),
      createHash("sha256")
        .update("supabase-self-hosted|" + key.slice(0, cut))
        .digest("base64url")
        .slice(0, 8),
    );
  }
  assert.equal(
    server.API_EXTERNAL_URL,
    "https://portal.example.invalid/backend/auth/v1",
  );
  for (const name of [
    "MAILER_URLPATHS_INVITE",
    "MAILER_URLPATHS_CONFIRMATION",
    "MAILER_URLPATHS_RECOVERY",
    "MAILER_URLPATHS_EMAIL_CHANGE",
  ]) {
    assert.equal(
      new URL(server[name], server.API_EXTERNAL_URL).pathname,
      "/backend/auth/v1/verify",
    );
  }
  assert.deepEqual(Object.keys(configuration.public).sort(), [
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_URL",
  ]);
  assert(
    !JSON.stringify(configuration.public).includes(server.SERVICE_ROLE_KEY),
  );
  assert(
    !JSON.stringify(configuration.public).includes(server.SUPABASE_SECRET_KEY),
  );
  assert.equal(server.SMTP_HOST, "mailpit");
  assert.equal(server.SMTP_PORT, "1025");
  assert.equal(server.SMTP_ADMIN_EMAIL, "no-reply@example.invalid");
  assert.throws(() =>
    createConfiguration({
      ...options,
      portalOrigin: "http://portal.example.invalid",
    }),
  );
  assert.throws(() =>
    createConfiguration({
      ...options,
      apiOrigin: "https://user:password@portal.example.invalid/backend",
    }),
  );
  assert.throws(() =>
    createConfiguration({
      ...options,
      portalOrigin: "https://portal.example.invalid/path",
    }),
  );
  assert.throws(() =>
    createConfiguration({ ...options, dataDirectory: "relative" }),
  );
  const output = resolve(directory, "private", "selfhost.env");
  const paths = writeConfiguration(output, configuration);
  assert(paths.every((path) => (statSync(path).mode & 0o777) === 0o600));
  const original = readFileSync(output);
  assert.throws(() => writeConfiguration(output, configuration));
  assert.deepEqual(readFileSync(output), original);
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--project-directory",
      here,
      "--env-file",
      output,
      "-f",
      resolve(here, "compose.yml"),
      "config",
      "--format",
      "json",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw new Error(
      "Docker Compose validation failed (output withheld to protect generated credentials).",
    );
  const compose = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(compose.services).sort(), [
    "api-gw",
    "auth",
    "db",
    "functions",
    "mailpit",
    "realtime",
    "rest",
    "storage",
  ]);
  for (const [name, service] of Object.entries(compose.services)) {
    assert(/@sha256:[a-f0-9]{64}$/.test(service.image));
    if (name === "mailpit") {
      assert.equal(service.ports.length, 1);
      assert.equal(service.ports[0].host_ip, "127.0.0.1");
      assert.equal(service.ports[0].target, 8025);
    } else assert(!service.ports?.length, "Unexpected host-port publication.");
    for (const volume of service.volumes ?? []) {
      if (
        volume.type === "bind" &&
        !volume.source.startsWith(options.dataDirectory)
      )
        assert(
          existsSync(volume.source),
          "A source/config mount does not exist.",
        );
    }
  }
  const auth = compose.services.auth.environment;
  assert.equal(auth.GOTRUE_DISABLE_SIGNUP, "true");
  assert.equal(auth.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED, "false");
  assert.equal(auth.GOTRUE_EXTERNAL_PHONE_ENABLED, "false");
  assert.equal(auth.GOTRUE_MFA_TOTP_ENROLL_ENABLED, "true");
  assert.equal(auth.GOTRUE_MFA_TOTP_VERIFY_ENABLED, "true");
  assert.equal(auth.GOTRUE_MAILER_AUTOCONFIRM, "false");
  const workers = ["files", "invite-lecturer", "accounts"];
  for (const worker of workers) {
    const mount = compose.services.functions.volumes.find(
      (volume) => volume.target === "/home/deno/functions/" + worker,
    );
    assert(
      mount?.type === "bind" && mount.read_only === true,
      "Reviewed application worker must have an explicit read-only bind.",
    );
    assert.equal(
      mount.source,
      resolve(here, "../../../supabase/functions", worker),
    );
  }
  for (const name of [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "PORTAL_APP_ORIGIN",
    "PORTAL_ALLOWED_ORIGINS",
    "PORTAL_INVITES_ENABLED",
  ])
    assert(
      compose.services.functions.environment[name],
      "An accounts runtime environment field is missing.",
    );
  const router = readFileSync(resolve(here, "runtime/index.ts"), "utf8");
  assert(
    router.includes(
      "const PORTAL_FUNCTIONS = new Set(['files', 'invite-lecturer', 'accounts'])",
    ),
  );
  assert(router.includes("if (!PORTAL_FUNCTIONS.has(service_name))"));
  if (process.argv.includes("--gateway-routing"))
    checkGatewayRouting({
      directory,
      here,
      image: compose.services["api-gw"].image,
      server,
    });
  assert.equal(compose.services.functions.environment.VERIFY_JWT, "true");
  assert.equal(
    compose.services.functions.environment.PORTAL_CLAMAV_HOST,
    "clamav",
  );
  assert.equal(
    compose.services.functions.environment.PORTAL_CLAMAV_PORT,
    "3310",
  );
  assert(!("PORTAL_SCANNER_URL" in compose.services.functions.environment));
  assert(!("PORTAL_SCANNER_TOKEN" in compose.services.functions.environment));
  assert.equal(
    compose.services.storage.environment.ENABLE_IMAGE_TRANSFORMATION,
    "false",
  );
  console.log(
    "PASS: legacy/asymmetric key signatures, opaque-key checksums, prefix URLs, public-key separation, 0600/non-overwrite files, Compose mounts and private network/Auth boundaries.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
