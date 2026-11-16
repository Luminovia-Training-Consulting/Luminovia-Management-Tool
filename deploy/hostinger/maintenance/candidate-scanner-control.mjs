/**
 * Control only the scanner labeled with this candidate's owner for outage tests. A matching name alone is insufficient; verify project and owner metadata.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Adapter for the existing document API suite, inside its disposable checkout.
// It starts the candidate scanner; it never creates a CLI scanner or touches a VM.
assert.deepEqual(process.argv.slice(2), ["start"]);
const owner = process.env.PORTAL_CANDIDATE_OWNER;
assert.match(owner ?? "", /^luminovia-portal-test-[a-f0-9]{24}$/);
const name = `portal_scanner_${owner}`;
// Invoke Docker without shell interpolation; validate target container and owner separately.
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  }).trim();
const metadata = JSON.parse(docker(["inspect", name]))[0];
assert.equal(metadata.Config.Labels["org.luminovia.candidate"], owner);
assert.equal(metadata.Name, "/" + name);
assert.equal(Object.keys(metadata.HostConfig.PortBindings ?? {}).length, 0);
docker(["start", name]);
for (let count = 0; count < 180; count++) {
  const status = docker([
    "inspect",
    "--format",
    "{{.State.Health.Status}}",
    name,
  ]);
  if (status === "healthy") process.exit(0);
  if (status === "unhealthy") throw new Error("Candidate scanner unhealthy.");
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
throw new Error("Candidate scanner startup timed out.");
