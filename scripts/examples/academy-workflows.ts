/** Send one documented Academy request with a current human access token. */
import { readFileSync } from "node:fs";

const operations = {
  "invite-account": {
    path: "functions/v1/accounts/v1/academy/users",
    statuses: [200, 201, 202],
  },
  "invite-learner": {
    path: "functions/v1/accounts/v1/academy/company-invitations",
    statuses: [202],
  },
  "draft-options": {
    path: "rest/v1/rpc/academy_course_draft_options",
    statuses: [200],
  },
  "create-draft": {
    path: "rest/v1/rpc/academy_create_course_draft",
    statuses: [200],
  },
};

/** This check catches accidental privileged credentials. The server verifies the JWT. */
function tokenRole(token: string): unknown {
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return undefined;
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
      ?.role;
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const [command = "", ...extra] = process.argv.slice(2);
  if (extra.length || !Object.hasOwn(operations, command)) {
    console.error(
      `Choose one operation: ${Object.keys(operations).join(", ")}.`,
    );
    return 2;
  }
  const operation = operations[command as keyof typeof operations];
  const base = process.env.LUMINOVIA_API_BASE_URL ?? "";
  const apiKey = process.env.LUMINOVIA_PUBLISHABLE_KEY ?? "";
  const accessToken = process.env.LUMINOVIA_ACCESS_TOKEN ?? "";
  const basePattern =
    /^(?:https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]+)?|http:\/\/127\.0\.0\.1:[0-9]+)(?:\/backend)?\/?$/;
  if (!basePattern.test(base) || !URL.canParse(base)) {
    console.error(
      "Set LUMINOVIA_API_BASE_URL to the server shown in Academy OpenAPI.",
    );
    return 2;
  }
  if (!/^sb_publishable_[\w-]+$/.test(apiKey) && tokenRole(apiKey) !== "anon") {
    console.error("Set LUMINOVIA_PUBLISHABLE_KEY to the public API key.");
    return 2;
  }
  if (tokenRole(accessToken) !== "authenticated") {
    console.error(
      "Set LUMINOVIA_ACCESS_TOKEN to the actor's short-lived access token.",
    );
    return 2;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Expected a JSON object");
    }
  } catch {
    console.error("Pass a JSON request object on stdin.");
    return 2;
  }
  if (
    command === "invite-account" &&
    (payload.mode !== "invite" || Object.hasOwn(payload, "password"))
  ) {
    console.error(
      "This example supports account invitations without a password field.",
    );
    return 2;
  }

  try {
    const endpoint = new URL(operation.path, base.replace(/\/$/, "") + "/");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
        Origin: endpoint.origin,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (!operation.statuses.includes(response.status)) {
      const error = await response.json().catch(() => null);
      const code = error?.error ?? error?.code;
      const safeCode =
        typeof code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(code);
      console.error(`HTTP ${response.status}${safeCode ? ` (${code})` : ""}`);
      return 1;
    }
    console.log(JSON.stringify(await response.json()));
    return 0;
  } catch {
    console.error("The Academy request or JSON response failed.");
    return 1;
  }
}

process.exitCode = await main();
