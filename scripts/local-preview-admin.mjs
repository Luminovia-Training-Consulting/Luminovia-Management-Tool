/** A deliberately weak, fictional account is allowed only in the owned loopback GitHub preview. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { projectConfig, readEnvFile } from "./runtime-lib.mjs";

const email = "local-preview-admin@example.invalid";

/** Reject anything except the registered GitHub preview and its real Docker project. */
export function previewIdentity(cwd, config, owner, api, labels) {
  const source = realpathSync(cwd);
  const base = dirname(source);
  const local = dirname(base);
  const checkout = realpathSync(dirname(local));
  const expected = `luminovia-portal-github-${createHash("sha256").update(checkout).digest("hex").slice(0, 12)}`;
  const endpoint = new URL(api);
  if (
    basename(source) !== "source" ||
    basename(base) !== "github-preview" ||
    basename(local) !== ".local" ||
    owner.version !== 1 ||
    owner.checkout !== checkout ||
    owner.project !== expected ||
    owner.repository !==
      "https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool.git" ||
    config.id !== expected ||
    config.api !== 56321 ||
    config.database !== 56322 ||
    config.site !== "http://127.0.0.1:5373" ||
    endpoint.origin !== "http://127.0.0.1:56321" ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password ||
    labels["com.supabase.cli.project"] !== expected ||
    labels["com.supabase.cli.workdir"] !== source
  )
    throw new Error(
      "Refusing local preview admin outside its owned loopback project.",
    );
  return expected;
}

/** A 0600, no-follow marker is written completely before any Auth mutation. */
export function previewMarkerStore(path) {
  function read() {
    let fd;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = fstatSync(fd);
      if (
        !info.isFile() ||
        info.uid !== process.getuid() ||
        info.mode & 0o077 ||
        info.size > 512
      )
        throw new Error("Unsafe preview bootstrap marker.");
      const marker = JSON.parse(readFileSync(fd, "utf8"));
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          marker.id,
        ) ||
        !/^[0-9a-f]{64}$/.test(marker.token)
      )
        throw new Error("Invalid preview bootstrap marker.");
      return marker;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  function create(marker) {
    const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
    let fd;
    let created = false;
    try {
      fd = openSync(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
      writeFileSync(fd, JSON.stringify(marker) + "\n");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      // Link publishes a fully written marker without replacing another initializer's record.
      linkSync(temporary, path);
      const directory = openSync(
        dirname(path),
        constants.O_RDONLY | constants.O_DIRECTORY,
      );
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (created) unlinkSync(temporary);
    }
  }
  return { read, create };
}

/** Complete only an identity bound to this initializer's private random marker. */
export async function createPreviewAdmin({ service, markerStore, finalize }) {
  const listed = await service.auth.admin.listUsers({ perPage: 1000 });
  if (listed.error) throw listed.error;
  let marker = markerStore.read();
  let account = marker
    ? listed.data.users.find((user) => user.id === marker.id)
    : listed.data.users.find((user) => user.email === email);
  if (account && !marker) return false;
  if (
    marker &&
    !account &&
    listed.data.users.some((user) => user.email === email)
  )
    throw new Error(
      "Preview administrator exists without matching bootstrap ownership.",
    );
  if (!marker) {
    marker = { id: randomUUID(), token: randomBytes(32).toString("hex") };
    markerStore.create(marker);
  }
  if (!account) {
    const created = await service.auth.admin.createUser({
      id: marker.id,
      email,
      password: `Local!${randomBytes(20).toString("hex")}Aa9`,
      email_confirm: true,
      app_metadata: {
        luminovia_preview_bootstrap: { token: marker.token, state: "pending" },
      },
    });
    if (created.error) throw created.error;
    account = created.data.user;
  }
  const bootstrap = account?.app_metadata?.luminovia_preview_bootstrap;
  if (account?.id !== marker.id || bootstrap?.token !== marker.token)
    throw new Error(
      "Preview administrator exists without matching bootstrap ownership.",
    );
  if (bootstrap.state === "complete") return false;
  if (account.email !== email)
    throw new Error("Pending preview account email changed.");
  if (bootstrap.state !== "pending")
    throw new Error("Invalid preview bootstrap state.");
  await finalize(marker);
  return true;
}

/** The only SQL that may finish this one owned fictional account. */
export function previewAdminSql({ id, token }) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      id,
    ) ||
    !/^[0-9a-f]{64}$/.test(token)
  )
    throw new Error("Invalid preview bootstrap identity.");
  return `do $$
          declare metadata jsonb;
          begin
            select raw_app_meta_data into metadata from auth.users where id = '${id}'::uuid and email = '${email}' for update;
            if metadata #>> '{luminovia_preview_bootstrap,token}' is distinct from '${token}' then raise exception 'preview bootstrap ownership mismatch'; end if;
            if metadata #>> '{luminovia_preview_bootstrap,state}' = 'complete' then return; end if;
            if metadata #>> '{luminovia_preview_bootstrap,state}' is distinct from 'pending' then raise exception 'preview bootstrap state mismatch'; end if;
            insert into public.profiles (id, display_name, locale, time_zone, active) values ('${id}'::uuid, 'Lokale Testverwaltung', 'de', 'Europe/Berlin', true)
              on conflict (id) do update set display_name = excluded.display_name, locale = excluded.locale, time_zone = excluded.time_zone, active = excluded.active;
            insert into public.user_roles (user_id, role) values ('${id}'::uuid, 'admin') on conflict (user_id, role) do nothing;
            update auth.users set encrypted_password = extensions.crypt('admin', extensions.gen_salt('bf')),
              raw_app_meta_data = jsonb_set(metadata, '{luminovia_preview_bootstrap,state}', to_jsonb('complete'::text)) where id = '${id}'::uuid;
          end $$;`;
}

/** Only called by the preview supervisor after local bootstrap and binding verification. */
export async function ensurePreviewAdmin(cwd = process.cwd()) {
  const config = projectConfig(cwd);
  if (!/^luminovia-portal-github-[a-f0-9]{12}$/.test(config.id ?? ""))
    return false;
  const env = readEnvFile(join(cwd, ".env.test.local"));
  const owner = JSON.parse(readFileSync(join(cwd, "../owner.json"), "utf8"));
  const container = `supabase_db_${config.id}`;
  const inspected = JSON.parse(
    execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
  );
  const project = previewIdentity(
    cwd,
    config,
    owner,
    env.SUPABASE_URL,
    inspected[0]?.Config?.Labels ?? {},
  );
  if (container !== `supabase_db_${project}`)
    throw new Error("Mismatched local preview database.");
  const service = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return createPreviewAdmin({
    service,
    markerStore: previewMarkerStore(
      join(cwd, ".local/preview-admin-bootstrap.json"),
    ),
    finalize: async ({ id, token }) => {
      // One atomic transaction sets profile, role and the final password exactly once.
      execFileSync(
        "docker",
        [
          "exec",
          "-i",
          container,
          "psql",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-X",
          "-q",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        {
          input: previewAdminSql({ id, token }),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    },
  });
}
