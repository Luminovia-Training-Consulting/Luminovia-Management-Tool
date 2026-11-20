import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync,} from "node:fs";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {prPreviewConfig} from "./runtime-github-config.mjs";
import {runtimeSnapshotSource} from "./runtime-snapshot.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const positive = (value) => Number.isSafeInteger(value) && value > 0;

function owned(path, directory = false) {
    const info = lstatSync(path);
    if (
        info.isSymbolicLink() ||
        info.uid !== process.getuid() ||
        (directory ? !info.isDirectory() : !info.isFile())
    )
        throw new Error("Unowned or symlinked PR preview material refused.");
    return info;
}

function inspectPrivate(path) {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || info.uid !== process.getuid())
        throw new Error("Unowned or symlinked PR runtime state refused.");
    if (info.isDirectory())
        for (const name of readdirSync(path)) inspectPrivate(join(path, name));
}

export function preparePackagedPreview(packageDirectory) {
    const directory = realpathSync(packageDirectory);
    owned(directory, true);
    const manifestPath = join(directory, "manifest.json");
    owned(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
        manifest.version !== 1 ||
        manifest.kind !== "local-pr-preview" ||
        manifest.hosted !== false ||
        !positive(manifest.pull_request) ||
        !positive(manifest.run_id) ||
        !positive(manifest.run_attempt) ||
        !sha.test(manifest.source_head) ||
        !sha.test(manifest.tested_revision) ||
        !digest.test(manifest.archive_sha256) ||
        !digest.test(manifest.source_config_sha256)
    )
        throw new Error("Invalid exact-source local preview manifest.");
    const archive = join(directory, "portal-source.tar.gz");
    owned(archive);
    if (hash(readFileSync(archive)) !== manifest.archive_sha256)
        throw new Error("The local preview archive checksum changed.");
    const canonical = join(directory, "portal");
    owned(canonical, true);
    owned(join(canonical, "supabase"), true);
    const canonicalConfig = join(canonical, "supabase/config.toml");
    owned(canonicalConfig);
    const original = readFileSync(canonicalConfig, "utf8");
    if (
        hash(original) !== manifest.source_config_sha256 ||
        existsSync(join(canonical, ".local")) ||
        existsSync(join(canonical, ".env.test.local"))
    )
        throw new Error(
            "The extracted source must remain pristine; use the packaged preview launcher.",
        );
    const project = `luminovia-portal-pr-${manifest.pull_request}-${hash(`${directory}:${manifest.tested_revision}`).slice(0, 12)}`;
    const config = prPreviewConfig(original, project);
    const base = join(directory, ".preview");
    const source = join(base, "source");
    const owner = {
        version: 1,
        directory,
        archive: manifest.archive_sha256,
        tested_revision: manifest.tested_revision,
        source_head: manifest.source_head,
        project,
        config: hash(config),
    };
    if (!existsSync(base)) {
        mkdirSync(base, {mode: 0o700});
        try {
            cpSync(canonical, source, {
                recursive: true,
                force: false,
                errorOnExist: true,
                filter: (path) => runtimeSnapshotSource(path, canonical),
            });
            owned(join(source, "scripts"), true);
            owned(join(source, "scripts/runtime-cli.mjs"));
            writeFileSync(join(source, "supabase/config.toml"), config, {
                mode: 0o600,
            });
            writeFileSync(join(base, "owner.json"), JSON.stringify(owner) + "\n", {
                flag: "wx",
                mode: 0o600,
            });
        } catch (error) {
            // This process exclusively created the directory; no pre-existing source
            // or application volume is ever removed during an unsuccessful setup.
            rmSync(base, {recursive: true, force: true});
            throw error;
        }
    } else {
        owned(base, true);
        owned(join(base, "owner.json"));
        if (
            JSON.stringify(
                JSON.parse(readFileSync(join(base, "owner.json"), "utf8")),
            ) !== JSON.stringify(owner)
        )
            throw new Error(
                "PR preview directory belongs to another source or location.",
            );
    }
    owned(source, true);
    owned(join(source, "scripts"), true);
    owned(join(source, "scripts/runtime-cli.mjs"));
    owned(join(source, "supabase"), true);
    owned(join(source, "supabase/config.toml"));
    if (hash(readFileSync(join(source, "supabase/config.toml"))) !== owner.config)
        throw new Error(
            "PR runtime identity or ports changed; refusing the preview command.",
        );
    for (const name of [".local", ".env.local", ".env.test.local"])
        if (existsSync(join(source, name))) inspectPrivate(join(source, name));
    return {
        directory,
        source,
        project,
        site: "http://127.0.0.1:5473",
        api: 57321,
        mail: 57324,
    };
}

export async function runPackagedPreview({
                                             packageDirectory,
                                             action = "start",
                                             execute,
                                         } = {}) {
    if (
        !["start", "restart", "stop", "status", "credentials", "prepare"].includes(
            action,
        )
    )
        throw new Error(
            "Use node preview.mjs start|restart|stop|status|credentials|prepare.",
        );
    const preview = preparePackagedPreview(packageDirectory);
    if (action === "prepare") {
        console.log(
            `PR preview prepared: ${preview.site}; private project ${preview.project}. No service was started.`,
        );
        return 0;
    }
    const env = Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) =>
                !/^(SUPABASE_|VITE_|E2E_|PORTAL_|S3_|AWS_|SMTP_|OPENAI_|RESEND_|GH_|GITHUB_|GIT_|DATABASE_URL$|PGPASSWORD$|NPM_TOKEN$|NODE_AUTH_TOKEN$)/.test(
                    key,
                ),
        ),
    );
    const file = process.execPath;
    const args = [join(preview.source, "scripts/runtime-cli.mjs"), action];
    const options = {cwd: preview.source, env, stdio: "inherit"};
    if (execute) return await execute(file, args, options);
    return await new Promise((accept, reject) => {
        const child = spawn(file, args, options);
        child.once("error", () =>
            reject(new Error("The owned PR runtime launcher could not be started.")),
        );
        child.once("close", (code) => accept(code ?? 1));
    });
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    runPackagedPreview({
        packageDirectory: resolve(import.meta.dirname, "../.."),
        action: process.argv[2],
    })
        .then((code) => {
            process.exitCode = code;
        })
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        });