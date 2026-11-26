/** Rehearse LTI with a disposable loopback stack and a synthetic-only signing key. */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { localQaTempRoot, assertLocalQaMemory } from "./runtime-qa-memory.mjs";
import {
  assertLocalDocker,
  cleanEnvironment,
  command,
  privateWrite,
  root,
} from "./runtime-lib.mjs";
import { allocateTestServicePorts } from "./runtime-test-lock.mjs";
import { runtimeSnapshotSource } from "./runtime-snapshot.mjs";

/** Reserve a separate Vite port until the generated Supabase ports are allocated. */
async function reserveBrowserPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

assertLocalQaMemory(3);
const docker = await assertLocalDocker();
const project = `luminovia-portal-test-${randomBytes(4).toString("hex")}`;
const fixture = mkdtempSync(join(localQaTempRoot(), "luminovia-lti-browser-"));
const cwd = join(fixture, "source");
const env = cleanEnvironment({ DOCKER_HOST: docker, PORTAL_TEST_MODE: "1" });
delete env.DOCKER_CONTEXT;
const supabase = join(root, "node_modules/.bin/supabase");
let started = false;
let browserPort;
let failure;
let cleaning = false;
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);

/** Keep only non-secret launcher status and ordinary test evidence in the terminal output. */
async function run(file, args, extra = {}, timeoutMs = 360000) {
  const output = await command(file, args, {
    cwd,
    env: { ...env, ...extra },
    timeoutMs,
    signal: cleaning ? undefined : cancellation.signal,
  });
  process.stdout.write(output);
}
try {
  cpSync(root, cwd, {
    recursive: true,
    filter: (path) => runtimeSnapshotSource(path, root),
  });
  const dependencies = join(cwd, "node_modules");
  mkdirSync(dependencies);
  for (const file of readdirSync(join(root, "node_modules"))) {
    if (!file.startsWith(".vite") && !file.startsWith(".cache")) {
      symlinkSync(join(root, "node_modules", file), join(dependencies, file));
    }
  }
  const reserved = await reserveBrowserPort();
  try {
    browserPort = reserved.address().port;
    const config = join(cwd, "supabase/config.toml");
    const source = readFileSync(config, "utf8")
      .replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${project}"`)
      .replaceAll(":5173", `:${browserPort}`);
    writeFileSync(config, await allocateTestServicePorts(source));
  } finally {
    await new Promise((resolve) => reserved.close(resolve));
  }

  // Neither a current installation nor a real provider sees this generated key.
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ltiKey = {
    ...privateKey.export({ format: "jwk" }),
    kid: "lti-local-browser-fixture",
  };
  const privateDirectory = join(cwd, ".local");
  mkdirSync(privateDirectory, { mode: 0o700 });
  privateWrite(
    join(privateDirectory, "lti.env"),
    [
      "LTI_PLATFORM_ISSUER=https://lti-fixture-portal.example.invalid",
      "LTI_PLATFORM_RSA_PRIVATE_JWK=" + JSON.stringify(ltiKey),
      "",
    ].join("\n"),
  );

  started = true;
  await run(process.execPath, ["scripts/runtime-cli.mjs", "start"]);
  await run(process.execPath, ["scripts/local-seed.mjs"], {
    PORTAL_DB_CONTAINER: `supabase_db_${project}`,
  });
  await run(
    join(root, "node_modules/.bin/playwright"),
    ["test", "--config", "scripts/lti-browser-playwright.config.ts"],
    {
      PORTAL_LTI_BROWSER_FIXTURE: "1",
      E2E_BASE_URL: `http://127.0.0.1:${browserPort}`,
    },
  );
} catch (error) {
  failure = error;
} finally {
  cleaning = true;
  try {
    if (started) {
      try {
        await run(process.execPath, ["scripts/runtime-cli.mjs", "stop"]);
      } finally {
        // The disposable, random project ID above cannot identify a normal fixture.
        await run(supabase, ["stop", "--project-id", project, "--no-backup"]);
      }
    }
  } catch (cleanupError) {
    failure ??= cleanupError;
    console.error(
      "Unable to remove the isolated LTI fixture project: " + project,
    );
  }
  try {
    rmSync(fixture, { recursive: true, force: true });
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
}
if (failure) throw failure;
