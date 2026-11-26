/** Own the separate loopback HTTPS origin used by the native H5P journey. */
import {execFileSync, spawn} from "node:child_process";
import {createHash, X509Certificate} from "node:crypto";
import {once} from "node:events";
import {readFile, mkdir} from "node:fs/promises";
import {request} from "node:http";
import {createServer} from "node:https";
import {join} from "node:path";
import {createInterface} from "node:readline";

const suffix = "launch.h5p-content.test";

/** Reserve the HTTPS endpoint before starting Vite and own it until QA exits. */
export async function prepareH5pBrowserRuntime(directory) {
    await mkdir(directory, {mode: 0o700});
    const sample = join(directory, "H5P.TrueFalse.h5p");
    const certPath = join(directory, "content.crt");
    const keyPath = join(directory, "content.key");
    execFileSync("openssl", [
        "req", "-newkey", "rsa:2048", "-x509", "-nodes", "-days", "1",
        "-subj", `/CN=*.${suffix}`,
        "-addext", `subjectAltName=DNS:*.${suffix}`,
        "-keyout", keyPath, "-out", certPath,
    ], {stdio: "ignore", timeout: 10_000});
    const [cert, key] = await Promise.all([readFile(certPath), readFile(keyPath)]);
    const publicKey = new X509Certificate(cert).publicKey.export({type: "spki", format: "der"});
    const certificatePin = createHash("sha256").update(publicKey).digest("base64");

    let playerPort;
    let player;
    let playerExit;
    const ingress = createServer({cert, key}, (incoming, outgoing) => {
        if (!playerPort) {
            outgoing.writeHead(503).end();
            return;
        }
        // Mirror the separate ingress contract. The content process receives
        // only the launch hostname and optional media-range header.
        const forwarded = request({
            host: "127.0.0.1",
            port: playerPort,
            path: incoming.url,
            method: incoming.method,
            headers: {
                host: (incoming.headers.host ?? "").split(":")[0],
                ...(incoming.headers.range ? {range: incoming.headers.range} : {}),
            },
        }, (reply) => {
            outgoing.writeHead(reply.statusCode, reply.headers);
            reply.pipe(outgoing);
        });
        forwarded.on("error", () => {
            if (outgoing.headersSent) outgoing.destroy();
            else outgoing.writeHead(502).end();
        });
        forwarded.end();
    });
    ingress.listen(0, "127.0.0.1");
    await once(ingress, "listening");
    const host = `${suffix}:${ingress.address().port}`;

    return {
        host,
        sample,
        certificatePin,
        /** Bind the actual shipped content process to an OS-allocated local port. */
        async start(entry, origin, signal) {
            player = spawn(process.execPath, [entry], {
                env: {
                    PORTAL_TEST_MODE: "1",
                    LUMINOVIA_H5P_PORT: "0",
                    LUMINOVIA_H5P_PORTAL_ORIGIN: origin,
                    LUMINOVIA_H5P_CONTENT_HOST_SUFFIX: suffix,
                },
                stdio: ["ignore", "pipe", "inherit"],
            });
            playerExit = once(player, "close");
            const lines = createInterface({input: player.stdout});
            try {
                const [line] = await Promise.race([
                    once(lines, "line", {
                        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
                    }),
                    playerExit.then(([code]) => {
                        throw new Error(`Isolated H5P process exited with status ${code}`);
                    }),
                ]);
                const match = /^Isolated H5P runtime listening on loopback port ([1-9]\d*)$/.exec(line);
                if (!match) throw new Error("Unexpected isolated H5P runtime readiness response");
                playerPort = Number(match[1]);
            } finally {
                lines.close();
            }
        },
        async close() {
            const closed = once(ingress, "close");
            ingress.close();
            ingress.closeAllConnections();
            if (player && player.exitCode === null && player.signalCode === null) player.kill("SIGKILL");
            await Promise.all([closed, playerExit]);
        },
    };
}
