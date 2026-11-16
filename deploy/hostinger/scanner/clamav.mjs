/**
 * Bounded ClamAV INSTREAM client for the private gateway. Validate response format, timeout and signature freshness; connection failures never become clean scan results.
 */
import { createConnection } from "node:net";

export const MAX_BYTES = 100 * 1024 * 1024;
const MAX_REPLY_BYTES = 4096;

// Honor socket backpressure before sending the next protocol block.
function write(socket, bytes) {
  return new Promise((resolve, reject) => {
    socket.write(bytes, (error) => (error ? reject(error) : resolve()));
  });
}

// clamd is deliberately reachable only on the private container network.
// A total deadline covers DNS/connect/write/read, including a silent peer.
// Own the TCP socket, bound response/time, and close it on every completion path.
function exchange({ host, port, timeoutMs }, send) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let reply = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (error) reject(new Error("scanner_unavailable"));
      else resolve(value);
    };
    const deadline = setTimeout(() => finish(true), timeoutMs);
    socket.on("error", () => finish(true));
    socket.on("end", () => finish(true));
    socket.on("data", (chunk) => {
      if (reply.length + chunk.length > MAX_REPLY_BYTES) {
        finish(true);
        return;
      }
      reply = Buffer.concat([reply, chunk]);
      const delimiter = reply.findIndex((byte) => byte === 0 || byte === 10);
      if (delimiter < 0) return;
      const trailing = reply.subarray(delimiter + 1);
      if (trailing.some((byte) => byte !== 0 && byte !== 10 && byte !== 13)) {
        finish(true);
        return;
      }
      finish(
        false,
        reply.subarray(0, delimiter).toString("utf8").replace(/\r$/, ""),
      );
    });
    socket.once("connect", () => {
      Promise.resolve(send(socket)).catch(() => finish(true));
    });
  });
}

// Reject invalid or stale signature information even when clamd is reachable.
export function validateVersion(version, now = Date.now()) {
  if (typeof version !== "string" || !/^ClamAV [ -~]{1,500}$/.test(version)) {
    throw new Error("scanner_version");
  }
  const signatureDate = Date.parse(version.slice(version.lastIndexOf("/") + 1));
  if (
    !Number.isFinite(signatureDate) ||
    now - signatureDate > 14 * 86400000 ||
    signatureDate - now > 86400000
  ) {
    throw new Error("scanner_definitions_stale");
  }
  return version;
}

// Create the INSTREAM scanner with fixed size/time limits and signature validation.
export function createClamavScanner({
  host = "clamav",
  port = 3310,
  versionTimeoutMs = 3000,
  scanTimeoutMs = 25000,
} = {}) {
  if (
    typeof host !== "string" ||
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("scanner_configuration");
  }
  const version = async () =>
    validateVersion(
      await exchange({ host, port, timeoutMs: versionTimeoutMs }, (socket) =>
        write(socket, Buffer.from("zVERSION\0")),
      ),
    );
  const scan = async (bytes) => {
    if (
      !(bytes instanceof Uint8Array) ||
      !bytes.length ||
      bytes.length > MAX_BYTES
    )
      throw new Error("scanner_file_size");
    const scannerVersion = await version();
    const result = await exchange(
      { host, port, timeoutMs: scanTimeoutMs },
      async (socket) => {
        await write(socket, Buffer.from("zINSTREAM\0"));
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          const chunk = bytes.subarray(offset, offset + 65536);
          const prefix = Buffer.alloc(4);
          prefix.writeUInt32BE(chunk.length);
          await write(socket, prefix);
          await write(socket, chunk);
        }
        await write(socket, Buffer.alloc(4));
      },
    );
    if (result === "stream: OK")
      return { clean: true, version: scannerVersion };
    if (/^stream: [ -~]{1,512} FOUND$/.test(result))
      return { clean: false, version: scannerVersion };
    throw new Error("scanner_protocol");
  };
  return { scan, version };
}
