/**
 * Manages the versioned local ClamAV container on its owned internal network.
 * Only the matching project owner may stop or replace it; signature data remain persistent.
 */
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,} from "node:fs";
import {resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {networkName} from "./runtime-network.mjs";

// Use the same digest updated by self-host maintenance for disposable acceptance.
const composePath = new URL("../deploy/hostinger/compose.yml", import.meta.url);
const image = /^ {2}clamav:\r?\n {4}image: (clamav\/clamav@sha256:[a-f0-9]{64})\r?$/m.exec(
    readFileSync(composePath, "utf8"),
)?.[1];
if (!image) throw new Error("The self-host ClamAV image must be digest-pinned.");
// Version the owned container configuration so fixes also reach an existing local stack.
const configVersion = "5";
const configLabel = "org.luminovia.portal.scanner-config";
const healthCommand = "clamdscan --config-file=/etc/clamav/clamd.conf --ping=1";
const project = /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m.exec(
    readFileSync("supabase/config.toml", "utf8"),
)?.[1];
if (!project) throw new Error("A safe local Supabase project ID is required.");
const container = `portal_scanner_${project}`;
/** Runs the bounded local Docker command; optional inspections may return null for absent resources. */
const docker = (args, quiet = false) => {
    try {
        return execFileSync("docker", args, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 16 * 1024 * 1024,
        }).trim();
    } catch (error) {
        if (quiet) return null;
        throw new Error(
            `Scanner Docker operation failed (${args[0]}). Check Docker and the local scanner logs.`,
            {cause: error},
        );
    }
};
/** Reads the actual state of the project-named scanner container only. */
const inspect = () => {
    const raw = docker(["inspect", container], true);
    return raw ? JSON.parse(raw)[0] : null;
};

/** Preserve unrelated service entries from the verified file descriptor. */
function readServices(path) {
    let descriptor;
    try {
        descriptor = openSync(
            path,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
    try {
        const info = fstatSync(descriptor);
        if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1)
            throw new Error("Scanner services must be an owned regular file.");
        return readFileSync(descriptor, "utf8")
            .split("\n")
            .filter((line) => line && !line.startsWith("PORTAL_CLAMAV_"));
    } finally {
        closeSync(descriptor);
    }
}

/** Replace the directory entry atomically after writing an exclusive temporary file. */
function writeScannerFile(path, content, mode) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const descriptor = openSync(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        mode,
    );
    try {
        try {
            fchmodSync(descriptor, mode);
            writeFileSync(descriptor, content);
        } finally {
            closeSync(descriptor);
        }
        renameSync(temporary, path);
    } catch (error) {
        unlinkSync(temporary);
        throw error;
    }
}

const action = process.argv[2] ?? "status";
if (action === "status") {
    const state = inspect();
    console.log(
        state?.State?.Running
            ? `ClamAV scanner running (${state.State.Health?.Status ?? "health unavailable"}; internal network only).`
            : "ClamAV scanner stopped.",
    );
} else if (action === "stop") {
    const state = inspect();
    if (state) {
        if (state.Config.Labels?.["org.luminovia.portal"] !== project)
            throw new Error("Refusing to stop an unowned scanner.");
        docker(["stop", "--time", "20", container], true);
        docker(["rm", container]);
    }
    console.log("Scanner stopped; signature database is preserved.");
} else if (action === "start") {
    mkdirSync(".local", {recursive: true, mode: 0o700});
    const directory = openSync(
        ".local",
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
        if (fstatSync(directory).uid !== process.getuid())
            throw new Error("Scanner state directory must belong to the current user.");
        fchmodSync(directory, 0o700);
        await start(`/proc/self/fd/${directory}`);
    } finally {
        closeSync(directory);
    }
} else throw new Error("Use local-scanner.mjs start, status or stop.");

async function start(runtime) {
    let state = inspect();
    if (state && state.Config.Labels?.["org.luminovia.portal"] !== project)
        throw new Error("Scanner container name belongs to another service.");
    if (
        state &&
        (state.Config.Image !== image ||
            state.Config.Labels?.[configLabel] !== configVersion)
    ) {
        if (state.State.Running) docker(["stop", container]);
        docker(["rm", container]);
        state = null;
    }
    if (!state) {
        const database = JSON.parse(
            docker(["inspect", `supabase_db_${project}`]),
        )[0];
        const network = Object.keys(database.NetworkSettings.Networks).find(
            (name) => name === networkName(project),
        );
        if (!network)
            throw new Error("Start the local Supabase stack before the scanner.");
        // Foreground output goes to Docker logs. A log file survives a same-container
        // restart with entrypoint-dependent ownership and can prevent clamd startup.
        const config = `Foreground yes\nUser clamav\nLocalSocket /tmp/clamd.sock\nTCPSocket 3310\nTCPAddr 0.0.0.0\nDatabaseDirectory /var/lib/clamav\nLogTime yes\nStreamMaxLength 100M\nMaxScanSize 300M\nMaxFileSize 100M\nMaxRecursion 10\nMaxFiles 1000\nAlertExceedsMax yes\nAlertEncryptedArchive yes\nAlertEncryptedDoc yes\nHeuristicAlerts yes\nScanArchive yes\nScanPDF yes\nScanOLE2 yes\nScanXMLDOCS yes\n`;
        writeScannerFile(`${runtime}/clamd.conf`, config, 0o644);
        docker(["volume", "create", "--label", `org.luminovia.portal=${project}`, `portal_clamav_${project}`]);
        console.log(
            "Preparing the pinned ClamAV image and persistent signatures (first start can take a few minutes).",
        );
        docker([
            "create",
            "--name",
            container,
            "--label",
            `org.luminovia.portal=${project}`,
            "--label",
            `${configLabel}=${configVersion}`,
            "--network",
            network,
            "--memory",
            "4g",
            "--security-opt",
            "no-new-privileges:true",
            "--health-cmd",
            healthCommand,
            "--health-interval",
            "10s",
            "--health-timeout",
            "5s",
            "--health-start-period",
            "180s",
            "--health-retries",
            "3",
            "--mount",
            `type=volume,src=portal_clamav_${project},dst=/var/lib/clamav`,
            "--mount",
            `type=bind,src=${resolve(".local/clamd.conf")},dst=/etc/clamav/clamd.conf,readonly`,
            "--env",
            "CLAMD_STARTUP_TIMEOUT=180",
            "--env",
            "TZ=UTC",
            image,
        ]);
    }
    state = inspect();
    if (!state.State.Running) docker(["start", container]);
    const deadline = Date.now() + 180_000;
    let ready = false;
    while (Date.now() < deadline) {
        if (
            docker(
                [
                    "exec",
                    container,
                    "clamdscan",
                    "--config-file=/etc/clamav/clamd.conf",
                    "--ping=1",
                ],
                true,
            ) !== null &&
            inspect()?.State.Health?.Status === "healthy"
        ) {
            ready = true;
            break;
        }
        await delay(2000);
    }
    if (!ready)
        throw new Error(
            "ClamAV is not ready. Files remain quarantined. Inspect the scanner container logs.",
        );
    const envPath = `${runtime}/services.env`;
    const previous = readServices(envPath);
    writeScannerFile(
        envPath,
        [
            ...previous,
            `PORTAL_CLAMAV_HOST=${container}`,
            "PORTAL_CLAMAV_PORT=3310",
            "",
        ].join("\n"),
        0o600,
    );
    console.log(
        "ClamAV is ready. Its TCP endpoint is not published to the host.",
    );
}
