import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { initializeAcademyRuntime } from "./academy-runtime-config.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const firstId = "9b225490-5319-4b8c-b551-e5ce93a2fafe";
const secondId = "57baee85-c6d0-4dc5-9639-73f005bb846a";
const composeEnv = { PATH: process.env.PATH };
const hasCompose =
  spawnSync("docker", ["compose", "version"], {
    env: composeEnv,
  }).status === 0;

function temporaryDirectory(t) {
  const path = mkdtempSync(join(tmpdir(), "academy-runtime-test-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function envAt(root, name = "runtime.env") {
  return parseEnv(readFileSync(join(root, name), "utf8"));
}

function initialization(root, options = {}) {
  return {
    root,
    installationId: firstId,
    edition: "customer-self-hosted",
    portalOrigin: "https://training.example.invalid/",
    bindAddress: "127.0.0.1",
    ...options,
  };
}

function compose(root, profiles, capture = false, runtimeVariables = {}) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      join(root, "runtime.env"),
      "-f",
      "deploy/hostinger/selfhost/compose.yml",
      "-f",
      "deploy/academy/compose.override.yml",
      ...(capture ? ["-f", "deploy/academy/mail-capture.override.yml"] : []),
      ...profiles.flatMap((profile) => ["--profile", profile]),
      "config",
      "--format",
      "json",
    ],
    {
      cwd: repository,
      encoding: "utf8",
      env: { ...composeEnv, ...runtimeVariables },
    },
  );
  // Compose JSON contains runtime secrets. Assertion output must not include it.
  assert.equal(result.status, 0, "Compose rejected the dedicated runtime");
  return JSON.parse(result.stdout);
}

test("generates separate private runtime identities and paired public environments", (t) => {
  const base = temporaryDirectory(t);
  const roots = ["customer", "managed"].map((name) => join(base, name));
  const first = initializeAcademyRuntime(initialization(roots[0]));
  const second = initializeAcademyRuntime(
    initialization(roots[1], {
      installationId: secondId,
      edition: "customer-managed",
      portalOrigin: "https://managed.example.invalid",
    }),
  );
  assert.notEqual(first.compose_project, second.compose_project);
  assert.notEqual(first.backend_network, second.backend_network);
  assert.equal(first.api_base_url, "https://training.example.invalid/backend");
  assert.equal(second.api_base_url, "https://managed.example.invalid/backend");
  const secrets = roots.map((root) => envAt(root));
  for (const name of [
    "POSTGRES_PASSWORD",
    "JWT_SECRET",
    "SERVICE_ROLE_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "S3_PROTOCOL_ACCESS_KEY_SECRET",
    "PORTAL_MAIL_RELAY_CONTROL_TOKEN",
    "GLOBAL_S3_BUCKET",
    "STORAGE_TENANT_ID",
  ]) {
    assert.ok(
      secrets[0][name] &&
        secrets[1][name] &&
        secrets[0][name] !== secrets[1][name],
      "Runtimes must use separate private values and storage namespaces",
    );
  }
  for (const [i, identity] of [first, second].entries()) {
    const root = roots[i];
    const runtime = secrets[i];
    const web = envAt(root, "runtime.env.public.env");
    assert.deepEqual(Object.keys(web).sort(), [
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_URL",
    ]);
    assert.ok(
      web.VITE_SUPABASE_PUBLISHABLE_KEY === runtime.SUPABASE_PUBLISHABLE_KEY,
    );
    assert.equal(web.VITE_SUPABASE_URL, identity.api_base_url);
    assert.equal(runtime.PORTAL_APP_ORIGIN, identity.portal_origin);
    assert.equal(runtime.API_EXTERNAL_URL, identity.api_base_url + "/auth/v1");
    assert.equal(runtime.MAILER_URLPATHS_INVITE, "/backend/auth/v1/verify");
    assert.equal(runtime.PORTAL_INVITES_ENABLED, "false");
    assert.equal(runtime.PORTAL_TOTP_ENABLED, "false");
    assert.equal(runtime.PORTAL_TOTP_SECURITY_MAIL_ENABLED, "false");
    assert.equal(runtime.PORTAL_WEBSITE_ENQUIRIES_ENABLED, "false");
    assert.equal(
      envAt(root, "runtime.env.notification.env")
        .PORTAL_NOTIFICATION_MAIL_ENABLED,
      "false",
    );
    assert.equal(statSync(root).mode & 0o777, 0o700);
    for (const name of ["browser", "data", "backups"]) {
      const path = join(root, name);
      assert.equal(statSync(path).mode & 0o777, 0o700);
      assert.deepEqual(readdirSync(path), []);
    }
    for (const name of [
      "installation.json",
      "runtime.env",
      "runtime.env.public.env",
      "runtime.env.notification.env",
    ]) {
      assert.equal(statSync(join(root, name)).mode & 0o777, 0o600);
    }
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, "installation.json"), "utf8")),
      identity,
    );
  }
});

test("refuses previous runtimes, linked paths and unsupported external origins before writing", (t) => {
  const base = temporaryDirectory(t);
  const root = join(base, "existing");
  initializeAcademyRuntime(initialization(root));
  writeFileSync(join(root, "data", "retained"), "fictional existing data");
  assert.throws(() => initializeAcademyRuntime(initialization(root)), {
    code: "EEXIST",
  });
  assert.equal(
    readFileSync(join(root, "data", "retained"), "utf8"),
    "fictional existing data",
  );
  const alias = join(base, "link");
  symlinkSync(root, alias);
  assert.throws(() => initializeAcademyRuntime(initialization(alias)), {
    code: "EEXIST",
  });
  assert.throws(
    () => initializeAcademyRuntime(initialization(join(alias, "new"))),
    /academy_runtime_parent/,
  );
  for (const portalOrigin of [
    "http://example.invalid",
    "https://localhost",
    "https://127.0.0.1",
    "https://example.invalid/private",
    "https://user@example.invalid",
    "https://example.invalid:8443",
    "https://example.invalid/?token=fake",
    "https://example.invalid/#fragment",
  ])
    assert.throws(
      () =>
        initializeAcademyRuntime(
          initialization(join(base, "new"), { portalOrigin }),
        ),
      /academy_runtime_origin/,
    );
  assert.throws(
    () =>
      initializeAcademyRuntime(
        initialization(join(base, "new"), { bindAddress: "::" }),
      ),
    /academy_runtime_bind_address/,
  );
  assert.deepEqual(readdirSync(base).sort(), ["existing", "link"]);
});

test(
  "actual Compose resolves independent networks, mounted storage and private services",
  {
    skip: hasCompose ? false : "Docker Compose not installed",
  },
  (t) => {
    const base = temporaryDirectory(t);
    const selfHosted = initializeAcademyRuntime(
      initialization(join(base, "customer")),
    );
    const managed = initializeAcademyRuntime(
      initialization(join(base, "managed"), {
        installationId: secondId,
        edition: "customer-managed",
        portalOrigin: "https://managed.example.invalid",
        bindAddress: "192.0.2.20",
      }),
    );
    const privateServiceNames = [
      "api-gw",
      "auth",
      "clamav",
      "db",
      "functions",
      "mail-relay",
      "realtime",
      "rest",
      "storage",
    ];
    const host = readFileSync(
      join(repository, "deploy/hostinger/compose.yml"),
      "utf8",
    );
    for (const identity of [selfHosted, managed]) {
      const root = join(identity.data_directory, "..");
      const privateOnly = compose(root, []);
      const withProfiles = compose(root, ["ingress", "mail-capture"]);
      const withCapture = compose(root, ["mail-capture"], true);
      const withWorker = compose(root, ["notification-mail"]);
      assert.equal(privateOnly.services["notification-mail"], undefined);
      assert.equal(withWorker.services["notification-mail"].ports, undefined);
      assert.equal(
        withWorker.services["notification-mail"].environment
          .PORTAL_NOTIFICATION_MAIL_ENABLED,
        "false",
      );
      assert.equal(
        withWorker.services["notification-mail"].environment
          .PORTAL_NOTIFICATION_API_URL,
        "http://api-gw:8000",
      );
      assert.equal(
        withWorker.services["mail-relay"].environment
          .PORTAL_MAIL_RELAY_ACADEMY_NOTIFICATIONS,
        "true",
      );
      assert.equal(privateOnly.name, identity.compose_project);
      assert.equal(privateOnly.networks.backend.name, identity.backend_network);
      assert.equal(Boolean(privateOnly.networks.backend.external), false);
      assert.deepEqual(
        Object.keys(privateOnly.services).sort(),
        privateServiceNames,
      );
      const {
        auth,
        db,
        functions,
        storage,
        web,
        mailpit,
        "api-gw": gateway,
        "api-ingress": ingress,
      } = withProfiles.services;
      assert.equal(auth.environment.GOTRUE_SITE_URL, identity.portal_origin);
      assert.equal(auth.environment.GOTRUE_SMTP_HOST, "mail-relay");
      assert.equal(
        withCapture.services.auth.environment.GOTRUE_SMTP_HOST,
        "mailpit",
      );
      assert.equal(
        withCapture.services.auth.environment.GOTRUE_SMTP_PORT,
        "1025",
      );
      assert.equal(withCapture.services.auth.environment.GOTRUE_SMTP_PASS, "");
      assert.equal(
        withCapture.services.auth.depends_on.mailpit.condition,
        "service_healthy",
      );
      assert.equal(Boolean(withCapture.services.mailpit.ports?.length), false);
      assert.equal(
        withCapture.services.auth.environment.GOTRUE_MAILER_TEMPLATES_INVITE,
        "",
      );
      assert.equal(
        auth.environment.GOTRUE_MAILER_TEMPLATES_INVITE,
        identity.portal_origin + "/mail-templates/invite.html",
      );
      assert.match(
        auth.environment.GOTRUE_MAILER_SUBJECTS_RECOVERY,
        /Akademie|Passwort/,
      );
      assert.equal(
        functions.environment.PORTAL_ALLOWED_ORIGINS,
        identity.portal_origin,
      );
      assert.equal(functions.environment.PORTAL_INVITES_ENABLED, "false");
      assert.equal(functions.environment.PORTAL_CLAMAV_HOST, "clamav");
      assert.ok(gateway.networks.backend.aliases.includes("api"));
      assert.ok(
        db.volumes.some((volume) =>
          volume.source?.startsWith(identity.data_directory + "/"),
        ),
      );
      assert.ok(
        storage.volumes.some(
          (volume) =>
            volume.source === join(identity.data_directory, "storage"),
        ),
      );
      assert.ok(
        mailpit.volumes.some(
          (volume) =>
            volume.source === join(identity.data_directory, "mailpit"),
        ),
      );
      assert.equal(
        web.environment.PORTAL_DOMAIN,
        new URL(identity.portal_origin).hostname,
      );
      assert.equal(web.environment.PORTAL_API_UPSTREAM, "api-ingress:8001");
      assert.equal(
        web.environment.PORTAL_CADDY_ALIAS_PROFILE,
        "academy_no_aliases",
      );
      assert.equal(ingress.image, gateway.image);
      assert.ok(
        ingress.volumes.some(
          (volume) =>
            volume.source ===
              join(identity.browser_directory, "api-ingress.yml") &&
            volume.read_only === true &&
            volume.bind.create_host_path === false,
        ),
      );
      assert.ok(
        web.volumes.some(
          (volume) =>
            volume.source === identity.browser_directory &&
            volume.read_only === true,
        ),
      );
      assert.ok(
        web.volumes.some(
          (volume) =>
            volume.source === join(repository, "deploy/hostinger/Caddyfile") &&
            volume.read_only === true,
        ),
      );
      assert.ok(
        host.includes(web.image) &&
          host.includes(withProfiles.services.clamav.image),
      );
      assert.deepEqual(
        Object.entries(withProfiles.services)
          .filter(([, service]) => service.ports?.length)
          .map(([name]) => name),
        ["web"],
      );
      const address = identity === selfHosted ? "127.0.0.1" : "192.0.2.20";
      assert.deepEqual(
        web.ports.map(({ host_ip, target, protocol }) => [
          host_ip,
          target,
          protocol,
        ]),
        [
          [address, 80, "tcp"],
          [address, 443, "tcp"],
        ],
      );
      for (const volume of Object.values(withProfiles.volumes)) {
        assert.ok(volume.name.startsWith(identity.compose_project + "_"));
      }
    }
  },
);

test(
  "actual Compose keeps TOTP and factor mail as separate operator opt-ins",
  { skip: hasCompose ? false : "Docker Compose not installed" },
  (t) => {
    const root = join(temporaryDirectory(t), "academy");
    const identity = initializeAcademyRuntime(initialization(root));
    const defaults = compose(root, []).services.auth.environment;
    const totp = compose(root, [], false, { PORTAL_TOTP_ENABLED: "true" })
      .services.auth.environment;
    const opts = {
      PORTAL_TOTP_ENABLED: "true",
      PORTAL_TOTP_SECURITY_MAIL_ENABLED: "true",
    };
    const enabled = compose(root, [], false, opts).services.auth.environment;
    const capture = compose(root, ["mail-capture"], true, opts).services.auth
      .environment;

    for (const suffix of ["ENROLL_ENABLED", "VERIFY_ENABLED"]) {
      const totpFlag = `GOTRUE_MFA_TOTP_${suffix}`;
      assert.equal(defaults[totpFlag], "false");
      assert.equal(totp[totpFlag], "true");
      assert.equal(enabled[totpFlag], "true");
      for (const method of ["PHONE", "WEB_AUTHN"])
        assert.equal(enabled[`GOTRUE_MFA_${method}_${suffix}`], "false");
    }

    for (const action of ["ENROLLED", "UNENROLLED"]) {
      const notice = `GOTRUE_MAILER_NOTIFICATIONS_MFA_FACTOR_${action}_ENABLED`;
      const template = `GOTRUE_MAILER_TEMPLATES_MFA_FACTOR_${action}_NOTIFICATION`;
      assert.equal(defaults[notice], "false");
      assert.equal(totp[notice], "false");
      assert.equal(enabled[notice], "true");
      assert.equal(capture[notice], "true");
      assert.equal(capture[template], "");
      assert.equal(
        enabled[template],
        `${identity.portal_origin}/mail-templates/authenticator-${action.toLowerCase()}.html`,
      );
    }
    assert.equal(enabled.GOTRUE_SMTP_HOST, "mail-relay");
    assert.equal(capture.GOTRUE_SMTP_HOST, "mailpit");
  },
);
