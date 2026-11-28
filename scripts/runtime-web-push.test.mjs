import assert from "node:assert/strict";
import test from "node:test";
import {createECDH, createPublicKey, randomBytes, randomUUID, verify,} from "node:crypto";
import {EventEmitter} from "node:events";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import ece from "http_ece";
import * as webPush from "web-push";

const {
    configuration,
    endpointUrl,
    publicAddress,
    requestDetails,
    transmit,
    run,
    main,
} = await import(
process.env.PORTAL_PUSH_TEST_BUNDLE_URL ?? "./notification-push-worker.mjs"
    );
const vapid = webPush.generateVAPIDKeys();
const env = {
    PORTAL_PUSH_ENABLED: "true",
    PORTAL_PUSH_API_URL: "http://127.0.0.1:55321",
    PORTAL_PUSH_SERVICE_KEY: "fictional-key",
    PORTAL_PUSH_VAPID_PUBLIC_KEY: vapid.publicKey,
    PORTAL_PUSH_VAPID_PRIVATE_KEY: vapid.privateKey,
};
const config = configuration(env);
const curve = createECDH("prime256v1");
curve.generateKeys();
const auth = randomBytes(16).toString("base64url");
const row = {
    id: randomUUID(),
    lease_token: randomUUID(),
    device_token: randomUUID(),
    locale: "de",
    subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/fictional-token",
        keys: {p256dh: curve.getPublicKey().toString("base64url"), auth},
    },
};
test("actual AES128GCM encrypt/decrypt and ES256 VAPID signature are standard", () => {
    const details = requestDetails(config, {
        ...row,
        title: "PRIVATE CONTRACT",
        body: "PRIVATE CHAT",
    });
    assert.equal(details.headers["Content-Encoding"], "aes128gcm");
    const plaintext = ece
        .decrypt(details.body, {
            version: "aes128gcm",
            privateKey: curve,
            authSecret: auth,
        })
        .toString();
    assert.deepEqual(JSON.parse(plaintext), {
        id: row.id,
        token: row.device_token,
        locale: "de",
    });
    assert.ok(!plaintext.includes("PRIVATE"));
    const authorization = details.headers.Authorization;
    assert.match(authorization, /^vapid t=/);
    const jwt = authorization.match(/t=([^,]+)/)[1];
    const [header, payload, signature] = jwt.split(".");
    const publicBytes = Buffer.from(vapid.publicKey, "base64url");
    const key = createPublicKey({
        key: {
            kty: "EC",
            crv: "P-256",
            x: publicBytes.subarray(1, 33).toString("base64url"),
            y: publicBytes.subarray(33).toString("base64url"),
        },
        format: "jwk",
    });
    assert.equal(
        verify(
            "sha256",
            Buffer.from(`${header}.${payload}`),
            {key, dsaEncoding: "ieee-p1363"},
            Buffer.from(signature, "base64url"),
        ),
        true,
    );
    assert.equal(
        JSON.parse(Buffer.from(payload, "base64url")).aud,
        "https://fcm.googleapis.com",
    );
});
test("endpoint and public-IP guard blocks SSRF, suffix tricks and credentials", () => {
    for (const url of [
        "http://127.0.0.1/private",
        "https://fcm.googleapis.com.evil.invalid/x",
        "https://fcm.googleapis.com:8443/x",
        "https://user:pw@fcm.googleapis.com/x",
        "https://fcm.googleapis.com/x?secret=q",
    ]) {
        assert.throws(() => endpointUrl(url));
    }
    for (const ip of [
        "127.0.0.1",
        "10.2.3.4",
        "169.254.169.254",
        "::1",
        "::ffff:127.0.0.1",
        "fc00::1",
        "2001:db8::1",
    ]) {
        assert.equal(publicAddress(ip), false, ip);
    }
    assert.equal(publicAddress("142.250.190.10"), true);
    assert.equal(publicAddress("2607:f8b0:400a::1"), true);
});

function provider(status, retryAfter = "90") {
    let options;
    const request = (given, callback) => {
        options = given;
        const req = new EventEmitter();
        req.end = () =>
            queueMicrotask(() => {
                const res = new EventEmitter();
                res.statusCode = status;
                res.headers = {"retry-after": retryAfter};
                res.resume = () => {
                };
                callback(res);
            });
        req.destroy = (error) => req.emit("error", error);
        return req;
    };
    return {
        request,
        get options() {
            return options;
        },
    };
}

test("mock provider receives encrypted bytes through pinned verified TLS and classifies 201/410/429", async () => {
    for (const [status, outcome] of [
        [201, "accepted"],
        [410, "gone"],
        [429, "retry"],
        [500, "retry"],
        [302, "failed"],
    ]) {
        const mock = provider(status);
        const result = await transmit(config, row, {
            request: mock.request,
            resolve: async () => [{address: "142.250.190.10", family: 4}],
        });
        assert.equal(result.outcome, outcome);
        assert.equal(mock.options.rejectUnauthorized, true);
        assert.equal(mock.options.servername, "fcm.googleapis.com");
        mock.options.lookup(
            "fcm.googleapis.com",
            {all: true},
            (error, addresses) => {
                assert.equal(error, null);
                assert.deepEqual(addresses, [{address: "142.250.190.10", family: 4}]);
            },
        );
        mock.options.lookup(
            "fcm.googleapis.com",
            {all: false},
            (error, address, family) => {
                assert.equal(error, null);
                assert.equal(address, "142.250.190.10");
                assert.equal(family, 4);
            },
        );
        if (status === 429) assert.equal(result.retryAfter, 90);
    }
});
test("honors dated Retry-After values and caps the queue delay", async () => {
    const future = new Date(Date.now() + 48 * 60 * 60_000).toUTCString();
    const expired = "Sat, 01 Jan 2000 00:00:00 GMT";
    for (const [header, expected] of [
        [future, 86400],
        [expired, 0],
        ["12.5", null],
        [" ", null],
    ]) {
        const {request} = provider(429, header);
        const result = await transmit(config, row, {
            request,
            resolve: async () => [{address: "142.250.190.10", family: 4}],
        });
        assert.equal(result.outcome, "retry");
        assert.equal(result.retryAfter, expected);
    }
});
test("DNS private address or mixed rebinding candidates never contact provider", async () => {
    let contacted = false;
    const result = await transmit(config, row, {
        request: () => {
            contacted = true;
        },
        resolve: async () => [
            {address: "142.250.190.10", family: 4},
            {address: "127.0.0.1", family: 4},
        ],
    });
    assert.equal(result.outcome, "failed");
    assert.equal(contacted, false);
    const failedResolution = await transmit(config, row, {
        resolve: async () => {
            throw new Error("temporary DNS failure");
        },
        request: () => {
            contacted = true;
        },
    });
    assert.equal(failedResolution.outcome, "retry");
    assert.equal(contacted, false);
});
test("pre-write provider disconnect retries; post-write ambiguity is terminal uncertain", async () => {
    for (const finished of [false, true]) {
        const result = await transmit(config, row, {
            resolve: async () => [{address: "142.250.190.10", family: 4}],
            request: () => {
                const req = new EventEmitter();
                req.end = () =>
                    queueMicrotask(() => {
                        if (finished) req.emit("finish");
                        req.emit("error", new Error("private endpoint token"));
                    });
                req.destroy = () => {
                };
                return req;
            },
        });
        assert.equal(result.outcome, finished ? "uncertain" : "retry");
    }
});
test("worker only accepts exact lease and never resends after completion failure", async () => {
    const calls = [];
    let sends = 0;
    const call = async (_c, name, payload) => {
        calls.push([name, payload]);
        if (name === "refresh_push_reminders") return 0;
        if (name === "lease_notification_push")
            return [{id: row.id, lease_token: row.lease_token}];
        if (name === "prepare_notification_push") return row;
        throw new Error("private service key");
    };
    const result = await run(config, {
        call,
        send: async () => {
            sends++;
            return {outcome: "accepted", code: null};
        },
    });
    assert.equal(result.accepted, 1);
    assert.equal(result.rpc_errors, 1);
    assert.equal(sends, 1);
    assert.equal(calls.length, 4);
});
test("disabled/default CLI makes no network call", async () => {
    assert.equal(await main([], env), 0);
    assert.equal(await main(["--run"], {}), 0);
});
test("service worker requires current binding and opens fixed portal path", async () => {
    const code = await readFile(
        new URL("../public/push-sw.js", import.meta.url),
        "utf8",
    );
    const handlers = {},
        shown = [],
        opened = [];
    let current = {token: row.device_token};
    const database = {
        transaction: () => ({
            objectStore: () => ({
                get: () => {
                    const request = {};
                    queueMicrotask(() => {
                        request.result = current;
                        request.onsuccess();
                    });
                    return request;
                },
            }),
        }),
        close: () => {
        },
    };
    const context = {
        URL,
        Promise,
        indexedDB: {
            open: () => {
                const open = {};
                queueMicrotask(() => {
                    open.result = database;
                    open.onsuccess();
                });
                return open;
            },
        },
        self: {
            addEventListener: (name, fn) => {
                handlers[name] = fn;
            },
            location: {origin: "https://cms.example.invalid"},
            registration: {showNotification: async (...args) => shown.push(args)},
            clients: {
                matchAll: async () => [],
                openWindow: async (url) => opened.push(url),
            },
        },
    };
    vm.runInNewContext(code, context);

    async function push(payload) {
        let pending;
        handlers.push({
            data: {json: () => payload},
            waitUntil: (promise) => {
                pending = promise;
            },
        });
        await pending;
    }

    await push({
        id: row.id,
        token: row.device_token,
        locale: "de",
        url: "https://evil.invalid",
        title: "PRIVATE",
        body: "PRIVATE",
    });
    assert.equal(shown.length, 1);
    assert.equal(shown[0][0], "Luminovia");
    assert.ok(!JSON.stringify(shown).includes("PRIVATE"));
    current = null;
    await push({id: row.id, token: row.device_token, locale: "de"});
    assert.equal(shown.length, 1);
    let pending;
    handlers.notificationclick({
        notification: {
            close: () => {
            }, data: {url: "https://evil.invalid"}
        },
        waitUntil: (promise) => {
            pending = promise;
        },
    });
    await pending;
    assert.deepEqual(opened, ["https://cms.example.invalid/notifications"]);

    // The same worker in a signed Academy package uses its published short name.
    const shortName = 'Example "A" & Co';
    const customerWorker =
        `const PORTAL_PUSH_TITLE = ${JSON.stringify(shortName)};\n` + code;
    vm.runInNewContext(customerWorker, {...context});
    current = {token: row.device_token};
    await push({id: row.id, token: row.device_token, locale: "en", title: "PRIVATE"});
    assert.equal(shown.length, 2);
    assert.equal(shown[1][0], shortName);
    assert.equal(shown[1][1].icon, "/icons/icon-192.png");
});
