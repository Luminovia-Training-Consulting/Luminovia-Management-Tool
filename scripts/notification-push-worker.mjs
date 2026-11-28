/** Finite server-only standards Web Push worker. No server or browser secret. */
import {lookup} from "node:dns/promises";
import {BlockList, isIP} from "node:net";
import https from "node:https";
import {pathToFileURL} from "node:url";
import * as webPush from "web-push";
import {createECDH} from "node:crypto";

const providers = new Set([
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "web.push.apple.com",
]);
const blocked = new BlockList();
for (const [network, prefix] of [
    ["2001:db8::", 32],
    ["2001::", 32],
    ["2002::", 16],
])
    blocked.addSubnet(network, prefix, "ipv6");
for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["192.0.2.0", 24],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
])
    blocked.addSubnet(network, prefix, "ipv4");

export function publicAddress(address) {
    return isIP(address) === 4
        ? !blocked.check(address, "ipv4")
        : isIP(address) === 6 &&
        /^[23][0-9a-f]{0,3}:/i.test(address) &&
        !blocked.check(address, "ipv6");
}

export function endpointUrl(value) {
    const url = new URL(value);
    if (
        value.length > 2048 ||
        url.protocol !== "https:" ||
        !providers.has(url.hostname) ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname === "/" ||
        /[\s\\]/.test(value)
    )
        throw new Error("push_endpoint_invalid");
    return url;
}

function apiUrl(value) {
    const url = new URL(value);
    if (
        (url.protocol !== "https:" &&
            !(
                url.protocol === "http:" &&
                ["127.0.0.1", "[::1]"].includes(url.hostname)
            )) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !["", "/", "/backend", "/backend/"].includes(url.pathname)
    )
        throw new Error("push_config_invalid");
    return value.replace(/\/$/, "");
}

export function configuration(env) {
    const publicKey = env.PORTAL_PUSH_VAPID_PUBLIC_KEY,
        privateKey = env.PORTAL_PUSH_VAPID_PRIVATE_KEY,
        subject = env.PORTAL_PUSH_VAPID_SUBJECT ?? "mailto:info@luminovia.org";
    if (
        !/^[A-Za-z0-9_-]{87}$/.test(publicKey ?? "") ||
        !/^[A-Za-z0-9_-]{43}$/.test(privateKey ?? "") ||
        !/^mailto:[^\s@]+@[^\s@]+$/.test(subject) ||
        !env.PORTAL_PUSH_SERVICE_KEY ||
        /\s/.test(env.PORTAL_PUSH_SERVICE_KEY)
    )
        throw new Error("push_config_invalid");
    webPush.getVapidHeaders(
        "https://fcm.googleapis.com",
        subject,
        publicKey,
        privateKey,
        "aes128gcm",
    );
    const curve = createECDH("prime256v1");
    curve.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (curve.getPublicKey().toString("base64url") !== publicKey)
        throw new Error("push_key_pair_mismatch");
    return {
        api: apiUrl(env.PORTAL_PUSH_API_URL),
        key: env.PORTAL_PUSH_SERVICE_KEY,
        publicKey,
        privateKey,
        subject,
    };
}

export function genericPayload(row) {
    if (
        !/^[0-9a-f-]{36}$/.test(row.id ?? "") ||
        !/^[0-9a-f-]{36}$/.test(row.device_token ?? "") ||
        !["de", "en"].includes(row.locale)
    )
        throw new Error("push_payload_invalid");
    return JSON.stringify({
        id: row.id,
        token: row.device_token,
        locale: row.locale,
    });
}

export function requestDetails(config, row) {
    endpointUrl(row.subscription.endpoint);
    return webPush.generateRequestDetails(row.subscription, genericPayload(row), {
        vapidDetails: {
            subject: config.subject,
            publicKey: config.publicKey,
            privateKey: config.privateKey,
        },
        TTL: 300,
        contentEncoding: "aes128gcm",
        urgency: "normal",
    });
}

export async function rpc(config, name, payload, signal) {
    if (
        ![
            "lease_notification_push",
            "refresh_push_reminders",
            "prepare_notification_push",
            "finish_notification_push",
        ].includes(name)
    )
        throw new Error("push_rpc_invalid");
    const response = await fetch(`${config.api}/rest/v1/rpc/${name}`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any(
            [signal, AbortSignal.timeout(15000)].filter(Boolean),
        ),
        headers: {
            "content-type": "application/json",
            apikey: config.key,
            authorization: `Bearer ${config.key}`,
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok || !response.body) throw new Error("push_rpc_failed");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (; ;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 65536) {
            await reader.cancel();
            throw new Error("push_rpc_failed");
        }
        chunks.push(part.value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(text);
}

/** Map the provider's delay or UTC HTTP date into the outbox retry bound. */
function retryAfterSeconds(value) {
    if (typeof value !== "string") return null;
    const header = value.trim();
    if (/^\d+$/.test(header)) return Math.min(86400, Number(header));
    const date = new Date(header);
    const seconds = (date.getTime() - Date.now()) / 1000;
    if (!Number.isFinite(seconds) || date.toUTCString() !== header) return null;
    return Math.max(0, Math.min(86400, Math.ceil(seconds)));
}

export async function transmit(
    config,
    row,
    {resolve = lookup, request = https.request, signal} = {},
) {
    let details, url, addresses;
    try {
        details = requestDetails(config, row);
        url = endpointUrl(details.endpoint);
    } catch {
        return {outcome: "failed", code: "endpoint_or_keys_invalid"};
    }
    try {
        const resolutionSignal = AbortSignal.any(
            [signal, AbortSignal.timeout(15000)].filter(Boolean),
        );
        resolutionSignal.throwIfAborted();
        addresses = await new Promise((resolved, rejected) => {
            const abort = () => rejected(new Error("push_resolution_timeout"));
            resolutionSignal.addEventListener("abort", abort, {once: true});
            Promise.resolve(resolve(url.hostname, {all: true}))
                .then(resolved, rejected)
                .finally(() => resolutionSignal.removeEventListener("abort", abort));
        });
        resolutionSignal.throwIfAborted();
        if (
            !addresses.length ||
            addresses.some(({address}) => !publicAddress(address))
        )
            return {outcome: "failed", code: "endpoint_address_blocked"};
    } catch {
        return {outcome: "retry", code: "provider_resolution"};
    }
    const address = addresses[0];
    return new Promise((resolveResult) => {
        let settled = false,
            sent = false;
        let timer;
        const done = (value) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolveResult(value);
            }
        };
        const req = request(
            {
                protocol: "https:",
                hostname: url.hostname,
                port: 443,
                path: url.pathname,
                method: "POST",
                headers: details.headers,
                rejectUnauthorized: true,
                servername: url.hostname,
                signal,
                lookup: (_hostname, options, callback) =>
                    options.all
                        ? callback(null, [
                            {address: address.address, family: address.family},
                        ])
                        : callback(null, address.address, address.family),
            },
            (response) => {
                const status = response.statusCode;
                if (status >= 200 && status < 300)
                    done({outcome: "accepted", code: null});
                else if (status === 404 || status === 410)
                    done({outcome: "gone", code: "subscription_gone"});
                else if (status === 408 || status === 429 || status >= 500) {
                    done({
                        outcome: "retry",
                        code:
                            status === 429 ? "provider_rate_limited" : "provider_rejected",
                        retryAfter: retryAfterSeconds(response.headers["retry-after"]),
                    });
                } else done({outcome: "failed", code: "provider_rejected"});
                response.destroy?.();
            },
        );
        timer = setTimeout(() => req.destroy(new Error("push_timeout")), 15000);
        req.on("error", () =>
            done({
                outcome: sent ? "uncertain" : "retry",
                code: sent ? "provider_acceptance_unknown" : "provider_connection",
            }),
        );
        req.once("finish", () => {
            sent = true;
        });
        req.end(details.body);
    });
}

export async function run(
    config,
    {call = rpc, send = transmit, signal = AbortSignal.timeout(240000)} = {},
) {
    const counts = {
        accepted: 0,
        retry: 0,
        failed: 0,
        uncertain: 0,
        gone: 0,
        suppressed: 0,
        rpc_errors: 0,
    };
    const refreshed = await call(
        config,
        "refresh_push_reminders",
        {p_limit: 100},
        signal,
    );
    if (!Number.isInteger(refreshed) || refreshed < 0 || refreshed > 100000)
        throw new Error("push_reminder_count_invalid");
    const leases = await call(
        config,
        "lease_notification_push",
        {p_limit: 20},
        signal,
    );
    if (!Array.isArray(leases) || leases.length > 20)
        throw new Error("push_leases_invalid");
    for (const lease of leases) {
        if (signal.aborted) break;
        if (
            !/^[0-9a-f-]{36}$/.test(lease.id ?? "") ||
            !/^[0-9a-f-]{36}$/.test(lease.lease_token ?? "")
        )
            throw new Error("push_lease_invalid");
        const args = {p_id: lease.id, p_lease_token: lease.lease_token};
        let row;
        try {
            row = await call(config, "prepare_notification_push", args, signal);
        } catch {
            counts.rpc_errors++;
            continue;
        }
        if (row === null) {
            counts.suppressed++;
            continue;
        }
        let result;
        if (row.id !== lease.id || row.lease_token !== lease.lease_token)
            result = {outcome: "failed", code: "lease_payload_invalid"};
        else result = await send(config, row, {signal});
        counts[result.outcome]++;
        try {
            if (
                (await call(
                    config,
                    "finish_notification_push",
                    {
                        ...args,
                        p_outcome: result.outcome,
                        p_error_code: result.code,
                        p_retry_after: result.retryAfter ?? null,
                    },
                    AbortSignal.timeout(15000),
                )) !== true
            )
                counts.rpc_errors++;
        } catch {
            counts.rpc_errors++;
        }
    }
    return counts;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
    if (!argv.includes("--run") || env.PORTAL_PUSH_ENABLED !== "true") {
        console.log(
            JSON.stringify({status: "disabled_or_dry_run", network_calls: 0}),
        );
        return 0;
    }
    try {
        const config = configuration(env);
        const counts = await run(config);
        console.log(JSON.stringify({status: "batch_complete", ...counts}));
        return Number(
            counts.failed + counts.uncertain + counts.retry + counts.rpc_errors > 0,
        );
    } catch {
        console.error(JSON.stringify({status: "push_worker_failed"}));
        return 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    process.exitCode = await main();
