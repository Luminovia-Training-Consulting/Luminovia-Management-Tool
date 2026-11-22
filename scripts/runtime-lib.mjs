/**
 * Shared local process, configuration and persistence helpers for the portal CLI.
 * Private files, sanitised environments and confirmed process termination define the runtime boundaries.
 */
import {execFileSync, spawn} from "node:child_process";
import {chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync,} from "node:fs";
import {join, resolve} from "node:path";
import {release} from "node:os";
import {createHash} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";

export const root = resolve(import.meta.dirname, "..");
export const runtimeDir = join(root, ".local");
export const stateFile = join(runtimeDir, "runtime.json");
export const runtimeVersion = 3;

/** Creates the private directory and applies mode 0700 even when the path already exists. */
export function privateDirectory(path = runtimeDir) {
    mkdirSync(path, {recursive: true, mode: 0o700});
    chmodSync(path, 0o700);
}

/** Reads simple local KEY=VALUE lines as data, without shell evaluation or interpolation. */
export function readEnvFile(path) {
    if (!existsSync(path)) return {};
    return Object.fromEntries(
        readFileSync(path, "utf8")
            .split(/\r?\n/)
            .filter((line) => line && !line.startsWith("#") && line.includes("="))
            .map((line) => {
                const index = line.indexOf("=");
                return [line.slice(0, index), line.slice(index + 1)];
            }),
    );
}

/** Preserves identical contents or replaces them through a private temporary file; the final mode remains 0600. */
export function privateWrite(path, content) {
    if (existsSync(path) && readFileSync(path, "utf8") === content) {
        chmodSync(path, 0o600);
        return;
    }
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, content, {mode: 0o600});
    renameSync(temporary, path);
    chmodSync(path, 0o600);
}

/** Reads runtime state best effort; a missing or invalid file never confirms a running process. */
export function readState() {
    try {
        return JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
        return null;
    }
}

/** Persists structured supervisor state only in private runtime storage. */
export function writeState(state) {
    privateDirectory();
    privateWrite(stateFile, JSON.stringify(state, null, 2) + "\n");
}

/** Checks PID, supervisor path and session so an unrelated reused PID cannot be adopted. */
export function processIsOurs(state) {
    if (
        !Number.isInteger(state?.pid) ||
        state.pid <= 1 ||
        typeof state.session !== "string"
    )
        return false;
    try {
        process.kill(state.pid, 0);
        const command =
            process.platform === "linux"
                ? readFileSync(`/proc/${state.pid}/cmdline`, "utf8")
                : execFileSync("ps", ["-p", String(state.pid), "-o", "args="], {
                    encoding: "utf8",
                });
        return (
            command.includes(join(root, "scripts/runtime-supervisor.mjs")) &&
            command.includes(state.session)
        );
    } catch {
        return false;
    }
}

/** Removes inherited service/cloud credentials before local subprocesses and preserves the pinned CLI's image selector. */
export function cleanEnvironment(extra = {}) {
    const env = Object.fromEntries(
        Object.entries(process.env).filter(
            ([key, value]) =>
                (key === "SUPABASE_USE_SLIM_IMAGES" && value === "1") ||
                !/^(SUPABASE_|VITE_|E2E_|PORTAL_|S3_|AWS_|SMTP_|OPENAI_|RESEND_|DATABASE_URL$|PGPASSWORD$)/.test(key),
        ),
    );
    return {...env, ...extra};
}

/** Redacts known key/JWT/database patterns and saved local secrets before logging output. */
export function redact(value) {
    let text = String(value)
        .replace(
            /("[A-Z0-9_]*(?:KEY|SECRET|PASSWORD|TOKEN)[A-Z0-9_]*"\s*:\s*")[^"]*(")/g,
            "$1[redacted]$2",
        )
        .replace(
            /^([A-Z0-9_]*(?:KEY|SECRET|PASSWORD|TOKEN)[A-Z0-9_]*=).*$/gm,
            "$1[redacted]",
        );
    for (const [key, secret] of Object.entries(
        readEnvFile(join(root, ".env.test.local")),
    )) {
        if (/KEY|SECRET|PASSWORD|TOKEN/.test(key) && secret.length >= 8)
            text = text.replaceAll(secret, "[redacted local credential]");
    }
    return text
        .replace(
            /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
            "[redacted JWT]",
        )
        .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, "[redacted key]")
        .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "postgresql://[redacted]");
}

/** Starts an owned process group, bounds captured output and confirms success only after actual close. */
export async function command(
    file,
    args,
    {
        cwd = root,
        env = cleanEnvironment(),
        quiet = false,
        log,
        timeoutMs = 300000,
        killGraceMs = 5000,
        signal,
    } = {},
) {
    if (signal?.aborted) throw new Error("Command cancelled before start.");
    return await new Promise((resolve, reject) => {
        const child = spawn(file, args, {
            cwd,
            env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
        });
        let output = "";
        let finished = false;
        let termination;
        let forceTimer;
        let spawnError;
        /** Signals only the owned process group and tolerates a child that has already exited. */
        const kill = (signal) => {
            if (finished) return;
            try {
                if (process.platform !== "win32") process.kill(-child.pid, signal);
                else child.kill(signal);
            } catch {
                /* already exited */
            }
        };
        /** Records timeout/cancellation and escalates only after the bounded SIGTERM grace period. */
        const terminate = (cause) => {
            if (finished || termination) return;
            termination = cause;
            kill("SIGTERM");
            // Wait for real process/pipe closure, then escalate the owned group if a
            // tool ignores SIGTERM. An AbortError alone is not proof of termination.
            forceTimer = setTimeout(() => kill("SIGKILL"), killGraceMs);
        };
        /** Marks the active command cancelled; a later zero exit must not turn cancellation into success. */
        const cancel = () => terminate("cancelled");
        const timer = setTimeout(() => terminate("timed out"), timeoutMs);
        signal?.addEventListener("abort", cancel, {once: true});
        /** Bounds captured subprocess output until the final logging path redacts it. */
        const receive = (data) => {
            output = (output + data.toString()).slice(-1000000);
        };
        child.stdout.on("data", receive);
        child.stderr.on("data", receive);
        child.on("error", (error) => {
            // Node emits close after a spawn error too; use one settlement/cleanup
            // path so no cancellation timer is cleared while a child is still live.
            spawnError = error;
        });
        // `exit` can precede the final stdout chunks; JSON-producing Docker probes
        // must wait until both pipes have closed before consuming their output.
        child.on("close", (code, exitSignal) => {
            finished = true;
            clearTimeout(timer);
            clearTimeout(forceTimer);
            signal?.removeEventListener("abort", cancel);
            const safe = redact(output);
            if (log) log(safe);
            if (!quiet) process.stdout.write(safe);
            if (spawnError)
                reject(
                    new Error(
                        `Could not start program ${file}. Check installation and execution permissions.`,
                        {cause: spawnError},
                    ),
                );
            else if (code === 0 && !termination) resolve(safe);
            else
                reject(
                    new Error(
                        `${file} ${args.slice(0, 3).join(" ")} ${termination ?? "failed"} (${exitSignal ?? code}). ${log ? "Siehe .local/runtime.log." : safe.trim().slice(-1500)}`,
                    ),
                );
        });
    });
}

/** Invokes exactly the installed local Supabase CLI through the same controlled process runner. */
export function supabase(args, options = {}) {
    return command(join(root, "node_modules/.bin/supabase"), args, options);
}

/** Reads project identity and local service ports from the TOML configuration actually in use. */
export function projectConfig(cwd = root) {
    const text = readFileSync(join(cwd, "supabase/config.toml"), "utf8");
    /** Restricts configuration lookup to the requested TOML section. */
    const section = (name) =>
        text.match(new RegExp(`\\[${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`))?.[1] ?? "";
    return {
        id: text.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1],
        api: Number(section("api").match(/^port\s*=\s*(\d+)/m)?.[1]),
        database: Number(section("db").match(/^port\s*=\s*(\d+)/m)?.[1]),
        mail: Number(section("local_smtp").match(/^port\s*=\s*(\d+)/m)?.[1]),
        site: section("auth").match(/^site_url\s*=\s*"([^"]+)"/m)?.[1],
    };
}

/** Allow the built PWA to sign in only on the canonical disposable test project. */
export function localEdgeOrigins({id, site}) {
    const origins = [site, site.replace("127.0.0.1", "localhost")];
    if (/^luminovia-portal-test-[a-f0-9]{8}$/.test(id ?? "") && site === "http://127.0.0.1:5273")
        origins.push("http://127.0.0.1:4273");
    return origins;
}

/** Rejects remote targets, embedded credentials and unrelated protocols for local HTTP probes. */
export function localUrl(value, label = "URL") {
    const url = new URL(value);
    if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.username ||
        url.password
    )
        throw new Error(`${label} must be a credential-free loopback HTTP URL.`);
    return url;
}

/** Waits within a deadline for the required actual HTTP status, not merely a started process. */
export async function waitForHttp(
    url,
    {timeoutMs = 45000, status = 200} = {},
) {
    const target = localUrl(url, "Readiness URL");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(target, {
                redirect: "manual",
                signal: AbortSignal.timeout(2000),
            });
            if (response.status === status) return;
        } catch {
            /* not ready */
        }
        await delay(500);
    }
    throw new Error(
        `Local service did not become ready at ${target.origin}.`,
    );
}

/** Checks installed dependencies against the lockfile contract and installs reproducibly when needed. */
export async function ensureDependencies() {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const lock = JSON.parse(
        readFileSync(join(root, "package-lock.json"), "utf8"),
    );
    let installed;
    try {
        installed = JSON.parse(
            readFileSync(join(root, "node_modules/.package-lock.json"), "utf8"),
        );
    } catch {
        /* install below */
    }
    const packages = {...pkg.dependencies, ...pkg.devDependencies};
    const valid =
        installed &&
        Object.entries(packages).every(
            ([name, version]) =>
                lock.packages[`node_modules/${name}`]?.version === version &&
                installed.packages[`node_modules/${name}`]?.version === version &&
                existsSync(join(root, "node_modules", name, "package.json")),
        );
    if (!valid) {
        console.log("Installing locked dependencies …");
        await command("npm", ["ci"]);
    }
    privateDirectory();
    privateWrite(
        join(runtimeDir, "dependencies.sha256"),
        createHash("sha256")
            .update(readFileSync(join(root, "package-lock.json")))
            .digest("hex") + "\n",
    );
}

/** Requires a local Docker endpoint before service mutations; remote daemons are not valid test targets. */
export async function assertLocalDocker({startService = false} = {}) {
    const host =
        (!process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST) ||
        (
            await command(
                "docker",
                [
                    "context",
                    "inspect",
                    ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []),
                    "--format",
                    "{{.Endpoints.docker.Host}}",
                ],
                {quiet: true, timeoutMs: 10000},
            )
        ).trim();
    if (!host.startsWith("unix://") && !host.startsWith("npipe://")) {
        let url;
        try {
            url = new URL(host);
        } catch {
            throw new Error("Docker context is not a supported local endpoint.");
        }
        if (
            !["tcp:", "http:", "https:"].includes(url.protocol) ||
            !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        )
            throw new Error(
                "This local launcher refuses a remote Docker context. Select a local Docker Engine first.",
            );
    }
    const defaultSocket = ["unix:///var/run/docker.sock", "unix:///run/docker.sock"].includes(host);
    const probe = () => command("docker", ["info", "--format", "{{.ServerVersion}}"], {
        quiet: true,
        timeoutMs: 10000,
    });

    try {
        await probe();
    } catch (error) {
        if (!startService || error.cause?.code === "ENOENT") throw error;
        if (/permission denied/i.test(error.message)) {
            throw new Error(
                "Docker socket access was denied. Run docker info as your regular user and fix Docker access before retrying ./portal start.",
                {cause: error},
            );
        }
        if (!defaultSocket || !/cannot connect|connection refused|no such file/i.test(error.message)) {
            throw new Error(
                "The selected local Docker Engine is unavailable. Start it or check your Docker context with docker context ls and docker info.",
                {cause: error},
            );
        }

        const interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY);
        console.log("Docker is stopped or unavailable. Starting the local docker.service …");
        try {
            if (interactive) {
                // Keep the terminal attached so systemd can use its normal authentication prompt.
                execFileSync("systemctl", ["start", "docker.service"], {
                    stdio: "inherit",
                    timeout: 60_000,
                    killSignal: "SIGKILL",
                });
            } else {
                await command("systemctl", ["--no-ask-password", "start", "docker.service"], {
                    quiet: true,
                    timeoutMs: 60_000,
                });
            }
        } catch {
            // The Docker probe is authoritative, including when another process starts the service.
        }

        try {
            await probe();
        } catch (retryError) {
            const kernel = release();
            const missingModules = existsSync("/usr/lib/modules") &&
                !existsSync(join("/usr/lib/modules", kernel));
            const guidance = /permission denied/i.test(retryError.message)
                ? "Docker is unreachable with your current socket permissions. Check docker info as your regular user."
                : missingModules
                    ? `The module directory for the running kernel (${kernel}) is missing. If Linux was updated, reboot into the installed kernel, then retry ./portal start.`
                    : "Run sudo systemctl start docker.service in a terminal. If it fails, inspect journalctl -b -u docker.service -n 30 --no-pager.";
            throw new Error(`The local Docker Engine is unavailable. ${guidance}`, {cause: retryError});
        }
    }
    return host;
}

/** Binds startup state to complete sorted migration sources and rejects unfinished source files. */
export function migrationDigest(cwd = root) {
    const path = join(cwd, "supabase/migrations");
    const hash = createHash("sha256");
    for (const name of readdirSync(path)
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        const source = readFileSync(join(path, name), "utf8");
        if (
            !source
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/--[^\n]*/g, "")
                .trim()
        )
            throw new Error(
                `Migration ${name} is empty. Complete it before starting.`,
            );
        hash.update(name);
        hash.update(source);
    }
    return hash.digest("hex");
}
