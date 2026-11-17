/**
 * Explicit operator tool for the configured hosted development instance.
 * Uses real private credentials and temporary test data; do not run it as an ordinary offline test.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertPasswordOnly } from "./testing/password-only.mjs";
import { root } from "./runtime-lib.mjs";
import {
  hostedDownloadRequest,
  hostedPublicApiKey,
  readHostedPrivateText as privateRead,
} from "./testing/hosted-private-text.mjs";

// This is deliberately separate from the loopback-only local mutation suites.
// Only this named, fictional, self-hosted development installation is accepted.
const allowedTargets = new Set([
  "https://srv2163645.hstgr.cloud",
  "https://cms.luminovia.org",
]);
const directory = join(root, ".local/hostinger");
const statePath = join(directory, "hosted-check-state.json");
const envPath = join(directory, "selfhost.env");
const args = process.argv.slice(2);
const allowed = new Set([
  "--run",
  "--target",
  "--private-api",
  "--bootstrap-only",
  "--claims",
  "--retarget-ledger",
  "--mailpit-api",
  "--retain-probe",
  "--verify-probe",
  "--verify-realtime",
  "--help",
]);
const options = {};
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  assert(
    allowed.has(name) && !(name in options),
    "Unknown or repeated hosted-check argument",
  );
  options[name] = [
    "--run",
    "--bootstrap-only",
    "--retarget-ledger",
    "--help",
    "--retain-probe",
    "--verify-probe",
    "--verify-realtime",
  ].includes(name)
    ? true
    : args[++i];
}
if (options["--help"] || !options["--run"]) {
  console.log(
    "Prepare/read only by default. To bootstrap/check the named DEVELOPMENT VM:",
  );
  console.log(
    "node scripts/hostinger-hosted-check.mjs --run --target https://cms.luminovia.org --private-api http://127.0.0.1:TUNNEL_PORT [--bootstrap-only | --retain-probe | --verify-probe | --verify-realtime] [--claims 50] [--retarget-ledger] [--mailpit-api http://127.0.0.1:MAIL_TUNNEL_PORT]",
  );
  console.log(
    "The private API must be an SSH tunnel to this VM's internal gateway, not the public web route. No cloud project, real recipients or existing password resets are accepted. Passwords are saved only in ignored .local/hostinger/ACCOUNTS.txt (0600). The complete check creates and removes only its own UUID-scoped fictional records; bootstrap accounts remain for development/browser checks.",
  );
  process.exit(0);
}
const target = options["--target"];
assert(
  allowedTargets.has(target),
  "Explicit named development target required",
);
const api = target + "/backend";
const privateApi = new URL(options["--private-api"] ?? "");
assert(
  privateApi.protocol === "http:" &&
    ["127.0.0.1", "[::1]"].includes(privateApi.hostname) &&
    privateApi.port &&
    privateApi.pathname === "/" &&
    !privateApi.username &&
    !privateApi.password &&
    !privateApi.search &&
    !privateApi.hash,
  "Private bootstrap requires an explicit loopback SSH tunnel URL",
);
const claimAttempts =
  options["--claims"] === undefined ? 2 : Number(options["--claims"]);
assert(
  [2, 50].includes(claimAttempts),
  "Only two or fifty explicitly bounded claim attempts are supported",
);
let mailpit;
if (options["--mailpit-api"]) {
  mailpit = new URL(options["--mailpit-api"]);
  assert(
    mailpit.protocol === "http:" &&
      ["127.0.0.1", "[::1]"].includes(mailpit.hostname) &&
      mailpit.port &&
      mailpit.pathname === "/" &&
      !mailpit.username &&
      !mailpit.password &&
      !mailpit.search &&
      !mailpit.hash,
    "Mail capture requires an explicit loopback SSH tunnel, never a public mailbox",
  );
}
/** Writes private operator state through a temporary file and keeps its permissions restrictive. */
function privateWrite(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
const environment = {};
for (const line of privateRead(envPath).split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const parsed = /^([A-Z][A-Z0-9_]*)='([^'\r\n\0]*)'$/.exec(line);
  assert(
    parsed && !(parsed[1] in environment),
    "Unexpected private environment serialization",
  );
  environment[parsed[1]] = parsed[2];
}
assert.equal(environment.PORTAL_APP_ORIGIN, target);
assert.equal(environment.SUPABASE_PUBLIC_URL, api);
assert.equal(
  environment.SMTP_HOST,
  "mailpit",
  "This development check refuses real SMTP delivery",
);
assert(
  environment.SERVICE_ROLE_KEY && environment.SUPABASE_PUBLISHABLE_KEY,
  "Server and public API configuration required",
);
// Only this classified public key may leave the private configuration for public
// clients/headers. Administrative credentials and real actor sessions keep their existing boundaries.
const publicApiKey = hostedPublicApiKey(environment.SUPABASE_PUBLISHABLE_KEY);
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (url, key) =>
  createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
const service = make(privateApi.href, environment.SERVICE_ROLE_KEY);
/** Creates the unprivileged public-key client for actual hosted permission checks. */
const publicClient = () => make(api, publicApiKey);
const clients = [];
/** Persists the private operator ledger so owned resources can be recovered after interruption. */
const save = () =>
  privateWrite(statePath, JSON.stringify(state, null, 2) + "\n");
const state = existsSync(statePath)
  ? JSON.parse(privateRead(statePath))
  : { version: 1, target, installationId: randomUUID(), accounts: {} };
assert(
  state.version === 1 &&
    allowedTargets.has(state.target) &&
    /^[0-9a-f-]{36}$/.test(state.installationId) &&
    state.accounts &&
    typeof state.accounts === "object",
  "Private account state belongs to another installation",
);
assert(
  !state.lastRun || state.lastRun.status === "cleaned",
  "An earlier check needs scoped cleanup/reconciliation before another mutation run",
);
const backendFingerprint = createHash("sha256")
  .update(environment.SERVICE_ROLE_KEY)
  .digest("hex");
if (state.backend) {
  assert(
    state.backend.vpsId === 2163645 &&
      state.backend.serviceRoleFingerprint === backendFingerprint,
    "Private ledger belongs to a different backend/key set; manual reconciliation required",
  );
}
if (options["--verify-realtime"]) {
  assert(
    state.target === target &&
      state.backend?.serviceRoleFingerprint === backendFingerprint &&
      ["admin", "lecturer", "peer"].every(
        (name) => state.accounts[name]?.complete,
      ),
    "Realtime acceptance requires the existing canonical development ledger and bootstrap accounts",
  );
  await verifyRealtime();
  process.exit(0);
}
if (state.target !== target) {
  assert(
    options["--retarget-ledger"],
    "Origin change requires explicit --retarget-ledger for the same existing development database",
  );
  const users = (
    await checked(
      service.auth.admin.listUsers({ perPage: 1000 }),
      "Verify existing backend before origin retarget",
    )
  ).users;
  for (const name of ["admin", "lecturer", "peer"]) {
    const account = state.accounts[name];
    assert(
      account?.complete &&
        account.id &&
        users.some(
          (user) => user.id === account.id && user.email === account.email,
        ),
      "Existing bootstrap identities do not match this backend; refusing origin retarget/adoption",
    );
  }
  state.previousOrigins = [
    ...new Set([...(state.previousOrigins ?? []), state.target]),
  ];
  state.target = target;
}
state.backend = { vpsId: 2163645, serviceRoleFingerprint: backendFingerprint };
save();
let passes = 0;
/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
  const result = await request;
  if (result.error)
    throw new Error(
      `${label} failed (${result.error.code ?? result.error.status ?? "API error"})`,
    );
  return result.data;
}
/** Counts and reports a case only after all of its assertions have completed successfully. */
async function check(name, callback) {
  await callback();
  passes++;
  console.log(`PASS ${name}`);
}
/** Signs the test identity in through Auth; an error never counts as an authorised session. */
async function signIn(account) {
  const client = publicClient();
  clients.push(client);
  const data = await checked(
    client.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    }),
    "Hosted password sign-in",
  );
  assert.equal(data.user.id, account.id);
  assert(
    data.session?.access_token,
    "An actual hosted Auth session is required",
  );
  return { client, id: account.id };
}
const bootstrapDefinitions = [
  [
    "admin",
    "hosted-admin@example.invalid",
    "Fiktive Entwicklungsverwaltung",
    "admin",
  ],
  [
    "lecturer",
    "hosted-lecturer01@example.invalid",
    "Fiktive Lehrperson Eins",
    "lecturer",
  ],
  [
    "peer",
    "hosted-lecturer02@example.invalid",
    "Fiktive Lehrperson Zwei",
    "lecturer",
  ],
];
for (const [name, email, displayName, role] of bootstrapDefinitions) {
  let account = state.accounts[name];
  const existing = (
    await checked(
      service.auth.admin.listUsers({ perPage: 1000 }),
      "List private development Auth accounts",
    )
  ).users.find((user) => user.email === email);
  if (!account) {
    assert(
      !existing,
      "An existing bootstrap email has no saved credentials; refusing password reset/adoption",
    );
    account = {
      email,
      role,
      password: `Dev!${randomBytes(24).toString("base64url")}Aa9`,
      complete: false,
    };
    state.accounts[name] = account;
    save();
  }
  assert.equal(account.email, email);
  assert.equal(account.role, role);
  assert(typeof account.password === "string" && account.password.length >= 30);
  if (!account.id) {
    if (existing) {
      assert.equal(
        existing.user_metadata?.portal_hosted_bootstrap_id,
        state.installationId,
        "Uncertain Auth creation must be reconciled instead of resetting a password",
      );
      account.id = existing.id;
    } else {
      const created = await checked(
        service.auth.admin.createUser({
          email,
          password: account.password,
          email_confirm: true,
          user_metadata: { portal_hosted_bootstrap_id: state.installationId },
        }),
        "Create fictional development bootstrap account without sending email",
      );
      account.id = created.user.id;
    }
    save();
  } else {
    assert.equal(
      existing?.id,
      account.id,
      "Existing bootstrap identity changed; reconciliation required",
    );
  }
  if (!account.complete) {
    await checked(
      service
        .from("profiles")
        .update({
          display_name: displayName,
          bio_de: "Fiktive Entwicklungsperson. Keine echte Person.",
          bio_en: "Fictional development person. Not a real person.",
          locale: "de",
          time_zone: "Europe/Berlin",
          active: true,
        })
        .eq("id", account.id),
      "Initialize fictional profile",
    );
    await checked(
      service
        .from("user_roles")
        .upsert({ user_id: account.id, role }, { onConflict: "user_id,role" }),
      "Server-side initial role assignment",
    );
    account.complete = true;
    save();
  }
}
privateWrite(
  join(directory, "ACCOUNTS.txt"),
  [
    "Luminovia – confidential, entirely fictional Hostinger development accounts",
    `Sign in: ${target}`,
    "Not a production system. No real people. Auth emails remain in private Mailpit.",
    "Administration uses the configured password and database role; MFA is not enabled.",
    "Existing passwords and profiles are not reset by repeated checks.",
    "",
    ...bootstrapDefinitions.flatMap(([name]) => [
      `${name}: ${state.accounts[name].email}`,
      `Password: ${state.accounts[name].password}`,
      "",
    ]),
  ].join("\n") + "\n",
);
privateWrite(
  join(directory, "hosted-bootstrap.json"),
  JSON.stringify(
    {
      target,
      users: bootstrapDefinitions.map(([name]) => ({
        name,
        id: state.accounts[name].id,
        email: state.accounts[name].email,
        role: state.accounts[name].role,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Fictional bootstrap accounts ready; private account file written (0600); no credential values printed.",
);
assert(
  !(options["--retain-probe"] && options["--verify-probe"]),
  "Choose creation or verification of the persistence fixture",
);
if (options["--retain-probe"] || options["--verify-probe"]) {
  await persistenceProbe(Boolean(options["--retain-probe"]));
  process.exit(0);
}
if (options["--bootstrap-only"]) process.exit(0);

const run = {
  tag: randomUUID(),
  status: "running",
  jobId: randomUUID(),
  eventId: null,
  documentClientIds: [],
  documentIds: [],
  invitedEmail: null,
  invitedUserId: null,
  invitationKey: null,
  mailIds: [],
};
state.lastRun = run;
save();
const cleanupFailures = [];
let failure;
/** Reads the test actor's current session token for actual authenticated gateway requests. */
async function headers(actor) {
  const { session } = await checked(
    actor.client.auth.getSession(),
    "Read current test session",
  );
  return {
    Origin: target,
    apikey: publicApiKey,
    Authorization: `Bearer ${session.access_token}`,
  };
}
/** Sends real fixture bytes through the authenticated file endpoint; scanning and release remain server responsibilities. */
async function upload(actor, bytes, name) {
  const clientId = randomUUID();
  run.documentClientIds.push(clientId);
  save();
  const form = new FormData();
  form.set("file", new File([bytes], name, { type: "text/plain" }));
  form.set("scope", "personal");
  form.set("kind", "material");
  form.set("client_id", clientId);
  const response = await fetch(api + "/functions/v1/files", {
    method: "POST",
    headers: await headers(actor),
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json();
  const id = body.document?.id ?? body.document_id;
  if (id) {
    assert.match(id, /^[0-9a-f-]{36}$/);
    run.documentIds.push(id);
    save();
  }
  return { status: response.status, body };
}
/** Requests the authorised bytes for this identity and exact document version through the gateway. */
async function download(actor, id) {
  return fetch(api + "/functions/v1/files", {
    method: "POST",
    headers: { ...(await headers(actor)), "Content-Type": "application/json" },
    body: JSON.stringify(hostedDownloadRequest(id)),
    signal: AbortSignal.timeout(60000),
  });
}
/** Creates or checks the explicitly retained fictional persistence probe across service restarts. */
async function persistenceProbe(createMissing) {
  const path = join(directory, "persistence-probe.json");
  let probe = existsSync(path) ? JSON.parse(privateRead(path)) : null;
  if (!probe) {
    assert(
      createMissing,
      "Persistence fixture metadata is missing; refusing to invent restore evidence",
    );
    const bytes = new TextEncoder().encode(
      `Fictional Luminovia installation check. No real personal data. Marker ${randomUUID()}.\n`,
    );
    probe = {
      version: 1,
      target,
      ownerId: state.accounts.lecturer.id,
      ownerEmail: state.accounts.lecturer.email,
      clientId: randomUUID(),
      documentId: null,
      documentVersionId: null,
      objectPath: null,
      bucket: "portal-clean",
      filename: "Installationspruefung.txt",
      expectedBase64: Buffer.from(bytes).toString("base64"),
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      status: "reserved",
    };
    privateWrite(path, JSON.stringify(probe, null, 2) + "\n");
  }
  assert(
    probe.version === 1 &&
      probe.target === target &&
      probe.ownerId === state.accounts.lecturer.id &&
      probe.ownerEmail === state.accounts.lecturer.email &&
      probe.filename === "Installationspruefung.txt",
    "Persistence fixture belongs to another owner/target",
  );
  const expected = Buffer.from(probe.expectedBase64, "base64");
  assert(
    expected.length > 0 &&
      expected.length < 1024 &&
      createHash("sha256").update(expected).digest("hex") === probe.contentHash,
    "Persistence expected bytes/hash are invalid",
  );
  const actors = [];
  try {
    const lecturer = await signIn(state.accounts.lecturer);
    actors.push(lecturer.client);
    if (!probe.documentId) {
      assert(
        createMissing,
        "A prior probe upload must be reconciled before restart acceptance",
      );
      const form = new FormData();
      form.set(
        "file",
        new File([expected], probe.filename, { type: "text/plain" }),
      );
      form.set("scope", "personal");
      form.set("kind", "material");
      form.set("client_id", probe.clientId);
      const response = await fetch(api + "/functions/v1/files", {
        method: "POST",
        headers: await headers(lecturer),
        body: form,
        signal: AbortSignal.timeout(60000),
      });
      const result = await response.json();
      assert.equal(
        response.status,
        200,
        `Persistence clean upload returned ${result.error ?? "unexpected status"}`,
      );
      assert.equal(result.document.status, "clean");
      assert.equal(result.document.owner_id, probe.ownerId);
      probe.documentId = result.document.id;
      probe.documentVersionId = result.document.current_version_id;
      const version = await checked(
        service
          .from("document_versions")
          .select("object_path,sha256")
          .eq("document_id", probe.documentId)
          .eq("id", probe.documentVersionId)
          .single(),
        "Read retained probe immutable version",
      );
      assert.equal(version.sha256, probe.contentHash);
      probe.objectPath = version.object_path;
      probe.status = "clean";
      probe.createdAt = new Date().toISOString();
      privateWrite(path, JSON.stringify(probe, null, 2) + "\n");
    }
    const response = await download(lecturer, probe.documentId);
    assert.equal(
      response.status,
      200,
      "Existing authorized persistence download must succeed",
    );
    const actual = Buffer.from(await response.arrayBuffer());
    assert(
      actual.equals(expected) &&
        createHash("sha256").update(actual).digest("hex") === probe.contentHash,
      "Persisted actual bytes differ from the original fixture",
    );
    const admin = await signIn(state.accounts.admin);
    actors.push(admin.client);
    assert.deepEqual(
      await checked(
        admin.client.from("documents").select("id").eq("id", probe.documentId),
        "Read private probe boundary after persistence",
      ),
      [],
    );
    assert.equal(
      (await download(admin, probe.documentId)).status,
      403,
      "Development administrator must not bypass a lecturer's private file",
    );
    probe.lastVerifiedAt = new Date().toISOString();
    privateWrite(path, JSON.stringify(probe, null, 2) + "\n");
    console.log(
      "PASS retained harmless private persistence file: existing password sign-in, exact authorized bytes and administrator denial. Metadata/hash/object path saved privately (0600); this explicit development fixture remains for restart/backup/restore checks.",
    );
  } finally {
    for (const client of actors)
      await checked(
        client.auth.signOut({ scope: "local" }),
        "Close only the persistence probe's new Auth session",
      );
  }
}
/** Checks actual WebSocket delivery and subsequent access revocation on the approved development instance. */
async function verifyRealtime() {
  const tag = randomUUID();
  const title = `Fictional hosted Realtime ${tag}`;
  const actors = [];
  const cleanupErrors = [];
  let owner;
  let failure;
  let room;
  /** Paces bounded observational polling; the caller owns the overall timeout. */
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Bounds the wait for an observable event; a timeout remains a test failure. */
  const eventually = async (predicate, label) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(50);
    }
    throw new Error(label);
  };
  /** Connects a real Realtime subscription for this identity and waits until it is ready. */
  const subscribe = async (actor, events, name) => {
    const { session } = await checked(
      actor.client.auth.getSession(),
      "Read existing realtime test session",
    );
    await actor.client.realtime.setAuth(session.access_token);
    const endpoint = new URL(actor.client.realtime.endPoint);
    assert(
      endpoint.protocol === "wss:" &&
        endpoint.hostname === "cms.luminovia.org" &&
        endpoint.pathname.startsWith("/backend/realtime/v1"),
      "Actual Realtime must use the canonical WSS /backend endpoint",
    );
    const channel = actor.client
      .channel(`hosted-${name}-${tag}`, {
        config: { postgres_changes_options: { wait: true, timeout: 15000 } },
      })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${room}`,
        },
        (payload) => events.push(payload.new),
      );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Hosted WSS ${name} subscription timed out`)),
        30000,
      );
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          reject(new Error(`Hosted WSS ${name} subscription ${status}`));
        }
      });
    });
  };
  try {
    owner = await signIn(state.accounts.lecturer);
    actors.push(owner);
    const peer = await signIn(state.accounts.peer);
    actors.push(peer);
    const outsider = await signIn(state.accounts.admin);
    actors.push(outsider);
    room = await checked(
      owner.client.rpc("create_chat_group", {
        p_title: title,
        p_member_ids: [peer.id],
      }),
      "Create only the UUID-scoped fictional realtime group",
    );
    const ownerEvents = [],
      peerEvents = [],
      outsiderEvents = [];
    await subscribe(owner, ownerEvents, "owner");
    await subscribe(peer, peerEvents, "member");
    await subscribe(outsider, outsiderEvents, "nonmember-admin");
    const visible = await checked(
      owner.client.rpc("send_message", {
        p_room_id: room,
        p_body: "Fictional hosted live delivery before revocation.",
        p_client_id: randomUUID(),
      }),
      "Commit actual persisted message before removal",
    );
    await eventually(
      () =>
        ownerEvents.some((message) => message.id === visible) &&
        peerEvents.some((message) => message.id === visible),
      "Both authorized WSS subscriptions must deliver the actual committed message",
    );
    assert.equal(
      outsiderEvents.length,
      0,
      "An administrator outside the group receives no private persisted events",
    );
    await checked(
      owner.client.rpc("manage_chat_member", {
        p_room_id: room,
        p_user_id: peer.id,
        p_remove: true,
      }),
      "Revoke only this test group's member",
    );
    const hidden = await checked(
      owner.client.rpc("send_message", {
        p_room_id: room,
        p_body: "Fictional hosted message after member revocation.",
        p_client_id: randomUUID(),
      }),
      "Commit actual message after membership revocation",
    );
    await eventually(
      () => ownerEvents.some((message) => message.id === hidden),
      "Owner WSS delivery must remain healthy after member revocation",
    );
    await wait(1500);
    assert(
      !peerEvents.some((message) => message.id === hidden),
      "An already-subscribed removed member must not receive later persisted messages",
    );
    assert.equal(outsiderEvents.length, 0);
    assert(
      (await peer.client.rpc("chat_messages", { p_room_id: room })).error,
      "Revoked member cannot read chat history through the RPC",
    );
    assert(
      (
        await peer.client.rpc("send_message", {
          p_room_id: room,
          p_body: "Revoked fictional forged message",
          p_client_id: randomUUID(),
        })
      ).error,
      "Revoked member cannot send through direct RPC",
    );
    assert.deepEqual(
      await checked(
        peer.client.from("messages").select("id").eq("room_id", room),
        "Check revoked member's direct REST boundary",
      ),
      [],
    );
    console.log(
      "PASS actual canonical WSS Realtime: authorized owner/member receive committed message; nonmember admin receives none; owner remains live after revocation while already-subscribed removed member receives no later message and loses REST/RPC reads/writes.",
    );
  } catch (error) {
    failure = error;
  } finally {
    /** Removes resources created by this run; cleanup must not hide a business assertion failure. */
    const cleanup = async (callback) => {
      try {
        await callback();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    for (const actor of actors)
      await cleanup(async () => {
        await actor.client.removeAllChannels();
      });
    if (owner)
      await cleanup(async () => {
        // Find by both random title and owner if the creation response was lost.
        const rooms = await checked(
          service
            .from("chat_rooms")
            .select("id,owner_id,title")
            .eq("owner_id", owner.id)
            .eq("title", title),
          "Find exact owned realtime fixture rooms",
        );
        assert(
          rooms.length <= 1 &&
            rooms.every(
              (value) => value.owner_id === owner.id && value.title === title,
            ),
          "Realtime cleanup refuses unrelated rooms",
        );
        if (rooms.length) {
          const ids = rooms.map((value) => value.id);
          const messages = await checked(
            service.from("messages").select("id").in("room_id", ids),
            "Find only the owned realtime messages",
          );
          if (messages.length) {
            const messageIds = messages.map((message) => message.id);
            await checked(
              service
                .from("notifications")
                .delete()
                .in("resource_id", messageIds),
              "Remove owned realtime notifications",
            );
            await checked(
              service
                .from("message_reactions")
                .delete()
                .in("message_id", messageIds),
              "Remove owned realtime reactions",
            );
            await checked(
              service
                .from("chat_message_revisions")
                .delete()
                .in("message_id", messageIds),
              "Remove owned realtime message revisions",
            );
            await checked(
              service.from("messages").delete().in("id", messageIds),
              "Remove owned realtime messages",
            );
          }
          await checked(
            service.from("chat_members").delete().in("room_id", ids),
            "Remove only test group memberships",
          );
          await checked(
            service.from("chat_rooms").delete().in("id", ids),
            "Remove only test groups",
          );
          await checked(
            service.from("audit_events").delete().in("resource_id", ids),
            "Remove only the test group audit records",
          );
        }
      });
    for (const actor of actors)
      await cleanup(async () => {
        await checked(
          actor.client.auth.signOut({ scope: "local" }),
          "Close only realtime test-created Auth sessions",
        );
      });
  }
  if (failure || cleanupErrors.length)
    throw new AggregateError(
      [failure, ...cleanupErrors].filter(Boolean),
      "Hosted Realtime check or scoped cleanup failed",
    );
  console.log(
    "Realtime test group/messages/notifications removed; sockets and new sessions closed. Existing profiles/passwords/private files unchanged; no files or private account ledgers written.",
  );
}
/** Reads only the explicitly configured private Mailpit tunnel, not a real recipient mailbox. */
async function mailboxMessages() {
  const response = await fetch(new URL("/api/v1/messages?limit=100", mailpit), {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(
    response.status,
    200,
    "Private Mailpit inventory must be available",
  );
  const inbox = await response.json();
  assert(Array.isArray(inbox.messages));
  return inbox.messages.filter((message) =>
    message.To.some((recipient) => recipient.Address === run.invitedEmail),
  );
}
/** Waits for a new captured message owned by this fixture, ignoring previously seen IDs. */
async function capturedMessage(excludedIds = []) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const messages = (await mailboxMessages()).filter(
      (message) => !excludedIds.includes(message.ID),
    );
    if (messages.length) {
      assert.equal(
        messages.length,
        1,
        "Exactly one new fictional-recipient message must be captured",
      );
      const id = messages[0].ID;
      assert.match(id, /^[A-Za-z0-9-]+$/);
      run.mailIds.push(id);
      save();
      const response = await fetch(new URL(`/api/v1/message/${id}`, mailpit), {
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.status, 200);
      return response.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    "Expected fictional Auth email was not captured in private Mailpit",
  );
}
/** Extracts the checked Auth link from the captured test message. */
function mailLink(message) {
  const href = /href="([^"]+)"/
    .exec(message.HTML)?.[1]
    ?.replaceAll("&amp;", "&");
  assert(href, "Actual custom Auth template must contain an action link");
  const link = new URL(href);
  assert.equal(
    link.origin,
    target,
    "Captured Auth link must use the canonical development origin",
  );
  return link;
}
try {
  await check(
    "public Auth JWKS exposes verification keys without symmetric/private signing material",
    async () => {
      const response = await fetch(api + "/auth/v1/.well-known/jwks.json", {
        headers: { apikey: publicApiKey },
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(response.status, 200);
      const jwks = await response.json();
      assert(
        Array.isArray(jwks.keys) && jwks.keys.length > 0,
        "Public signing verification keys must be available",
      );
      for (const key of jwks.keys) {
        assert(
          ["EC", "RSA", "OKP"].includes(key.kty),
          "A symmetric JWK must never be public",
        );
        for (const field of ["k", "d", "p", "q", "dp", "dq", "qi"]) {
          assert(
            !(field in key),
            "Private signing key material must never be public",
          );
        }
      }
      const adminRoute = await fetch(api + "/auth/v1/admin/users", {
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(
        adminRoute.status,
        404,
        "Auth administration must stay outside the public Caddy routes",
      );
      await adminRoute.body?.cancel();
    },
  );
  const admin = await signIn(state.accounts.admin);
  const lecturer = await signIn(state.accounts.lecturer);
  const peer = await signIn(state.accounts.peer);
  await check(
    "actual public hosted password-only management authorization",
    async () => {
      const profiles = await checked(
        lecturer.client
          .from("profiles")
          .select("id,active")
          .eq("id", lecturer.id)
          .single(),
        "Read authenticated own profile",
      );
      assert.equal(profiles.active, true);
      const permissions = await checked(
        admin.client.rpc("get_my_permissions"),
        "Read current capabilities",
      );
      assert(permissions.includes("users.manage"));
    },
  );
  await check(
    "password-only administrator retains database-authorized management capabilities",
    async () => {
      await assertPasswordOnly(admin.client);
      const permissions = await checked(
        admin.client.rpc("get_my_permissions"),
        "Read current database capabilities",
      );
      assert(permissions.includes("users.manage"));
    },
  );
  if (mailpit)
    await check(
      "actual captured invitation/password setup and recovery preserve the canonical /backend URLs and PKCE",
      async () => {
        run.invitedEmail = `hosted-invite-${run.tag}@example.invalid`;
        run.invitationKey = randomUUID();
        save();
        const body = {
          email: run.invitedEmail,
          display_name: "Fiktive eingeladene Entwicklungslehrkraft",
          idempotency_key: run.invitationKey,
        };
        /** Checks a fictional invitation through the actual handler and the development instance's local mail capture. */
        const invite = async () => {
          const response = await fetch(api + "/functions/v1/invite-lecturer", {
            method: "POST",
            headers: {
              ...(await headers(admin)),
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000),
          });
          const value = await response.json();
          assert.equal(
            response.status,
            200,
            `Captured development invitation returned ${value.error ?? value.status ?? "unexpected response"}`,
          );
          return value;
        };
        const result = await invite();
        assert.equal(result.status, "sent");
        const retry = await invite();
        assert.equal(retry.status, "already_sent");
        assert.equal(retry.invitation_id, result.invitation_id);
        const invitationMail = await capturedMessage();
        const invitationLink = mailLink(invitationMail);
        assert.equal(invitationLink.pathname, "/auth/callback");
        assert.equal(invitationLink.searchParams.get("type"), "invite");
        assert(invitationLink.searchParams.get("token_hash"));
        const memory = new Map();
        const client = createClient(api, publicApiKey, {
          auth: {
            flowType: "pkce",
            persistSession: true,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storage: {
              getItem: (key) => memory.get(key) ?? null,
              setItem: (key, value) => {
                memory.set(key, value);
              },
              removeItem: (key) => {
                memory.delete(key);
              },
            },
          },
        });
        clients.push(client);
        const accepted = await checked(
          client.auth.verifyOtp({
            token_hash: invitationLink.searchParams.get("token_hash"),
            type: "invite",
          }),
          "Consume actual captured invitation token",
        );
        run.invitedUserId = accepted.user.id;
        save();
        assert.deepEqual(
          (
            await checked(
              service
                .from("user_roles")
                .select("role")
                .eq("user_id", run.invitedUserId),
              "Read fixed invited lecturer role",
            )
          ).map((row) => row.role),
          ["lecturer"],
        );
        const firstPassword = `Invite!${randomBytes(24).toString("base64url")}Aa9`;
        await checked(
          client.auth.updateUser({ password: firstPassword }),
          "Set only fictional invited account password",
        );
        await checked(
          client.auth.signOut({ scope: "local" }),
          "Sign out captured invitation session",
        );
        await checked(
          client.auth.signInWithPassword({
            email: run.invitedEmail,
            password: firstPassword,
          }),
          "Sign in with actual invited account password",
        );
        await checked(
          client.auth.signOut({ scope: "local" }),
          "Close fictional invited password session",
        );
        const beforeRecovery = (await mailboxMessages()).map(
          (message) => message.ID,
        );
        assert.equal(
          beforeRecovery.length,
          1,
          "Invitation retry must not duplicate captured delivery",
        );
        await checked(
          client.auth.resetPasswordForEmail(run.invitedEmail, {
            redirectTo: target + "/auth/password",
          }),
          "Request captured fictional password recovery using PKCE",
        );
        const recoveryMail = await capturedMessage(beforeRecovery);
        assert(
          recoveryMail.HTML.includes("Passwort zurücksetzen") &&
            recoveryMail.HTML.includes("Reset your password"),
          "Recovery template must include both authored languages",
        );
        const confirmation = mailLink(recoveryMail);
        assert.equal(confirmation.pathname, "/backend/auth/v1/verify");
        assert.equal(confirmation.searchParams.get("type"), "recovery");
        assert.equal(
          confirmation.searchParams.get("redirect_to"),
          target + "/auth/password",
        );
        const redirect = await fetch(confirmation, {
          redirect: "manual",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(30000),
        });
        assert(
          [302, 303].includes(redirect.status),
          "Captured recovery must issue an actual Auth redirect",
        );
        const destination = new URL(redirect.headers.get("location"));
        assert.equal(destination.origin, target);
        assert.equal(destination.pathname, "/auth/password");
        const code = destination.searchParams.get("code");
        assert(
          code && !destination.searchParams.has("error"),
          "Recovery redirect must contain a valid PKCE code",
        );
        await checked(
          client.auth.exchangeCodeForSession(code),
          "Consume hosted recovery with its original PKCE verifier",
        );
        const nextPassword = `Recovery!${randomBytes(24).toString("base64url")}Aa9`;
        await checked(
          client.auth.updateUser({ password: nextPassword }),
          "Set recovered fictional account password",
        );
        await checked(
          client.auth.signOut({ scope: "local" }),
          "Close recovered fictional session",
        );
        await checked(
          client.auth.signInWithPassword({
            email: run.invitedEmail,
            password: nextPassword,
          }),
          "Sign in with recovered fictional account password",
        );
      },
    );
  await check(
    "private calendar, role forgery and anonymous RLS stay enforced by the hosted API",
    async () => {
      const event = await checked(
        lecturer.client
          .from("personal_events")
          .insert({
            user_id: lecturer.id,
            title: `Fictional hosted private appointment ${run.tag}`,
            starts_at: "2048-01-01T08:00:00Z",
            ends_at: "2048-01-01T09:00:00Z",
            time_zone: "Europe/Berlin",
          })
          .select("id")
          .single(),
        "Create owned private appointment",
      );
      run.eventId = event.id;
      save();
      for (const actor of [peer, admin])
        assert.deepEqual(
          await checked(
            actor.client
              .from("personal_events")
              .select("id")
              .eq("id", run.eventId),
            "Check private-event boundary",
          ),
          [],
        );
      assert(
        (
          await lecturer.client
            .from("user_roles")
            .insert({ user_id: lecturer.id, role: "admin" })
        ).error,
        "Browser role escalation must be denied",
      );
      assert(
        (
          await lecturer.client.from("personal_events").insert({
            user_id: peer.id,
            title: "Forged fictional owner",
            starts_at: "2048-01-02T08:00:00Z",
            ends_at: "2048-01-02T09:00:00Z",
          })
        ).error,
        "Forged event owner must be denied",
      );
      const anon = await publicClient().from("jobs").select("id");
      assert(anon.error || anon.data.length === 0);
    },
  );
  await check(
    "actual hosted Edge origin/preflight/authentication boundaries",
    async () => {
      const preflight = await fetch(api + "/functions/v1/files", {
        method: "OPTIONS",
        headers: {
          Origin: target,
          apikey: publicApiKey,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,apikey,content-type",
        },
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(preflight.status, 204);
      assert.equal(
        preflight.headers.get("access-control-allow-origin"),
        target,
      );
      const rejected = await fetch(api + "/functions/v1/files", {
        method: "POST",
        headers: {
          Origin: "https://untrusted.example.invalid",
          apikey: publicApiKey,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(rejected.status, 403);
      assert.equal(rejected.headers.get("access-control-allow-origin"), null);
      const unauthenticated = await fetch(api + "/functions/v1/files", {
        method: "POST",
        headers: {
          Origin: target,
          apikey: publicApiKey,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(30000),
      });
      assert([401, 403].includes(unauthenticated.status));
      assert.match(
        unauthenticated.headers.get("cache-control") ?? "",
        /no-store/,
      );
    },
  );
  await check(
    "small real Edge/Storage/ClamAV clean upload, private download and malware quarantine",
    async () => {
      const bytes = new TextEncoder().encode(
        `Fictional hosted secure document ${run.tag}.`,
      );
      const clean = await upload(lecturer, bytes, `fictional-${run.tag}.txt`);
      assert.equal(
        clean.status,
        200,
        `Clean upload returned ${clean.body.error ?? "unexpected status"}`,
      );
      assert.equal(clean.body.document.status, "clean");
      const own = await download(lecturer, clean.body.document.id);
      assert.equal(own.status, 200);
      assert.deepEqual(new Uint8Array(await own.arrayBuffer()), bytes);
      for (const actor of [peer, admin]) {
        assert.deepEqual(
          await checked(
            actor.client
              .from("documents")
              .select("id")
              .eq("id", clean.body.document.id),
            "Private document metadata",
          ),
          [],
        );
        assert.equal(
          (await download(actor, clean.body.document.id)).status,
          403,
        );
      }
      const version = await checked(
        service
          .from("document_versions")
          .select("object_path,scanner_version")
          .eq("document_id", clean.body.document.id)
          .single(),
        "Read scoped scanner/version assertion",
      );
      assert.match(version.scanner_version, /^ClamAV /);
      assert(
        (
          await lecturer.client.storage
            .from("portal-clean")
            .download(version.object_path)
        ).error,
        "Direct Storage download cannot bypass live authorization",
      );
      assert(
        (
          await lecturer.client.storage
            .from("portal-clean")
            .createSignedUrl(version.object_path, 60)
        ).error,
        "Owner cannot mint a revocation-bypassing signed URL",
      );
      const eicar = new TextEncoder().encode(
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
      );
      const blocked = await upload(
        lecturer,
        eicar,
        `antivirus-test-${run.tag}.txt`,
      );
      assert.equal(
        blocked.status,
        422,
        `Malware test returned ${blocked.body.error ?? "unexpected status"}`,
      );
      assert.equal(blocked.body.error, "scan_rejected");
      assert.equal(
        (await download(lecturer, blocked.body.document_id)).status,
        409,
      );
    },
  );
  await check(
    `${claimAttempts} real online claim attempts, one committed winner, all five sessions and idempotent retry`,
    async () => {
      await checked(
        service.from("jobs").insert({
          id: run.jobId,
          title: `Fictional hosted claim check ${run.tag}`,
          description: "Disposable development-only assignment",
          customer_name: "Fictional hosted QA customer",
          delivery_type: "online",
          time_zone: "Europe/Berlin",
          status: "published",
          amount: 375,
          currency: "EUR",
          rate_unit: "per_day",
          total_amount: 1875,
          terms: "Immutable fictional hosted QA terms.",
          requires_contract: false,
        }),
        "Create scoped hosted claim fixture",
      );
      await checked(
        service.from("job_sessions").insert(
          Array.from({ length: 5 }, (_, index) => ({
            job_id: run.jobId,
            starts_at: new Date(Date.UTC(2049, 0, 1 + index, 8)).toISOString(),
            ends_at: new Date(Date.UTC(2049, 0, 1 + index, 14)).toISOString(),
          })),
        ),
        "Create all five scoped sessions",
      );
      const attempts = Array.from({ length: claimAttempts }, (_, index) => ({
        actor: index % 2 ? peer : lecturer,
        key: randomUUID(),
      }));
      const results = await Promise.all(
        attempts.map(({ actor, key }) =>
          checked(
            actor.client.rpc("claim_job", {
              p_job_id: run.jobId,
              p_idempotency_key: key,
              p_terms_version: 1,
            }),
            "Hosted atomic claim",
          ),
        ),
      );
      assert.equal(
        results.filter((result) => result.status === "confirmed").length,
        1,
      );
      assert.equal(
        results.filter((result) => result.status === "filled").length,
        claimAttempts - 1,
      );
      const winner = results.findIndex(
        (result) => result.status === "confirmed",
      );
      assert.deepEqual(
        await checked(
          attempts[winner].actor.client.rpc("claim_job", {
            p_job_id: run.jobId,
            p_idempotency_key: attempts[winner].key,
            p_terms_version: 1,
          }),
          "Idempotent hosted claim retry",
        ),
        results[winner],
      );
      const claim = await checked(
        service
          .from("job_claims")
          .select("id,amount,total_amount,terms")
          .eq("job_id", run.jobId)
          .single(),
        "Read actual committed claim",
      );
      assert.equal(
        (
          await checked(
            service
              .from("assignment_sessions")
              .select("id")
              .eq("claim_id", claim.id),
            "Read actual allocations",
          )
        ).length,
        5,
      );
      assert.equal(
        (
          await checked(
            service
              .from("notifications")
              .select("id")
              .eq("resource_id", claim.id),
            "Read committed notification",
          )
        ).length,
        1,
      );
      await checked(
        service
          .from("jobs")
          .update({
            amount: 999,
            total_amount: 4995,
            terms: "Edited future offer",
          })
          .eq("id", run.jobId),
        "Edit only scoped future offer",
      );
      const snapshot = await checked(
        attempts[winner].actor.client
          .from("job_claims")
          .select("amount,total_amount,terms")
          .eq("id", claim.id)
          .single(),
        "Read immutable accepted snapshot",
      );
      assert.equal(Number(snapshot.amount), 375);
      assert.equal(Number(snapshot.total_amount), 1875);
      assert.equal(snapshot.terms, "Immutable fictional hosted QA terms.");
    },
  );
} catch (error) {
  failure = error;
} finally {
  /** Removes resources created by this run; cleanup must not hide a business assertion failure. */
  const cleanup = async (callback) => {
    try {
      await callback();
    } catch (error) {
      cleanupFailures.push(error);
    }
  };
  await cleanup(async () => {
    // UUID client keys allow exact cleanup even if an upload response was lost.
    if (run.documentClientIds.length) {
      const versions = await checked(
        service
          .from("document_versions")
          .select("document_id,object_path")
          .in("client_id", run.documentClientIds),
        "Find exact owned upload versions",
      );
      const ids = [
        ...new Set([
          ...run.documentIds,
          ...versions.map((version) => version.document_id),
        ]),
      ];
      const paths = versions.map((version) => version.object_path);
      if (paths.length) {
        await checked(
          service.storage.from("portal-clean").remove(paths),
          "Remove only test clean object bytes",
        );
        await checked(
          service.storage.from("portal-quarantine").remove(paths),
          "Remove only test quarantine object bytes",
        );
      }
      if (ids.length) {
        await checked(
          service
            .from("documents")
            .update({ current_version_id: null })
            .in("id", ids),
          "Release owned document pointers",
        );
        await checked(
          service.from("document_versions").delete().in("document_id", ids),
          "Remove owned version metadata",
        );
        await checked(
          service.from("documents").delete().in("id", ids),
          "Remove owned document metadata",
        );
      }
    }
  });
  await cleanup(async () => {
    const rooms = await checked(
      service.from("chat_rooms").select("id").eq("job_id", run.jobId),
      "Find only test claim rooms",
    );
    if (rooms.length)
      await checked(
        service
          .from("chat_members")
          .delete()
          .in(
            "room_id",
            rooms.map((room) => room.id),
          ),
        "Remove owned claim memberships",
      );
    await checked(
      service.from("chat_rooms").delete().eq("job_id", run.jobId),
      "Remove owned claim rooms",
    );
    const claims = await checked(
      service.from("job_claims").select("id").eq("job_id", run.jobId),
      "Find only test claims",
    );
    if (claims.length) {
      const ids = claims.map((claim) => claim.id);
      await checked(
        service.from("notifications").delete().in("resource_id", ids),
        "Remove own test notifications",
      );
      await checked(
        service.from("claim_events").delete().in("claim_id", ids),
        "Remove own test claim events",
      );
      await checked(
        service.from("assignment_sessions").delete().in("claim_id", ids),
        "Remove own test allocations",
      );
      await checked(
        service.from("job_claims").delete().in("id", ids),
        "Remove own test claims",
      );
    }
    await checked(
      service.from("job_sessions").delete().eq("job_id", run.jobId),
      "Remove owned test sessions",
    );
    await checked(
      service.from("jobs").delete().eq("id", run.jobId),
      "Remove owned test offer",
    );
  });
  await cleanup(async () => {
    let request = service
      .from("personal_events")
      .delete()
      .eq("user_id", state.accounts.lecturer.id);
    request = run.eventId
      ? request.eq("id", run.eventId)
      : request.eq("title", `Fictional hosted private appointment ${run.tag}`);
    await checked(request, "Remove owned test private event");
  });
  for (const client of clients)
    await cleanup(async () => {
      await checked(
        client.auth.signOut({ scope: "local" }),
        "Close only the test-created Auth session",
      );
    });
  if (run.invitedEmail)
    await cleanup(async () => {
      await checked(
        service
          .from("invitation_requests")
          .delete()
          .eq("actor_id", state.accounts.admin.id)
          .eq("email", run.invitedEmail)
          .eq("idempotency_key", run.invitationKey),
        "Remove only owned development invitation reservation",
      );
      const users = (
        await checked(
          service.auth.admin.listUsers({ perPage: 1000 }),
          "Reconcile only the owned invited development account",
        )
      ).users;
      const invited = users.find((user) => user.email === run.invitedEmail);
      if (invited)
        await checked(
          service.auth.admin.deleteUser(invited.id),
          "Remove owned fictional invited account",
        );
    });
  run.status = cleanupFailures.length ? "cleanup_failed" : "cleaned";
  run.checksPassed = passes;
  run.finishedAt = new Date().toISOString();
  save();
}
if (failure || cleanupFailures.length) {
  // No Auth objects, request headers, environments, URLs with tokens or credential
  // values are printed. The private run ledger identifies scoped recovery rows.
  const reasons = [failure, ...cleanupFailures]
    .filter(Boolean)
    .map((error) => error.message ?? "Check failed");
  console.error(
    "Hosted development checks did not complete: " + reasons.join("; "),
  );
  process.exitCode = 1;
} else {
  console.log(
    `${passes} hosted development checks passed; owned test rows/objects cleaned. Three fictional development accounts remain; credentials are private (0600).`,
  );
}
