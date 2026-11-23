/** Start and remove an independent Academy for each local WL-T21 proof. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertLocalDocker,
  cleanEnvironment,
  command,
  privateWrite,
  root,
} from "./runtime-lib.mjs";
import {
  ensureLoopbackNetwork,
  removeLoopbackNetwork,
  verifyLoopbackBindings,
} from "./runtime-network.mjs";
import { runtimeSnapshotSource } from "./runtime-snapshot.mjs";

const allEditions = ["customer-self-hosted", "customer-managed"];
const args = process.argv.slice(2);
const checkSwagger = args.includes("--swagger");
const checkAuthMail = args.includes("--auth-mail");
const requested = args.filter(
  (arg) => arg !== "--swagger" && arg !== "--auth-mail",
);
assert.ok(
  requested.length <= 1 &&
    requested.every((edition) => allEditions.includes(edition)),
  "Usage: node scripts/academy-course-material-rehearsal.mjs [--swagger] [--auth-mail] [customer-self-hosted|customer-managed]",
);
const editions = requested.length ? requested : allEditions;
const release = (
  await command("git", ["rev-parse", "HEAD"], { quiet: true })
).trim();
const workingTreeModified = Boolean(
  (await command("git", ["status", "--porcelain"], { quiet: true })).trim(),
);
const dockerHost = await assertLocalDocker();
const env = cleanEnvironment({
  DOCKER_HOST: dockerHost,
  PORTAL_TEST_MODE: "1",
});
delete env.DOCKER_CONTEXT;
const cancellation = new AbortController();
const abort = () => cancellation.abort();
process.once("SIGINT", abort);
process.once("SIGTERM", abort);

async function localConfig(project) {
  const source = readFileSync(join(root, "supabase/config.toml"), "utf8");
  const ports = [
    ...new Set([
      ...[
        ...source.matchAll(
          /^(?:port|shadow_port|inspector_port)\s*=\s*(\d+)$/gm,
        ),
      ].map((match) => match[1]),
      ...[...source.matchAll(/127\.0\.0\.1:(\d+)/g)].map((match) => match[1]),
    ]),
  ];
  const reserved = [];
  try {
    const assignments = new Map();
    for (const port of ports) {
      const server = createServer();
      reserved.push(server);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      assignments.set(port, server.address().port);
    }
    let config = (
      checkSwagger
        ? source.replace(/^jwt_expiry\s*=.*$/m, "jwt_expiry = 30")
        : source
    )
      .replace(/^project_id\s*=.*$/m, `project_id = "${project}"`)
      .replace(
        /^(port|shadow_port|inspector_port)\s*=\s*(\d+)$/gm,
        (_, key, port) => `${key} = ${assignments.get(port)}`,
      )
      .replace(
        /(127\.0\.0\.1:)\d+/g,
        (value, prefix) => prefix + assignments.get(value.slice(prefix.length)),
      );
    if (checkAuthMail) {
      const academyCompose = readFileSync(
        join(root, "deploy/academy/compose.override.yml"),
        "utf8",
      );
      for (const event of ["invite", "recovery"]) {
        const subject = new RegExp(
          `^\\s*GOTRUE_MAILER_SUBJECTS_${event.toUpperCase()}: "([^"\\r\\n]+)"$`,
          "m",
        ).exec(academyCompose)?.[1];
        const setting = new RegExp(
          `(\\[auth\\.email\\.template\\.${event}\\]\\nsubject = )"[^"\\n]+"`,
        );
        assert.ok(
          subject && setting.test(config),
          "The Academy capture subjects are missing.",
        );
        config = config.replace(
          setting,
          (_, key) => key + JSON.stringify(subject),
        );
      }
    }
    const api = /^\[api\][\s\S]*?^port\s*=\s*(\d+)$/m.exec(config)?.[1];
    const origin = /^site_url\s*=\s*"(http:\/\/127\.0\.0\.1:\d+)"$/m.exec(
      config,
    )?.[1];
    assert.ok(
      api && origin,
      "Local config lacks loopback API or application origin.",
    );
    return { config, origin, base: `http://127.0.0.1:${api}` };
  } finally {
    await Promise.all(
      reserved.map((server) => new Promise((resolve) => server.close(resolve))),
    );
  }
}

async function waitForFiles(base, origin) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/functions/v1/files`, {
        method: "OPTIONS",
        headers: { Origin: origin },
        signal: AbortSignal.any([
          AbortSignal.timeout(2000),
          cancellation.signal,
        ]),
      });
      if (response.status === 204) return;
      await response.body?.cancel();
    } catch (error) {
      if (cancellation.signal.aborted) throw error;
    }
    await delay(400, undefined, { signal: cancellation.signal });
  }
  throw new Error("Isolated Academy file gateway did not return HTTP 204.");
}

for (const edition of editions) {
  const project = `luminovia-portal-test-${randomBytes(4).toString("hex")}`;
  const directory = mkdtempSync(join(tmpdir(), "luminovia-academy-material-"));
  const run = (file, args, options = {}) =>
    command(file, args, {
      cwd: directory,
      env,
      quiet: true,
      signal: cancellation.signal,
      ...options,
    });
  const cli = join(directory, "node_modules/.bin/supabase");
  const errors = [];
  let edge;
  let networkReady = false;
  let stackAttempted = false;
  let scannerAttempted = false;
  const edgeStop = new AbortController();
  try {
    const { config, origin, base } = await localConfig(project);
    mkdirSync(join(directory, "supabase"));
    for (const component of ["migrations", "functions", "templates"]) {
      cpSync(
        join(root, "supabase", component),
        join(directory, "supabase", component),
        {
          recursive: true,
          filter: (source) => runtimeSnapshotSource(source, root),
        },
      );
    }
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
    privateWrite(join(directory, "supabase/config.toml"), config);
    const network = await ensureLoopbackNetwork(project);
    networkReady = true;
    console.log(`Starting isolated Academy rehearsal for ${edition}.`);
    stackAttempted = true;
    await run(cli, [
      "start",
      "--network-id",
      network,
      "--exclude",
      "studio,postgres-meta,edge-runtime,logflare,vector,imgproxy,supavisor",
    ]);
    await verifyLoopbackBindings(project);
    scannerAttempted = true;
    await run(process.execPath, [
      join(root, "scripts/local-scanner.mjs"),
      "start",
    ]);
    const edgeEnv = join(directory, "edge.env");
    privateWrite(
      edgeEnv,
      `PORTAL_CLAMAV_HOST=portal_scanner_${project}\nPORTAL_CLAMAV_PORT=3310\nPORTAL_ALLOWED_ORIGINS=${origin}\nPORTAL_APP_ORIGIN=${origin}\n${checkAuthMail ? "PORTAL_INVITES_ENABLED=true\n" : ""}`,
    );
    edge = run(
      cli,
      ["functions", "serve", "--network-id", network, "--env-file", edgeEnv],
      {
        signal: AbortSignal.any([cancellation.signal, edgeStop.signal]),
        timeoutMs: checkSwagger ? 360_000 : 240_000,
      },
    ).then(
      () => new Error("The isolated Edge worker exited early."),
      (error) => error,
    );
    await Promise.race([
      waitForFiles(base, origin),
      edge.then((error) => {
        throw error;
      }),
    ]);
    await verifyLoopbackBindings(project, { edge: true, scanner: true });
    const receipt = await run(process.execPath, [
      join(root, "scripts/academy-course-material-http-check.mjs"),
      edition,
      release,
    ]);
    const authMail = checkAuthMail
      ? JSON.parse(
          await run(
            process.execPath,
            [join(root, "scripts/testing/academy-auth-delivery-check.mjs")],
            { timeoutMs: 90_000 },
          ),
        )
      : undefined;
    const swagger = checkSwagger
      ? JSON.parse(
          await run(
            process.execPath,
            [join(root, "scripts/academy-swagger-http-check.mjs"), edition],
            { timeoutMs: 180_000 },
          ),
        )
      : undefined;
    console.log(
      JSON.stringify({
        ...JSON.parse(receipt),
        ...(swagger && { swagger }),
        ...(authMail && { auth_mail: authMail }),
        evidence: "isolated-local",
        working_tree_modified: workingTreeModified,
      }),
    );
  } catch (error) {
    errors.push(error);
  } finally {
    edgeStop.abort();
    if (edge) await edge;
    const cleanup = async (action) => {
      try {
        await action();
      } catch (error) {
        errors.push(error);
      }
    };
    if (scannerAttempted)
      await cleanup(() =>
        run(
          process.execPath,
          [join(root, "scripts/local-scanner.mjs"), "stop"],
          { signal: undefined },
        ),
      );
    if (stackAttempted)
      await cleanup(() =>
        run(cli, ["stop", "--project-id", project, "--no-backup"], {
          signal: undefined,
        }),
      );
    if (scannerAttempted)
      await cleanup(async () => {
        const owned = await run(
          "docker",
          [
            "volume",
            "ls",
            "--filter",
            `label=org.luminovia.portal=${project}`,
            "--format",
            "{{.Name}}",
          ],
          { signal: undefined },
        );
        if (owned.trim().split("\n").includes(`portal_clamav_${project}`))
          await run("docker", ["volume", "rm", `portal_clamav_${project}`], {
            signal: undefined,
          });
      });
    if (networkReady) await cleanup(() => removeLoopbackNetwork(project));
    rmSync(directory, { recursive: true, force: true });
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      `Academy rehearsal failed for ${edition}.`,
    );
}
