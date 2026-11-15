import { spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  root,
  runtimeDir,
  privateDirectory,
  privateWrite,
  cleanEnvironment,
  readEnvFile,
  waitForHttp,
} from "./runtime-lib.mjs";
if (process.env.PORTAL_TEST_MODE !== "1")
  throw new Error("This preview helper is only for isolated tests.");
const file = join(runtimeDir, "test-preview.pid");
if (process.argv[2] === "start") {
  privateDirectory();
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          "Isolated preview port 4273 is occupied; unrelated processes are preserved.",
        ),
      ),
    );
    server.listen(4273, "127.0.0.1", () => server.close(resolve));
  });
  const log = openSync(join(runtimeDir, "test-preview.log"), "w", 0o600);
  const child = spawn(
    join(root, "node_modules/.bin/vite"),
    ["preview", "--host", "127.0.0.1", "--port", "4273", "--strictPort"],
    {
      cwd: root,
      env: cleanEnvironment({
        ...readEnvFile(join(root, ".env.local")),
        PORTAL_TEST_MODE: "1",
      }),
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  closeSync(log);
  child.unref();
  const started = readFileSync(`/proc/${child.pid}/stat`, "utf8")
    .split(") ")
    .at(-1)
    .split(" ")[19];
  privateWrite(file, JSON.stringify({ pid: child.pid, started }));
  await waitForHttp("http://127.0.0.1:4273/login");
} else if (existsSync(file)) {
  const { pid, started } = JSON.parse(readFileSync(file, "utf8"));
  try {
    const command = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    const actual = readFileSync(`/proc/${pid}/stat`, "utf8")
      .split(") ")
      .at(-1)
      .split(" ")[19];
    if (
      actual === started &&
      command.includes(join(root, "node_modules/.bin/vite")) &&
      command.includes("4273")
    )
      process.kill(pid, "SIGTERM");
  } catch {
    /* already exited */
  }
}
