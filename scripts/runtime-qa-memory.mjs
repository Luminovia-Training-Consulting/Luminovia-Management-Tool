import {accessSync, constants, readFileSync, statfsSync} from "node:fs";
import {tmpdir} from "node:os";

const GiB = 1024 ** 3;
const tmpfs = 0x01021994;
const ramfs = 0x858458f6;

/** Keep large QA copies, browser profiles and temporary caches on disk. */
export function localQaTempRoot({
    preferred = tmpdir(), platform = process.platform,
    statfs = statfsSync, access = accessSync,
} = {}) {
    if (platform !== "linux") return preferred;
    for (const candidate of new Set([preferred, "/var/tmp"])) {
        try {
            const type = statfs(candidate).type >>> 0;
            if (type === tmpfs || type === ramfs) continue;
            access(candidate, constants.W_OK | constants.X_OK);
            return candidate;
        } catch {
            // A missing or unwritable alternative cannot hold this run.
        }
    }
    throw new Error("Portal QA needs a writable disk-backed temporary directory. Set TMPDIR to a directory on disk.");
}

/** Stop local QA before starting additional workers or Docker services under pressure. */
export function assertLocalQaMemory(minimum, {
    platform = process.platform, ci = process.env.CI, read = readFileSync,
} = {}) {
    if (platform !== "linux" || ci === "true") return;
    let info;
    try {
        info = read("/proc/meminfo", "utf8");
    } catch {
        return; // Containers may omit the optional Linux host memory view.
    }
    const available = Number(/^MemAvailable:\s+(\d+) kB$/m.exec(info)?.[1]) * 1024;
    if (Number.isFinite(available) && available < minimum * GiB) {
        throw new Error(
            `Local QA needs ${minimum} GiB of available memory at this stage. ` +
            `Linux reports ${(available / GiB).toFixed(1)} GiB. ` +
            "Wait for other heavy tasks to finish before running this check.",
        );
    }
}
