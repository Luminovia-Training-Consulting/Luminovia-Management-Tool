/** Retain only an opaque reset receipt across the local supervisor restart. */
import { join } from "node:path";
import { command, privateWrite, root, runtimeDir } from "./runtime-lib.mjs";

const [project, id] = process.argv.slice(2);
const receipt = join(runtimeDir, "browser-reset.json");
const write = (state) => privateWrite(receipt, JSON.stringify({ id, state }));
write("running");
try {
  await command(join(root, "portal"), ["reset", "--confirm", project], {
    timeoutMs: 900000,
    quiet: true,
  });
  write("complete");
} catch {
  write("failed");
  process.exitCode = 1;
}
