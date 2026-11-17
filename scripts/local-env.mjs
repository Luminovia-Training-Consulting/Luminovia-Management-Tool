/**
 * Derives private local test configuration from actual CLI service status.
 * Public browser settings and server-side test keys stay separate; existing passwords are retained.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { localBootstrapPassword } from "./local-bootstrap.mjs";
import {
  privateDirectory,
  privateWrite,
  readEnvFile,
  projectConfig,
} from "./runtime-lib.mjs";

// This command reads only this checkout's LOCAL stack; no hosted target is accepted.
const raw = execFileSync(
  join(process.cwd(), "node_modules/.bin/supabase"),
  ["status", "-o", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const status = JSON.parse(raw.slice(raw.indexOf("{")));
const apiUrl = status.API_URL ?? status.api?.url;
const anonKey = status.ANON_KEY ?? status.api?.anon_key;
const publishableKey = status.PUBLISHABLE_KEY ?? anonKey;
const serviceKey = status.SERVICE_ROLE_KEY ?? status.api?.service_role_key;
const dbUrl = status.DB_URL ?? status.db?.url;
const config = projectConfig(process.cwd());
if (!apiUrl || !anonKey || !serviceKey || !dbUrl)
  throw new Error("Local Supabase status lacks required credentials.");
const allowed = new Set(["127.0.0.1", "localhost", "[::1]"]);
if (
  !allowed.has(new URL(apiUrl).hostname) ||
  !allowed.has(new URL(dbUrl).hostname) ||
  Number(new URL(apiUrl).port) !== config.api ||
  Number(new URL(dbUrl).port) !== config.database
)
  throw new Error(
    "Refusing environment generation for another or remote Supabase project.",
  );
privateDirectory();
const old = readEnvFile(".env.test.local");
if (old.SUPABASE_URL && old.SUPABASE_URL !== apiUrl)
  throw new Error(
    "Existing environment belongs to another local stack; resolve it explicitly before restarting.",
  );
const response = await fetch(
  `${apiUrl}/auth/v1/admin/users?page=1&per_page=1`,
  { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
);
if (!response.ok)
  throw new Error("Could not inspect local Auth initialization.");
const accounts = await response.json();
// Keep a user's existing password for populated local accounts; an empty Auth database gets the stable local default.
const password = localBootstrapPassword(
  old.E2E_PASSWORD,
  accounts.users?.length ?? 0,
);
privateWrite(
  ".env.local",
  `VITE_SUPABASE_URL=${apiUrl}\nVITE_SUPABASE_PUBLISHABLE_KEY=${publishableKey}\n`,
);
privateWrite(
  ".env.test.local",
  [
    `SUPABASE_URL=${apiUrl}`,
    `SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    `DATABASE_URL=${dbUrl}`,
    "E2E_LECTURER_EMAIL=lecturer01@example.invalid",
    "E2E_OTHER_EMAIL=lecturer02@example.invalid",
    "E2E_ADMIN_EMAIL=admin@example.invalid",
    `E2E_PASSWORD=${password ?? ""}`,
    `E2E_MAILPIT_URL=http://127.0.0.1:${config.mail}`,
    `PORTAL_APP_ORIGIN=${config.site}`,
  ].join("\n") + "\n",
);
privateWrite(
  ".local/ACCOUNTS.txt",
  `Local Luminovia test accounts – fictional and local only; do not reuse this password elsewhere.\n\nAdmin: admin@example.invalid\nPlatform lead (demo): carina@example.invalid\nClient demo: client@example.invalid\nLecturers: lecturer01@example.invalid through lecturer11@example.invalid\nParticipant: participant@example.invalid\n\n${password ? `Default local test password: ${password}\nExisting password changes remain intact across restarts. No MFA factors are enabled.\n` : "The previous password file is missing. Existing passwords were NOT changed. Use your known password or local Mailpit recovery.\n"}\nMailpit: http://127.0.0.1:${config.mail}\n`,
);
console.log(
  "Local configuration updated; existing passwords are preserved. Credentials: .local/ACCOUNTS.txt",
);
