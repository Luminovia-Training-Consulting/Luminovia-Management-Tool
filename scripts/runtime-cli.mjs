/**
 * Dispatches commands for the local portal runtime while preserving persistent data.
 * Start/stop are serialised; preview and isolated full acceptance have separate ownership.
 */
import {spawn} from "node:child_process";
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync,} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {assertLocalDocker, cleanEnvironment, command, ensureDependencies, migrationDigest, privateDirectory, processIsOurs, projectConfig, readState, root, runtimeDir, runtimeVersion, supabase, writeState,} from "./runtime-lib.mjs";
import {removeLoopbackNetwork, verifyLoopbackBindings,} from "./runtime-network.mjs";

const action = process.argv[2] ?? "start";
if (process.platform !== "linux" && !["help", "--help", "-h"].includes(action))
    throw new Error(
        "The local launcher is currently tested on Linux. See DEVELOPMENT.md.",
    );

/** Serialises this checkout's runtime mutations and releases its own lock on failure as well. */
async function locked(operation) {
    privateDirectory();
    const lock = join(runtimeDir, "runtime.lock");
    const deadline = Date.now() + 480000;
    while (true) {
        try {
            mkdirSync(lock, {mode: 0o700});
            writeStateLock();
            break;
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            let stale = false;
            try {
                const owner = Number(readFileSync(join(lock, "pid"), "utf8"));
                try {
                    process.kill(owner, 0);
                } catch {
                    stale = true;
                }
            } catch {
                stale = Date.now() - statSync(lock).mtimeMs > 10000;
            }
            if (stale) {
                rmSync(lock, {recursive: true, force: true});
                continue;
            }
            if (Date.now() >= deadline)
                throw new Error(
                    "Another runtime command is still active. Check .local/runtime.lock.",
                    {cause: error},
                );
            await delay(500);
        }
    }

    /** Writes the current CLI lock holder's identity into private runtime storage. */
    function writeStateLock() {
        writeFileSync(join(lock, "pid"), String(process.pid), {mode: 0o600});
    }

    try {
        return await operation();
    } finally {
        rmSync(lock, {recursive: true, force: true});
    }
}

/** Describes only commands actually offered and their local data storage. */
function help() {
    console.log(
        `Luminovia Portal – complete local runtime\n\n  ./portal start        Start all local services in the background\n  ./portal up           Start; Ctrl+C stops services while preserving data\n  ./portal restart      Restart while preserving data\n  ./portal status       Service status and local URLs\n  ./portal stop         Stop owned services while preserving data\n  ./portal check        Check source, tests and build without Docker\n  ./portal test         Run complete tests in an isolated environment\n  ./portal credentials  Show the original local test password\n  ./portal reset        Erase the confirmed local project and restart with fictional data\n  ./portal reset-demo-admin  Reset the local demo administrator password\n  ./portal github       Try the latest GitHub main in a separate local preview\n  ./portal github test  Fully test the latest GitHub main in isolation\n\nNode.js >=22.12 and npm are required; services and full tests also require Docker.\nNo production, real email, or reset on startup.`,
    );
}

/** Shows service status and local URLs without exposing private keys. */
function printStatus(state = readState()) {
    const config = projectConfig();
    const alive = processIsOurs(state);
    console.log(`Luminovia Portal: ${alive ? state.phase : "stopped"}`);
    if (alive) console.log(state.message ?? "");
    console.log(
        `Portal: ${config.site}\nSupabase API: http://127.0.0.1:${config.api}\nLocal email: http://127.0.0.1:${config.mail}\nSign in: admin@example.invalid or lecturer01@example.invalid\nShow password: ./portal credentials\nPrivate log: .local/runtime.log`,
    );
}

/** Starts or adopts the owned supervisor and confirms success only after its ready state. */
async function start() {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 12))
        throw new Error("Node.js >=22.12 is required.");
    const dockerHost = await assertLocalDocker({startService: true});
    await ensureDependencies();
    const existing = readState();
    if (processIsOurs(existing)) {
        if (existing.phase === "ready") {
            if (
                existing.runtimeVersion !== runtimeVersion ||
                (existing.migrations && existing.migrations !== migrationDigest())
            ) {
                console.log(
                    "New runtime configuration or migrations detected; restarting while preserving data …",
                );
                await stop();
                return await start();
            }
            await verifyLoopbackBindings(projectConfig().id, {
                scanner: true,
                edge: true,
            });
            printStatus(existing);
            return;
        }
        console.log("Local startup is already in progress …");
    } else {
        privateDirectory();
        const session = randomUUID();
        const output = openSync(join(runtimeDir, "supervisor.log"), "w", 0o600);
        const child = spawn(
            process.execPath,
            [join(root, "scripts/runtime-supervisor.mjs"), session],
            {
                cwd: root,
                env: cleanEnvironment({DOCKER_HOST: dockerHost}),
                detached: true,
                stdio: ["ignore", output, output],
            },
        );
        closeSync(output);
        child.unref();
        writeState({
            pid: child.pid,
            session,
            phase: "starting",
            startedAt: new Date().toISOString(),
            message: "Starting local runtime …",
        });
    }
    let last = "";
    const deadline = Date.now() + 360000;
    while (Date.now() < deadline) {
        const state = readState();
        if (state?.message && state.message !== last) {
            console.log(state.message);
            last = state.message;
        }
        if (state?.phase === "ready" && processIsOurs(state)) {
            printStatus(state);
            return;
        }
        if (
            state?.phase === "failed" ||
            state?.phase === "stopped" ||
            !processIsOurs(state)
        )
            throw new Error(
                "Local startup failed. See .local/runtime.log (do not share credentials).",
            );
        await delay(500);
    }
    throw new Error(
        "Local startup timed out. Run ./portal status to check progress.",
    );
}

/** Stops only the owned service group and requires a cleanup acknowledgement matching its session. */
async function stop() {
    await assertLocalDocker();
    const state = readState();
    if (processIsOurs(state)) {
        process.kill(state.pid, "SIGTERM");
        const deadline = Date.now() + 125000;
        while (processIsOurs(state) && Date.now() < deadline) await delay(500);
        if (processIsOurs(state))
            throw new Error(
                "Data-preserving shutdown timed out; check .local/runtime.log.",
            );
        const stopped = readState();
        // A vanished PID alone does not prove that container/network cleanup ran.
        // Preserve an explicit supervisor failure instead of printing success.
        if (
            stopped?.pid !== state.pid ||
            stopped?.session !== state.session ||
            stopped?.phase !== "stopped"
        )
            throw new Error(
                "Data-preserving shutdown was not confirmed; check .local/runtime.log.",
            );
    } else {
        await ensureDependencies();
        if (existsSync(join(root, "scripts/local-scanner.mjs")))
            await command(process.execPath, ["scripts/local-scanner.mjs", "stop"], {
                quiet: true,
                timeoutMs: 120000,
            });
        await supabase(["stop", "--project-id", projectConfig().id], {
            quiet: true,
            timeoutMs: 120000,
        });
        await removeLoopbackNetwork(projectConfig().id);
    }
    console.log(
        "Local portal stopped. Database, password Auth and Storage data are preserved.",
    );
}

try {
    switch (action) {
        case "github":
            await (
                await import("./runtime-github.mjs")
            ).githubPreviewCommand(process.argv.slice(3));
            break;
        case "start":
            await locked(start);
            break;
        case "up":
            await locked(start);
            console.log("Ctrl+C stops local services without data loss.");
            await new Promise((resolve) => {
                process.once("SIGINT", resolve);
                process.once("SIGTERM", resolve);
            });
            await locked(stop);
            break;
        case "stop":
            await locked(stop);
            break;
        case "restart":
            await locked(async () => {
                await stop();
                await start();
            });
            break;
        case "status":
            printStatus();
            break;
        case "credentials":
            if (!existsSync(join(runtimeDir, "ACCOUNTS.txt")))
                throw new Error(
                    "No local credentials file yet. Run ./portal start first.",
                );
            process.stdout.write(
                readFileSync(join(runtimeDir, "ACCOUNTS.txt"), "utf8"),
            );
            if (existsSync(join(runtimeDir, "ADMIN-DEMO.txt")))
                process.stdout.write(
                    `\n${readFileSync(join(runtimeDir, "ADMIN-DEMO.txt"), "utf8")}`,
                );
            break;
        case "reset": {
            const { assertResetDockerHost, confirmLocalReset, localResetTarget, resetLocalPortal } =
                await import("./local-reset.mjs");
            const confirmed = localResetTarget(root);
            await confirmLocalReset(process.argv.slice(3), confirmed.id);
            await locked(async () => {
                const dockerHost = await assertLocalDocker();
                assertResetDockerHost(dockerHost);
                // Pin every nested lifecycle/scanner/CLI subprocess to the same local daemon.
                delete process.env.DOCKER_CONTEXT;
                process.env.DOCKER_HOST = dockerHost;
                await ensureDependencies();
                await resetLocalPortal({
                    checkout: root,
                    confirmed,
                    docker: (args) => command("docker", args, {quiet: true, timeoutMs: 30000}),
                    ownsRuntime: () => {
                        const state = readState();
                        if (!processIsOurs(state)) return false;
                        if (state.projectId !== confirmed.id)
                            throw new Error("The running supervisor owns another local project.");
                        return true;
                    },
                    stop,
                    start,
                });
                console.log(`Local project ${confirmed.id} reset and started with fictional data.`);
            });
            break;
        }
        case "reset-demo-admin":
            await locked(async () => {
                await assertLocalDocker();
                await (
                    await import("./local-admin-recovery.mjs")
                ).resetLocalDemoAdmin();
            });
            break;
        case "test":
            await ensureDependencies();
            await import("./runtime-test.mjs");
            break;
        case "check":
            await (await import("./runtime-local-check.mjs")).runLocalCheck();
            break;
        case "help":
        case "--help":
        case "-h":
            help();
            break;
        default:
            help();
            process.exitCode = 1;
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
