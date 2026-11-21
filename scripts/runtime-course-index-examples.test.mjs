/** Run the published clients against the actual Edge handler on a disposable loopback server. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createCompanyIntegrationHandler } from "../supabase/functions/company-integration/handler.ts";

const exec = promisify(execFile);
const example = (extension) =>
  join(import.meta.dirname, "examples", `course-index.${extension}`);
const clients = {
  curl: ["bash", example("sh")],
  Python: ["python3", example("py")],
  TypeScript: [process.execPath, "--experimental-strip-types", example("ts")],
};

test("course-index quickstarts authenticate, paginate and report the same errors", async (t) => {
  const id = randomUUID();
  const secret = randomBytes(32).toString("hex");
  const activeCredential = `lvi_${id}_${secret}`;
  const retiredCredential = `lvi_${id}_${randomBytes(32).toString("hex")}`;
  const digest = createHash("sha256").update(secret).digest("hex");
  const fictionalCourse = (number) => ({
    id: `70d74920-1c6e-47f3-a258-${String(number).padStart(12, "0")}`,
    title: `Fictional course ${number}`,
    time_zone: "Europe/Berlin",
  });
  const ownCourses = Array.from({ length: 26 }, (_, index) =>
    fictionalCourse(index + 1),
  );
  const courses = [
    ...ownCourses.map((course) => ({
      course,
      company: "own",
      published: true,
    })),
    { course: fictionalCourse(27), company: "own", published: false },
    { course: fictionalCourse(28), company: "other", published: true },
  ];
  const handler = createCompanyIntegrationHandler(async (query) => {
    if (query.p_id !== id || query.p_secret_hash !== digest)
      return { status: "denied" };
    const remaining = courses
      .filter(
        ({ company, published, course }) =>
          company === "own" && published && course.id > (query.p_after ?? ""),
      )
      .map(({ course }) => course);
    const items = remaining.slice(0, query.p_limit);
    return {
      status: "ok",
      items,
      next_cursor: remaining.length > items.length ? items.at(-1).id : null,
    };
  });

  let requestCount = 0;
  const server = createServer(async (request, reply) => {
    requestCount++;
    if (request.url.startsWith("/functions/")) {
      reply.writeHead(307, { Location: "/backend" + request.url });
      reply.end('{"error":"unexpected_redirect"}');
      return;
    }
    try {
      // Match the portal gateway's removal of /backend before dispatch.
      const result = await handler(
        new Request(origin + request.url.replace(/^\/backend(?=\/)/, ""), {
          method: request.method,
          headers: request.headers,
        }),
      );
      reply.writeHead(result.status, Object.fromEntries(result.headers));
      reply.end(await result.text());
    } catch {
      reply.writeHead(500).end();
    }
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const [language, [program, ...args]] of Object.entries(clients)) {
    await t.test(language, async () => {
      const run = (key, { base = origin + "/backend/", cursor = [] } = {}) =>
        exec(program, [...args, ...cursor], {
          env: {
            PATH: process.env.PATH,
            LUMINOVIA_API_BASE_URL: base,
            LUMINOVIA_INTEGRATION_KEY: key,
          },
          timeout: 20_000,
        });
      const next = ownCourses[24].id;
      assert.deepEqual(JSON.parse((await run(activeCredential)).stdout), {
        items: ownCourses.slice(0, 25),
        next_cursor: next,
      });
      assert.deepEqual(
        JSON.parse((await run(activeCredential, { cursor: [next] })).stdout),
        { items: ownCourses.slice(25), next_cursor: null },
      );
      await assert.rejects(run(retiredCredential), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /HTTP 401/);
        assert.deepEqual(JSON.parse(error.stdout), {
          error: "invalid_credential",
        });
        return true;
      });

      const beforeRedirect = requestCount;
      await assert.rejects(run(activeCredential, { base: origin }), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /HTTP 307/);
        return true;
      });
      assert.equal(requestCount, beforeRedirect + 1);
    });
  }
});
