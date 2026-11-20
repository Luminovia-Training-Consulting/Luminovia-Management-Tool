/**
 * Discover stable components and construct bounded source-bound candidates. Discovery, local application, test reports and promotion are separate; discovery alone installs nothing on the server.
 */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {lstat, mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const REPOSITORY =
    "Luminovia-Training-Consulting/Luminovia-Management-Tool";
export const ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
);
const API = "https://api.github.com";
const BACKEND = "deploy/hostinger/selfhost/compose.yml";
const WEB = "deploy/hostinger/compose.yml";
export const SDK_FILES = [
    "supabase/functions/accounts/index.ts",
    "supabase/functions/files/index.ts",
    "supabase/functions/invite-lecturer/index.ts",
];
export const FILE_TYPE_SOURCE = "supabase/functions/files/validation.ts";
export const JOSE_SOURCE = "deploy/hostinger/selfhost/runtime/index.ts";
export const PG_PROOF =
    "deploy/hostinger/selfhost/postgres-candidate-proof.json";
export const PG_POLICY = {
    service: "db",
    file: BACKEND,
    image: "supabase/postgres",
};
export const NODE_VERSION = ".node-version";
export const ALLOWED_FILES = new Set([
    "package.json",
    "package-lock.json",
    BACKEND,
    WEB,
    ...SDK_FILES,
    FILE_TYPE_SOURCE,
    JOSE_SOURCE,
    PG_PROOF,
    NODE_VERSION,
]);
export const IMAGE_POLICIES = [
    {
        service: "auth",
        release: "supabase/auth",
        image: "supabase/gotrue",
        prefix: "v",
        file: BACKEND,
    },
    {
        service: "rest",
        release: "PostgREST/postgrest",
        image: "postgrest/postgrest",
        prefix: "v",
        file: BACKEND,
    },
    {
        service: "realtime",
        release: "supabase/realtime",
        image: "supabase/realtime",
        prefix: "v",
        file: BACKEND,
    },
    {
        service: "storage",
        release: "supabase/storage",
        image: "supabase/storage-api",
        prefix: "v",
        file: BACKEND,
    },
    {
        service: "functions",
        release: "supabase/edge-runtime",
        image: "supabase/edge-runtime",
        prefix: "v",
        file: BACKEND,
    },
    {
        service: "api-gw",
        release: "envoyproxy/envoy",
        image: "envoyproxy/envoy",
        prefix: "v",
        file: BACKEND,
    },
    {
        service: "mailpit",
        release: "axllent/mailpit",
        image: "axllent/mailpit",
        prefix: "v",
        file: BACKEND,
    },
    {
        service: "web",
        release: "caddyserver/caddy",
        image: "library/caddy",
        prefix: "v",
        imagePrefix: "",
        suffix: "-alpine",
        file: WEB,
    },
    {
        service: "clamav",
        release: "Cisco-Talos/clamav",
        image: "clamav/clamav",
        prefix: "clamav-",
        imagePrefix: "",
        file: WEB,
    },
];
// Compute SHA-256 so comparisons bind exact bytes, not only version labels.
export const sha = (data) => createHash("sha256").update(data).digest("hex");
// Accept stable numeric release versions without prerelease/development labels.
export const stableVersion = (value) =>
    typeof value === "string" && /^\d+\.\d+(?:\.\d+){0,2}$/.test(value);
// Compare numeric version components under the bounded update policy.
export const compareVersions = (left, right) => {
    const a = left.split(".").map(Number),
        b = right.split(".").map(Number);
    for (let index = 0; index < Math.max(a.length, b.length); index++)
        if ((a[index] ?? 0) !== (b[index] ?? 0))
            return (a[index] ?? 0) - (b[index] ?? 0);
    return 0;
};

// Run a local maintenance command in the candidate checkout and preserve failure status.
function command(root, executable, args) {
    try {
        return execFileSync(executable, args, {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 12 * 1024 * 1024,
        }).trim();
    } catch {
        throw new Error(
            "Maintenance command failed; private command output withheld.",
        );
    }
}

// Save the machine-readable maintenance result to the requested output path.
async function save(file, value) {
    await mkdir(dirname(resolve(file)), {recursive: true});
    await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

// Group coupled packages into one update candidate; Vitest and its coverage provider must remain compatible.
export function packageGroup(name) {
    if (name === "vitest" || name.startsWith("@vitest/")) return "vitest";
    if (name.startsWith("@fullcalendar/")) return "fullcalendar";
    if (name.startsWith("@tiptap/")) return "tiptap";
    if (["react", "react-dom", "@types/react", "@types/react-dom"].includes(name))
        return "react";
    if (["tailwindcss", "@tailwindcss/vite"].includes(name)) return "tailwind";
    if (
        [
            "eslint",
            "@eslint/js",
            "typescript-eslint",
            "eslint-plugin-react-hooks",
            "eslint-plugin-react-refresh",
        ].includes(name)
    )
        return "eslint";
    return name;
}

// Read bounded upstream metadata; use only successfully parsed JSON for discovery.
export async function fetchJSON(
    url,
    {github = false, limit = 4 * 1024 * 1024} = {},
) {
    const headers = {
        Accept: "application/json",
        "User-Agent": "Luminovia-Daily-Maintenance/1",
    };
    if (github) {
        headers["X-GitHub-Api-Version"] = "2026-03-10";
        if (process.env.GH_TOKEN)
            headers.Authorization = "Bearer " + process.env.GH_TOKEN;
    }
    const response = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
    });
    assert(response.ok, "Official upstream metadata request failed.");
    const text = await response.text();
    assert(
        Buffer.byteLength(text) <= limit,
        "Upstream metadata exceeded its bound.",
    );
    return JSON.parse(text);
}

// Read declared image pins from Compose source rather than inventing mutable tags.
export function composeImages(text) {
    const result = new Map();
    let service;
    for (const line of text.split("\n")) {
        const key = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
        if (key) service = key[1];
        const value = /^ {4}image:\s*([^\s#]+)\s*$/.exec(line);
        if (value) {
            assert(
                service && /^[A-Za-z0-9._/:+-]+@sha256:[a-f0-9]{64}$/.test(value[1]),
                "Existing image must be immutable.",
            );
            result.set(service, value[1]);
        }
    }
    return result;
}

// Discover stable candidates from registry/upstream metadata within the configured compatibility limits.
export async function discover(root = ROOT, metadata = fetchJSON) {
    const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    const plan = {
        schemaVersion: 1,
        repository: REPOSITORY,
        baseCommit: command(root, "git", ["rev-parse", "HEAD"]),
        checkedAt: new Date().toISOString(),
        components: [],
        held: [],
        observations: [],
    };
    const groups = new Map();
    for (const section of ["dependencies", "devDependencies", "overrides"]) {
        for (const [name, from] of Object.entries(pkg[section] ?? {})) {
            assert(
                /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name) && stableVersion(from),
                "Dependencies must have exact stable versions.",
            );
            try {
                const latest = await metadata(
                    "https://registry.npmjs.org/" + encodeURIComponent(name) + "/latest",
                );
                assert(
                    latest.name === name && stableVersion(latest.version),
                    "npm latest must be a stable package version.",
                );
                plan.observations.push({
                    component: "npm:" + name,
                    current: from,
                    latest: latest.version,
                });
                if (compareVersions(latest.version, from) > 0) {
                    const key = packageGroup(name);
                    if (!groups.has(key)) groups.set(key, []);
                    groups
                        .get(key)
                        .push({kind: "npm", section, name, from, to: latest.version});
                }
            } catch {
                plan.held.push({
                    component: "npm:" + name,
                    reason: "stable_registry_metadata_unavailable",
                });
            }
        }
    }
    for (const [label, changes] of groups)
        plan.components.push({
            id: "npm-" + sha(label).slice(0, 16),
            kind: "npm",
            label,
            changes,
        });
    // Refresh compatible transitive ranges even when direct versions did not move.
    plan.components.push({
        id: "npm-lock",
        kind: "lock",
        label: "compatible npm lockfile updates",
        changes: [],
    });
    const files = new Map();
    for (const file of [BACKEND, WEB])
        files.set(file, composeImages(await readFile(resolve(root, file), "utf8")));
    for (const policy of IMAGE_POLICIES) {
        const current = files.get(policy.file).get(policy.service);
        assert(current, "Required runtime service is missing.");
        try {
            const release = await metadata(
                API + "/repos/" + policy.release + "/releases/latest",
                {github: true},
            );
            assert(
                !release.draft &&
                !release.prerelease &&
                release.tag_name.startsWith(policy.prefix),
                "Expected an official stable release.",
            );
            const version = release.tag_name.slice(policy.prefix.length);
            assert(stableVersion(version), "Unstable image release tag.");
            const tag =
                (policy.imagePrefix ?? policy.prefix) + version + (policy.suffix ?? "");
            const image = await metadata(
                "https://hub.docker.com/v2/repositories/" +
                policy.image +
                "/tags/" +
                tag,
            );
            assert(
                /^sha256:[a-f0-9]{64}$/.test(image.digest) &&
                image.images.some(
                    (entry) => entry.os === "linux" && entry.architecture === "amd64",
                ),
                "Stable image lacks a valid amd64 digest.",
            );
            const pin =
                (policy.image === "library/caddy" ? "caddy" : policy.image) +
                ":" +
                tag +
                "@" +
                image.digest;
            plan.observations.push({
                component: "docker:" + policy.service,
                current,
                latest: pin,
                source: release.html_url,
            });
            const currentDigest = current.split("@")[1];
            const alreadyCurrent =
                image.digest === currentDigest ||
                image.images.some(
                    (entry) =>
                        entry.os === "linux" &&
                        entry.architecture === "amd64" &&
                        entry.digest === currentDigest,
                );
            if (!alreadyCurrent)
                plan.components.push({
                    id: "docker-" + policy.service,
                    kind: "image",
                    label: policy.service,
                    changes: [
                        {
                            kind: "image",
                            file: policy.file,
                            service: policy.service,
                            from: current,
                            to: pin,
                        },
                    ],
                });
        } catch {
            plan.held.push({
                component: "docker:" + policy.service,
                reason: "official_stable_image_metadata_unavailable",
            });
        }
    }
    // Future engines need genuine fresh actual-backup restoration, extension/index
    // and catalog-collation checks. Never relabel the17.12 evidence as a new image.
    try {
        const releases = await metadata(
            API + "/repos/supabase/postgres/releases?per_page=100",
            {github: true},
        );
        const stable = releases.filter(
            (item) => !item.draft && !item.prerelease && stableVersion(item.tag_name),
        );
        stable.sort((a, b) =>
            b.tag_name.localeCompare(a.tag_name, undefined, {numeric: true}),
        );
        const sameMajor = stable.find((item) => item.tag_name.startsWith("17."));
        const current = files.get(BACKEND).get("db");
        assert(sameMajor, "No production PostgreSQL17 release found.");
        plan.observations.push({
            component: "docker:db",
            current,
            latestStableRelease: sameMajor.tag_name,
            source: sameMajor.html_url,
        });
        const tag = await metadata(
            "https://hub.docker.com/v2/repositories/supabase/postgres/tags/" +
            sameMajor.tag_name,
        );
        assert(/^sha256:[a-f0-9]{64}$/.test(tag.digest));
        if (!current.endsWith("@" + tag.digest))
            plan.components.push({
                id: "docker-db",
                kind: "image",
                label: "PostgreSQL17 guarded data upgrade",
                requiresLiveDataPreflight: true,
                changes: [
                    {
                        kind: "image",
                        file: BACKEND,
                        service: "db",
                        from: current,
                        to: "supabase/postgres:" + sameMajor.tag_name + "@" + tag.digest,
                    },
                ],
            });
        if (stable[0] && !stable[0].tag_name.startsWith("17."))
            plan.held.push({
                component: "docker:db-major",
                candidate: stable[0].tag_name,
                reason: "requires_non_destructive_major_migration_path",
            });
    } catch {
        plan.held.push({
            component: "docker:db",
            reason: "official_postgres_metadata_unavailable",
        });
    }
    try {
        const text = await readFile(resolve(root, JOSE_SOURCE), "utf8");
        const from = /jsr:@panva\/jose@(\d+(?:\.\d+){0,2})/.exec(text)?.[1];
        const registry = await metadata("https://jsr.io/@panva/jose/meta.json");
        assert(
            from &&
            stableVersion(registry.latest) &&
            !registry.versions?.[registry.latest]?.yanked,
        );
        plan.observations.push({
            component: "jsr:@panva/jose",
            current: from,
            latest: registry.latest,
        });
        if (
            from !== registry.latest &&
            (from.split(".").length < 3 || compareVersions(registry.latest, from) > 0)
        )
            plan.components.push({
                id: "jsr-jose",
                kind: "jsr",
                label: "@panva/jose",
                changes: [
                    {kind: "jsr", file: JOSE_SOURCE, from, to: registry.latest},
                ],
            });
    } catch {
        plan.held.push({
            component: "jsr:@panva/jose",
            reason: "stable_jsr_metadata_unavailable",
        });
    }
    try {
        const current = (
            await readFile(resolve(root, NODE_VERSION), "utf8")
        ).trim();
        assert(/^\d+\.\d+\.\d+$/.test(current));
        const releases = await metadata("https://nodejs.org/dist/index.json", {
            limit: 8 * 1024 * 1024,
        });
        const versions = releases
            .map((item) => item.version)
            .filter((version) => /^v\d+\.\d+\.\d+$/.test(version))
            .map((version) => version.slice(1))
            .sort((a, b) => compareVersions(b, a));
        assert(versions.length > 0);
        plan.observations.push({
            component: "node:build",
            current,
            latest: versions[0],
            source: "https://nodejs.org/dist/index.json",
        });
        if (compareVersions(versions[0], current) > 0)
            plan.components.push({
                id: "node-build",
                kind: "node",
                label: "Node build compiler",
                changes: [
                    {kind: "node", file: NODE_VERSION, from: current, to: versions[0]},
                ],
            });
    } catch {
        plan.held.push({
            component: "node:build",
            reason: "official_stable_node_metadata_unavailable",
        });
    }
    assert(
        plan.components.length <= 128,
        "Maintenance candidate count exceeds bound.",
    );
    return plan;
}

// Validate the full plan, source base and permitted components before local changes.
export function validatePlan(plan) {
    assert(
        plan.schemaVersion === 1 &&
        plan.repository === REPOSITORY &&
        /^[a-f0-9]{40}$/.test(plan.baseCommit),
        "Invalid maintenance plan identity.",
    );
    assert(Array.isArray(plan.components) && plan.components.length <= 128);
    const ids = new Set();
    for (const item of plan.components) {
        assert(
            /^[a-z0-9-]{1,64}$/.test(item.id) &&
            !ids.has(item.id) &&
            ["npm", "image", "lock", "jsr", "node"].includes(item.kind),
        );
        ids.add(item.id);
        for (const change of item.changes) {
            if (change.kind === "npm")
                assert(
                    ["dependencies", "devDependencies", "overrides"].includes(
                        change.section,
                    ) &&
                    /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(change.name) &&
                    stableVersion(change.from) &&
                    stableVersion(change.to),
                );
            else if (change.kind === "node")
                assert(
                    change.file === NODE_VERSION &&
                    /^\d+\.\d+\.\d+$/.test(change.from) &&
                    /^\d+\.\d+\.\d+$/.test(change.to) &&
                    compareVersions(change.to, change.from) > 0,
                );
            else if (change.kind === "jsr")
                assert(
                    change.file === JOSE_SOURCE &&
                    /^\d+(?:\.\d+){0,2}$/.test(change.from) &&
                    stableVersion(change.to),
                );
            else {
                const policy =
                    change.service === "db"
                        ? PG_POLICY
                        : IMAGE_POLICIES.find((entry) => entry.service === change.service);
                assert(
                    change.kind === "image" && policy && policy.file === change.file,
                );
                assert(
                    /^[A-Za-z0-9._/:+-]+@sha256:[a-f0-9]{64}$/.test(change.from) &&
                    /^[A-Za-z0-9._/:+-]+@sha256:[a-f0-9]{64}$/.test(change.to),
                );
                const imageName =
                    policy.image === "library/caddy" ? "caddy" : policy.image;
                assert(
                    change.to.startsWith(imageName + ":"),
                    "Candidate image publisher changed.",
                );
                if (change.service === "db")
                    assert(
                        item.requiresLiveDataPreflight === true &&
                        /^supabase\/postgres:17\.\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/.test(
                            change.to,
                        ),
                        "Only same-major productionPG candidates may enter guarded tests.",
                    );
            }
        }
    }
}

// Apply only selected validated components and let package resolution update the real lockfile.
export async function applyPlan(plan, ids, root = ROOT, run = command) {
    validatePlan(plan);
    assert.equal(
        command(root, "git", ["rev-parse", "HEAD"]),
        plan.baseCommit,
        "Candidate base changed.",
    );
    const selected = ids.map((id) => {
        const value = plan.components.find((item) => item.id === id);
        assert(value, "Unknown component.");
        return value;
    });
    const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    let npm = selected.some((item) => item.kind === "lock");
    let manifestChanged = false;
    for (const item of selected) {
        for (const change of item.changes) {
            if (change.kind === "npm") {
                assert.equal(
                    pkg[change.section]?.[change.name],
                    change.from,
                    "npm source version changed.",
                );
                pkg[change.section][change.name] = change.to;
                npm = true;
                manifestChanged = true;
                const imports =
                    change.name === "@supabase/supabase-js"
                        ? SDK_FILES
                        : change.name === "file-type"
                            ? [FILE_TYPE_SOURCE]
                            : [];
                for (const file of imports) {
                    const text = await readFile(resolve(root, file), "utf8");
                    const previous = "npm:" + change.name + "@" + change.from;
                    assert(
                        text.includes(previous),
                        "Edge SDK pin no longer matches frontend SDK.",
                    );
                    await writeFile(
                        resolve(root, file),
                        text.replaceAll(previous, "npm:" + change.name + "@" + change.to),
                    );
                }
            } else if (change.kind === "node") {
                assert.equal(
                    (await readFile(resolve(root, NODE_VERSION), "utf8")).trim(),
                    change.from,
                    "Node compiler source version changed.",
                );
                await writeFile(resolve(root, NODE_VERSION), change.to + "\n");
            } else if (change.kind === "jsr") {
                const file = resolve(root, JOSE_SOURCE),
                    text = await readFile(file, "utf8"),
                    from = "jsr:@panva/jose@" + change.from;
                assert.equal(text.split(from).length, 2, "JSR source pin changed.");
                await writeFile(
                    file,
                    text.replace(from, "jsr:@panva/jose@" + change.to),
                );
            } else {
                const file = resolve(root, change.file);
                const text = await readFile(file, "utf8");
                assert.equal(
                    text.split(change.from).length,
                    2,
                    "Candidate Compose image source changed.",
                );
                await writeFile(file, text.replace(change.from, change.to));
            }
        }
    }
    if (manifestChanged)
        await writeFile(
            resolve(root, "package.json"),
            JSON.stringify(pkg, null, 2) + "\n",
        );
    if (npm)
        run(root, "npm", [
            "update",
            "--package-lock-only",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
        ]);
    return changedFiles(root);
}

// Read the actual Git diff for bounded promotion.
export function changedFiles(root = ROOT) {
    const names = command(root, "git", ["diff", "--name-only", "--no-renames"])
        .split("\n")
        .filter(Boolean);
    names.push(
        ...command(root, "git", ["ls-files", "--others", "--exclude-standard"])
            .split("\n")
            .filter(Boolean),
    );
    assert(
        names.every((file) => ALLOWED_FILES.has(file)),
        "Candidate changed a file outside its allowlist.",
    );
    return names;
}

// Bind candidate changes to their plan, base commit and actual test status.
export async function exportCandidate(plan, component, status, root = ROOT) {
    validatePlan(plan);
    assert(
        component === "combined" ||
        plan.components.some((item) => item.id === component),
    );
    assert(["passed", "failed"].includes(status));
    const result = {
        schemaVersion: 1,
        repository: REPOSITORY,
        baseCommit: plan.baseCommit,
        component,
        status,
        files: [],
    };
    if (status === "passed")
        for (const path of changedFiles(root)) {
            const state = await lstat(resolve(root, path));
            assert(
                state.isFile() &&
                !state.isSymbolicLink() &&
                state.size <= 8 * 1024 * 1024,
            );
            const bytes = await readFile(resolve(root, path));
            let base;
            try {
                base = execFileSync("git", ["show", plan.baseCommit + ":" + path], {
                    cwd: root,
                    stdio: ["ignore", "pipe", "pipe"],
                    maxBuffer: 12 * 1024 * 1024,
                });
            } catch {
                assert.equal(
                    path,
                    PG_PROOF,
                    "Only a generated PG proof may be a new source file.",
                );
            }
            result.files.push({
                path,
                contents: bytes.toString("base64"),
                sha256: sha(bytes),
                baseSha256: base === undefined ? null : sha(base),
            });
        }
    return result;
}

// Hash migration files in their required order.
export async function migrationInventory(root = ROOT) {
    const directory = resolve(root, "supabase/migrations"),
        items = [];
    for (const name of (await readdir(directory))
        .filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file))
        .sort())
        items.push({
            path: "supabase/migrations/" + name,
            sha256: sha(await readFile(resolve(directory, name))),
        });
    assert(items.length > 0, "Missing candidate migration history.");
    return items;
}

// Bind the complete migration inventory to one reproducible digest.
export async function migrationInventorySha256(root = ROOT) {
    return sha(JSON.stringify(await migrationInventory(root)));
}

// Validate native PostgreSQL candidate proof, including major version, source and completed acceptance conditions.
export function validatePgProof(proof) {
    assert(
        proof.schemaVersion === 1 &&
        proof.postgresMajor === 17 &&
        proof.requiresLiveDataPreflight === true &&
        /^[a-f0-9]{40}$/.test(proof.sourceCommit) &&
        /^[a-f0-9]{64}$/.test(proof.migrationInventorySha256),
        "Invalid generated PG proof identity.",
    );
    const inventory = proof.migrationInventory;
    assert(
        Array.isArray(inventory) &&
        inventory.length > 0 &&
        inventory.length <= 10000 &&
        inventory.every(
            (entry, index) =>
                entry !== null &&
                typeof entry === "object" &&
                JSON.stringify(Object.keys(entry).sort()) ===
                JSON.stringify(["path", "sha256"]) &&
                /^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(entry.path) &&
                /^[a-f0-9]{64}$/.test(entry.sha256) &&
                (index === 0 || inventory[index - 1].path < entry.path),
        ) &&
        proof.migrationInventorySha256 === sha(JSON.stringify(inventory)),
        "PG proof requires an exact sorted migration inventory bound to its digest.",
    );
    for (const key of ["sourceImage", "targetImage"])
        assert(
            /^supabase\/postgres:17\.\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/.test(
                proof[key],
            ),
            "PG proof must describe same-major immutable production images.",
        );
    assert(
        proof.sourceImage !== proof.targetImage &&
        proof.validation?.kind === "isolated-selfhost-upgrade-fixture",
    );
    for (const key of [
        "passed",
        "migrationSourcesExact",
        "existingCredentialsAndFileExact",
        "roleAndMembershipExact",
    ])
        assert(
            proof.validation[key] === true,
            "PG proof lacks completed retained-data checks.",
        );
}

// Capture only completed source-bound PostgreSQL proof into the candidate.
export async function capturePgProof(plan, input, root = ROOT) {
    const change = plan.components.find((item) => item.id === "docker-db")
        ?.changes[0];
    if (!change) return;
    const actual = composeImages(
        await readFile(resolve(root, BACKEND), "utf8"),
    ).get("db");
    if (actual === change.from) return;
    assert.equal(actual, change.to, "Unplanned PG target.");
    const proof = JSON.parse(await readFile(input, "utf8"));
    validatePgProof(proof);
    assert.equal(proof.sourceImage, change.from);
    assert.equal(proof.targetImage, change.to);
    assert.equal(proof.sourceCommit, plan.baseCommit);
    assert.deepEqual(
        proof.migrationInventory,
        await migrationInventory(root),
        "PG proof migration sources differ from the candidate.",
    );
    await save(resolve(root, PG_PROOF), proof);
}

// Read available component reports from the result directory.
async function resultsIn(directory) {
    const results = [];
    let entries;
    try {
        entries = await readdir(directory, {withFileTypes: true});
    } catch (error) {
        if (error.code === "ENOENT") return results;
        throw error;
    }
    for (const entry of entries) {
        if (entry.isDirectory())
            results.push(...(await resultsIn(resolve(directory, entry.name))));
        else if (entry.name === "result.json")
            results.push(
                JSON.parse(await readFile(resolve(directory, entry.name), "utf8")),
            );
    }
    return results;
}

// Select only components whose required checks actually passed.
export function passedComponents(plan, results, {firstOnly = false} = {}) {
    validatePlan(plan);
    assert(Array.isArray(results) && results.length <= 128);
    const accepted = plan.components
        .filter((item) =>
            results.some(
                (result) =>
                    result.schemaVersion === 1 &&
                    result.repository === REPOSITORY &&
                    result.baseCommit === plan.baseCommit &&
                    result.component === item.id &&
                    result.status === "passed" &&
                    Array.isArray(result.files) &&
                    result.files.length > 0,
            ),
        )
        .map((item) => item.id);
    return firstOnly ? accepted.slice(0, 1) : accepted;
}

// Combine passed candidates from the same source base into a reviewable patch.
export async function assembleCandidates(
    plan,
    results,
    {firstOnly = false, root = ROOT, run = command} = {},
) {
    const accepted = passedComponents(plan, results, {firstOnly});
    const names = await applyPlan(plan, accepted, root, run);
    return {accepted, names};
}

// Handle only documented subcommands and propagate failures as a failed process exit.
async function cli() {
    const [operation, ...args] = process.argv.slice(2);
    const options = {};
    assert(args.length % 2 === 0);
    for (let index = 0; index < args.length; index += 2) {
        assert(/^--[a-z-]+$/.test(args[index]) && !(args[index] in options));
        options[args[index]] = args[index + 1];
    }
    if (operation === "scan") {
        const plan = await discover();
        await save(options["--output"], plan);
        if (process.env.GITHUB_OUTPUT)
            await writeFile(
                process.env.GITHUB_OUTPUT,
                "base=" +
                plan.baseCommit +
                "\nhas_candidates=" +
                (plan.components.length > 0) +
                "\nmatrix=" +
                JSON.stringify({
                    include: plan.components.map((item) => ({id: item.id})),
                }) +
                "\n",
                {flag: "a"},
            );
        console.log(
            JSON.stringify({candidates: plan.components.length, held: plan.held}),
        );
        return;
    }
    const plan = JSON.parse(await readFile(options["--plan"], "utf8"));
    validatePlan(plan);
    if (operation === "capture-proof")
        await capturePgProof(plan, options["--input"]);
    else if (operation === "apply") {
        const names = await applyPlan(plan, [options["--component"]]);
        if (process.env.GITHUB_OUTPUT)
            await writeFile(
                process.env.GITHUB_OUTPUT,
                "changed=" + (names.length > 0) + "\n",
                {flag: "a"},
            );
    } else if (operation === "export")
        await save(
            options["--output"],
            await exportCandidate(
                plan,
                options["--component"],
                options["--status"] ?? "passed",
            ),
        );
    else if (operation === "assemble") {
        const results = await resultsIn(options["--results"]);
        assert(
            options["--selection"] === undefined ||
            options["--selection"] === "first",
        );
        const firstOnly = options["--selection"] === "first";
        const {accepted, names} = await assembleCandidates(plan, results, {
            firstOnly,
        });
        if (process.env.GITHUB_OUTPUT)
            await writeFile(
                process.env.GITHUB_OUTPUT,
                "changed=" + (names.length > 0) + "\n",
                {flag: "a"},
            );
        if (process.env.GITHUB_STEP_SUMMARY)
            await writeFile(
                process.env.GITHUB_STEP_SUMMARY,
                "Daily stable candidates: " +
                plan.components.length +
                (firstOnly
                    ? ". Isolated fallback selection: "
                    : ". Accepted combination: ") +
                accepted.length +
                ". Held/failed/unselected components: " +
                JSON.stringify([
                    ...plan.held,
                    ...plan.components
                        .filter((item) => !accepted.includes(item.id))
                        .map((item) => ({
                            component: item.label,
                            reason: firstOnly
                                ? "not_selected_for_isolated_fallback"
                                : "candidate_checks_did_not_pass_or_no_change",
                        })),
                ]) +
                "\n",
                {flag: "a"},
            );
    } else throw new Error("Unknown maintenance operation.");
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    cli().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });