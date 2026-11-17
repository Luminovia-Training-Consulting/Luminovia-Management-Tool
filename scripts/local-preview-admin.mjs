/** A deliberately weak, fictional account is allowed only in the owned loopback GitHub preview. */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
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

/** Create once; an existing account, password and MFA are never changed. */
export async function createPreviewAdmin({ service, setPassword }) {
  const listed = await service.auth.admin.listUsers({ perPage: 1000 });
  if (listed.error) throw listed.error;
  if (listed.data.users.some((user) => user.email === email)) return false;
  const created = await service.auth.admin.createUser({
    email,
    password: `Local!${randomBytes(20).toString("hex")}Aa9`,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user?.id;
  if (!/^[0-9a-f-]{36}$/i.test(id ?? ""))
    throw new Error("Invalid created preview account identity.");
  try {
    for (const request of [
      () =>
        service.from("profiles").upsert({
          id,
          display_name: "Lokale Testverwaltung",
          locale: "de",
          time_zone: "Europe/Berlin",
          active: true,
        }),
      () =>
        service
          .from("user_roles")
          .upsert(
            { user_id: id, role: "admin" },
            { onConflict: "user_id,role" },
          ),
    ]) {
      const result = await request();
      if (result.error) throw result.error;
    }
    await setPassword(id);
    return true;
  } catch (error) {
    // The identity was created by this attempt; never touch a pre-existing account.
    const removed = await service.auth.admin.deleteUser(id);
    if (removed.error)
      throw new AggregateError(
        [error, removed.error],
        "Preview account setup and cleanup failed.",
        { cause: error },
      );
    throw error;
  }
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
    setPassword: async (id) => {
      // Only this just-created fictional identity is modified; all other passwords and MFA stay untouched.
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
          input: `do $$ begin update auth.users set encrypted_password = extensions.crypt('admin', extensions.gen_salt('bf')) where id = '${id}'::uuid and email = '${email}'; if not found then raise exception 'preview account missing'; end if; end $$;`,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    },
  });
}
