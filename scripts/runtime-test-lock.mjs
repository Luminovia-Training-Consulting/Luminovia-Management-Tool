/**
 * Schützt die festen QA-Ports über alle Checkouts desselben Linux-Benutzers.
 * Der Kernel hält die Sperre; ein alter PID-Eintrag darf sie weder stehlen noch dauerhaft blockieren.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

/** Older checkouts do not yet acquire the shared lock. Refuse their occupied
 * ports before proxy fixtures or stack startup, without touching any listener. */
/** Prüft feste Loopback-Ports vor jedem Testdienststart und lässt vorhandene Listener vollständig in Ruhe. */
export async function assertTestPortsAvailable(
  ports = [5273, 55321, 55322, 55324, 4273],
) {
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("A valid fixed local test port is required.");
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", () =>
        reject(
          new Error(
            `Testport ${port} ist bereits belegt oder nicht verfügbar. Ein anderer Checkout/Prozess bleibt unverändert; warte auf dessen Abschluss.`,
          ),
        ),
      );
      probe.listen(port, "127.0.0.1", () => probe.close(resolve));
    });
  }
}

/** All checkouts share fixed loopback QA ports, so the owning lock must span
 * worktrees. The kernel owns its lifetime: stale PID metadata cannot retain or
 * steal it, and SIGKILL releases it without a racy lock-directory deletion. */
/** Hält den gemeinsamen Lock-Inode über den offenen Deskriptor; Freigabe schließt ihn, statt ihn racy zu löschen. */
export function acquireTestLock({
  directory = join(tmpdir(), `luminovia-portal-qa-${process.getuid()}`),
  checkout = process.cwd(),
} = {}) {
  const uid = process.getuid();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== uid)
    throw new Error(
      "Refusing an unowned or symlinked global QA lock directory.",
    );
  chmodSync(directory, 0o700);
  let fd;
  try {
    fd = openSync(
      join(directory, "active.lock"),
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    const file = fstatSync(fd);
    if (!file.isFile() || file.uid !== uid)
      throw new Error("Refusing an unowned global QA lock file.");
    chmodSync(join(directory, "active.lock"), 0o600);
    // flock receives a duplicate of this same open-file description. Keeping
    // the parent descriptor open keeps the kernel lock after flock exits.
    const result = spawnSync("flock", ["--exclusive", "--nonblock", "3"], {
      stdio: ["ignore", "pipe", "pipe", fd],
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.error || (result.status !== 0 && result.status !== 1))
      throw new Error(
        "Global QA locking needs the Linux util-linux flock command; no test services were started.",
      );
    if (result.status === 1)
      throw new Error(
        "Ein isolierter Portal-Test läuft bereits in einem anderen Checkout. Die gemeinsamen Testports bleiben geschützt; warte auf dessen Abschluss.",
      );
    ftruncateSync(fd, 0);
    writeSync(
      fd,
      JSON.stringify({
        pid: process.pid,
        checkout: resolve(checkout),
        startedAt: new Date().toISOString(),
      }) + "\n",
    );
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Never unlink the locked inode: a waiter might already have opened it.
    closeSync(fd);
  };
}
