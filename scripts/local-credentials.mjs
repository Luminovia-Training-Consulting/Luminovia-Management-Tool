/** Verify known fictional credentials with ordinary Auth on the owned local stack. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_TEST_DEFAULT_PASSWORD } from "./local-bootstrap.mjs";
import {
  assertLocalDocker,
  localUrl,
  privateWrite,
  processIsOurs,
  projectConfig,
  readEnvFile,
  readState,
  root,
  runtimeDir,
} from "./runtime-lib.mjs";
import { verifyLoopbackBindings } from "./runtime-network.mjs";

const accounts = [
  ["Admin", "admin"],
  ["Platform lead", "carina"],
  ["Company", "client"],
  ...Array.from({ length: 11 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return [`Lecturer ${number}`, `lecturer${number}`];
  }),
  ["Participant", "participant"],
];

const snapshotHeading = "Local test accounts verified at ";
const credentialsFile = join(runtimeDir, "ACCOUNTS.txt");

export async function localCredentials() {
  const state = readState();
  const config = projectConfig();
  if (
    !processIsOurs(state) ||
    state.phase !== "ready" ||
    state.projectId !== config.id
  ) {
    const snapshot = existsSync(credentialsFile)
      ? readFileSync(credentialsFile, "utf8")
      : "";
    if (snapshot.startsWith(snapshotHeading))
      return (
        "Portal stopped. Showing the last verified local credentials.\n" +
        snapshot
      );
    throw new Error(
      "Run ./portal start, then ./portal credentials to verify the local passwords.",
    );
  }

  const env = readEnvFile(join(root, ".env.test.local"));
  const url = localUrl(env.SUPABASE_URL, "Supabase URL");
  if (
    Number(url.port) !== config.api ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !env.SUPABASE_ANON_KEY
  )
    throw new Error("The local Auth configuration does not match this portal.");
  const dockerHost = await assertLocalDocker();
  delete process.env.DOCKER_CONTEXT;
  process.env.DOCKER_HOST = dockerHost;
  await verifyLoopbackBindings(config.id);

  const adminFile = join(runtimeDir, "ADMIN-DEMO.txt");
  const recoveredAdmin = existsSync(adminFile)
    ? /^Passwort: ([^\r\n]+)$/m.exec(readFileSync(adminFile, "utf8"))?.[1]
    : undefined;
  const defaultPassword = env.E2E_PASSWORD || LOCAL_TEST_DEFAULT_PASSWORD;
  const headers = {
    apikey: env.SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
  const rows = [];
  for (const [label, name] of accounts) {
    const email = `${name}@example.invalid`;
    const password =
      name === "admin" ? (recoveredAdmin ?? defaultPassword) : defaultPassword;
    const response = await fetch(
      new URL("/auth/v1/token?grant_type=password", url),
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email, password }),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    const login = await response.json();
    if (!response.ok) {
      if (
        !["invalid_credentials", "email_not_confirmed", "user_banned"].includes(
          login.error_code,
        )
      )
        throw new Error(
          `Local Auth could not verify credentials (HTTP ${response.status}).`,
        );
      rows.push(
        `${label} | ${email} | Password: unavailable (use local Mailpit recovery)`,
      );
      continue;
    }
    if (login.user?.email !== email || !login.access_token)
      throw new Error("Local Auth returned an unexpected identity.");
    const alias = await fetch(new URL("/rest/v1/rpc/account_username", url), {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${login.access_token}` },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    const username = alias.ok ? (await alias.json())?.username : undefined;
    rows.push(
      `${label} | ${email}${username ? ` | Username: ${username}` : ""} | Password: ${password}`,
    );
  }

  const output = `${snapshotHeading}${new Date().toISOString()} (fictional, local only).\n\n${rows.join("\n")}\n\nMailpit: http://127.0.0.1:${config.mail}\n`;
  privateWrite(credentialsFile, output);
  return output;
}
