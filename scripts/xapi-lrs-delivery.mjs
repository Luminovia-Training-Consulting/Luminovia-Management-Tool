/** Delivers an explicitly requested course archive to a configured xAPI 1.0.3 LRS. */
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { courseXapiArchiveSchema } from "../src/features/learning/xapi-schema.ts";

const retryable = new Set([408, 429, 500, 502, 503, 504]);
const maxBytes = 4 * 1024 * 1024;

/** Validate an operator-supplied xAPI service URL before sending credentials. */
export function xapiServiceUrl(value) {
  const target = new URL(value);
  if (
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    (target.protocol !== "https:" &&
      !(
        target.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(target.hostname)
      ))
  ) {
    throw new Error("The service URL must use HTTPS, or HTTP on loopback");
  }
  return target;
}

/** Deliver stable IDs sequentially. A retry sends the same body and never follows redirects. */
export async function deliverXapiArchive(archive, configuration) {
  const { statements, xapi_version } = courseXapiArchiveSchema.parse(archive);
  const target = xapiServiceUrl(configuration.endpoint);
  if (
    !configuration.username ||
    configuration.username.includes(":") ||
    !configuration.password
  ) {
    throw new Error(
      "LRS Basic authentication requires a username and password",
    );
  }
  target.pathname = target.pathname.replace(/\/*$/, "/") + "statements";
  const authorization =
    "Basic " +
    Buffer.from(`${configuration.username}:${configuration.password}`).toString(
      "base64",
    );
  let submitted = 0;
  let retries = 0;
  for (const statement of statements) {
    target.searchParams.set("statementId", statement.id);
    const body = JSON.stringify(statement);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response;
      try {
        response = await fetch(target, {
          method: "PUT",
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
            "X-Experience-API-Version": xapi_version,
          },
          body,
        });
      } catch {
        // A timeout or lost receipt may hide an accepted write. A repeated
        // PUT with the same statement ID and body is safe.
      }
      if (response?.body) await response.body.cancel().catch(() => {});
      if (response?.status === 204) {
        submitted += 1;
        break;
      }
      const status = response?.status ?? 0;
      if (attempt === 2 || (status !== 0 && !retryable.has(status))) {
        return {
          submitted,
          retries,
          pending: statements.length - submitted,
          failure: status || "transport",
        };
      }
      retries += 1;
      const after = response?.headers.get("retry-after");
      const serverDelay =
        after && /^\d+$/.test(after) ? Number(after) * 1000 : 0;
      await delay(Math.min(5000, Math.max(serverDelay, 250 * 2 ** attempt)));
    }
  }
  return { submitted, retries, pending: 0, failure: null };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const file = process.argv[2];
    if (!file || process.argv.length !== 3)
      throw new Error("Pass exactly one exported course archive filename");
    const handle = await open(file, "r");
    let archive;
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > maxBytes)
        throw new Error("The archive must be a file up to 4 MiB");
      const bytes = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > maxBytes) throw new Error("The archive exceeds 4 MiB");
      archive = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    } finally {
      await handle.close();
    }
    const report = await deliverXapiArchive(archive, {
      endpoint: process.env.LMS_XAPI_LRS_ENDPOINT,
      username: process.env.LMS_XAPI_LRS_USERNAME,
      password: process.env.LMS_XAPI_LRS_PASSWORD,
    });
    console.log(JSON.stringify(report));
    if (report.failure !== null) process.exitCode = 1;
  } catch {
    console.error("Could not validate the xAPI archive or LRS configuration.");
    process.exitCode = 1;
  }
}
