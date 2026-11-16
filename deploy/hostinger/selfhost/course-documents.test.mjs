/** Actual pinned Edge Runtime user-worker PDF/font rehearsal, no network/ports. */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
test(
  "pinned read-only Edge Runtime renders real Unicode PDF in a 512MiB user worker without network",
  { timeout: 90000 },
  () => {
    const image = /image: (supabase\/edge-runtime:[^\s]+)/.exec(
      readFileSync(join(root, "deploy/hostinger/selfhost/compose.yml"), "utf8"),
    )?.[1];
    assert.ok(image?.includes("@sha256:"));
    const temporary = mkdtempSync(join(tmpdir(), "luminovia-pdf-runtime-")),
      nonce = randomUUID(),
      name = "portal-pdf-check-" + nonce;
    const docker = (args, options = {}) => {
      const result = spawnSync("docker", args, {
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        ...options,
      });
      if (result.status !== 0)
        throw new Error(
          "Owned PDF runtime operation failed: " +
            String(result.stderr).slice(0, 180),
        );
      return result.stdout;
    };
    let container;
    try {
      mkdirSync(join(temporary, "main"));
      mkdirSync(join(temporary, "probe"));
      writeFileSync(
        join(temporary, "main/index.ts"),
        `Deno.serve({port:9000},async(req)=>{try{const worker=await EdgeRuntime.userWorkers.create({servicePath:'/home/deno/functions/probe',memoryLimitMb:512,workerTimeoutMs:20000,noModuleCache:false,staticPatterns:['/home/deno/functions/course-documents/assets/DejaVuSans.ttf'],envVars:[]});return await worker.fetch(req);}catch(error){return new Response(String(error),{status:500});}});`,
      );
      writeFileSync(
        join(temporary, "probe/index.ts"),
        `import{renderFactPdf}from'../course-documents/pdf.ts';const font=await Deno.readFile(new URL('../course-documents/assets/DejaVuSans.ttf',import.meta.url));Deno.serve(async()=>{const bytes=await renderFactPdf('completion',{id:'fictional-runtime-proof',participant:'Fictional Müller Μαρία Мария',course:'Linux Übung',time_zone:'Europe/Berlin',verified_minutes:60,quiz_passed:true,issued_at:'2026-11-01T12:00:00Z'},font);return new Response(bytes,{headers:{'Content-Type':'application/pdf'}});});`,
      );
      container = String(
        docker([
          "create",
          "--name",
          name,
          "--label",
          `org.luminovia.course-pdf-check=${nonce}`,
          "--network",
          "none",
          "--read-only",
          "--log-driver",
          "local",
          "--memory",
          "768m",
          "--pids-limit",
          "128",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,size=128m",
          "-e",
          "DENO_DIR=/tmp/deno",
          "--mount",
          `type=bind,src=${temporary}/main,dst=/home/deno/functions/main,readonly`,
          "--mount",
          `type=bind,src=${temporary}/probe,dst=/home/deno/functions/probe,readonly`,
          "--mount",
          `type=bind,src=${root}/supabase/functions/course-documents,dst=/home/deno/functions/course-documents,readonly`,
          image,
          "start",
          "--main-service",
          "/home/deno/functions/main",
        ]),
      ).trim();
      docker(["start", container]);
      let response, lastResponse;
      for (let attempt = 0; attempt < 40; attempt++) {
        const read = spawnSync(
          "docker",
          [
            "exec",
            container,
            "bash",
            "-c",
            "exec 3<>/dev/tcp/127.0.0.1/9000 && printf 'GET / HTTP/1.0\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && cat <&3",
          ],
          { timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        );
        if (read.status === 0 && read.stdout?.includes(Buffer.from("%PDF-"))) {
          response = read.stdout;
          break;
        }
        if (read.stdout?.length)
          lastResponse = read.stdout.toString().slice(0, 1000);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
      assert.ok(
        response?.includes(Buffer.from("200 OK")),
        "Actual pinned Edge Runtime must return a rendered PDF: " +
          String(lastResponse),
      );
      const boundary = response.indexOf(Buffer.from("\r\n\r\n"));
      const body = response.subarray(boundary + 4);
      assert.ok(body.length > 10000);
      assert.equal(body.subarray(0, 5).toString(), "%PDF-");
    } finally {
      if (container) {
        const label = String(
          docker([
            "inspect",
            "--format",
            '{{index .Config.Labels "org.luminovia.course-pdf-check"}}',
            container,
          ]),
        ).trim();
        assert.equal(label, nonce);
        docker(["rm", "-f", container]);
      }
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);
